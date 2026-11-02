// resolve.go ports cli-rust/src/resolve.rs.
//
// Network goes through Fetch only. HTTP helpers (parseTime, HostPolicy, client,
// getText, headLastModified) belong to the http/cooldown ports.

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Fetch is the resolve::Fetch trait.
type Fetch interface {
	GetText(url string) (string, error)
	HeadLastModified(url string) (*string, error)
}

// HttpFetch is resolve::HttpFetch.
type HttpFetch struct {
	client *httpClient
	policy HostPolicy
}

// newHttpFetch is HttpFetch::new.
func newHttpFetch(policy HostPolicy) (*HttpFetch, error) {
	hc, err := client(policy)
	if err != nil {
		return nil, err
	}
	return &HttpFetch{client: hc, policy: policy}, nil
}

// GetText is Fetch::get_text.
func (h *HttpFetch) GetText(url string) (string, error) {
	return getText(h.client, &h.policy, url)
}

// HeadLastModified is Fetch::head_last_modified.
func (h *HttpFetch) HeadLastModified(url string) (*string, error) {
	return headLastModified(h.client, &h.policy, url)
}

// publishedAt is published_at.
func publishedAt(tool *Tool, version string, fetch Fetch) (time.Time, error) {
	if strings.TrimSpace(version) == "" {
		return time.Time{}, fmt.Errorf("missing version")
	}
	switch tool.Method {
	case MethodRelease:
		return releasePublished(tool, version, fetch)
	case MethodVendor:
		return vendorPublished(tool, fetch)
	case MethodGo:
		return goPublished(tool, version, fetch)
	case MethodCargo:
		return cargoPublished(tool, version, fetch)
	case MethodBun:
		return bunPublished(tool, version, fetch)
	default:
		return time.Time{}, fmt.Errorf("unknown method")
	}
}

// latestCandidate is latest_candidate.
func latestCandidate(tool *Tool, fetch Fetch) (string, error) {
	switch tool.Method {
	case MethodRelease:
		repoName, err := need(tool.Repo, "repo")
		if err != nil {
			return "", err
		}
		repo, err := githubRepo(repoName)
		if err != nil {
			return "", err
		}
		url := "https://api.github.com/repos/" + repo + "/releases/latest"
		body, err := fetch.GetText(url)
		if err != nil {
			return "", err
		}
		value, err := parseJSON(body)
		if err != nil {
			return "", err
		}
		tag, ok := jsonString(value, "tag_name")
		if !ok {
			return "", fmt.Errorf("missing tag_name")
		}
		return strings.TrimPrefix(tag, "v"), nil
	case MethodGo:
		moduleName, err := need(tool.Module, "module")
		if err != nil {
			return "", err
		}
		module := goEscape(moduleName)
		url := "https://proxy.golang.org/" + module + "/@latest"
		body, err := fetch.GetText(url)
		if err != nil {
			return "", err
		}
		value, err := parseJSON(body)
		if err != nil {
			return "", err
		}
		version, ok := jsonString(value, "Version")
		if !ok {
			return "", fmt.Errorf("missing Version")
		}
		return version, nil
	case MethodCargo:
		pkg, err := need(tool.Package, "package")
		if err != nil {
			return "", err
		}
		url := "https://crates.io/api/v1/crates/" + pkg
		body, err := fetch.GetText(url)
		if err != nil {
			return "", err
		}
		value, err := parseJSON(body)
		if err != nil {
			return "", err
		}
		stable, ok := jsonPointerString(value, "/crate/max_stable_version")
		if !ok {
			return "", fmt.Errorf("missing crate.max_stable_version")
		}
		return stable, nil
	case MethodBun:
		pkgName, err := need(tool.Package, "package")
		if err != nil {
			return "", err
		}
		pkg := npmPath(pkgName)
		url := "https://registry.npmjs.org/" + pkg
		body, err := fetch.GetText(url)
		if err != nil {
			return "", err
		}
		value, err := parseJSON(body)
		if err != nil {
			return "", err
		}
		tagged, ok := jsonPointerString(value, "/dist-tags/latest")
		if !ok {
			return "", fmt.Errorf("missing dist-tags.latest")
		}
		if isStable(tagged) {
			return tagged, nil
		}
		// latest 태그가 prerelease 면 정식 버전 중 가장 높은 것을 쓴다.
		picked, ok := highestStable(value)
		if !ok {
			return "", fmt.Errorf("%s: 정식(non-prerelease) 버전이 없습니다", pkg)
		}
		return picked, nil
	case MethodVendor:
		return vendorLatest(tool, fetch)
	default:
		return "", fmt.Errorf("unknown method")
	}
}

func releasePublished(tool *Tool, version string, fetch Fetch) (time.Time, error) {
	_, published, err := releaseInfo(tool, version, fetch)
	return published, err
}

// releaseInfo is release_info. Tag name (`v1.2.3` or `1.2.3`) and publish time.
func releaseInfo(tool *Tool, version string, fetch Fetch) (string, time.Time, error) {
	repoName, err := need(tool.Repo, "repo")
	if err != nil {
		return "", time.Time{}, err
	}
	repo, err := githubRepo(repoName)
	if err != nil {
		return "", time.Time{}, err
	}
	prefixed := "https://api.github.com/repos/" + repo + "/releases/tags/v" + version
	body, err := fetch.GetText(prefixed)
	if err != nil {
		if !isNotFound(err) {
			return "", time.Time{}, err
		}
		plain := "https://api.github.com/repos/" + repo + "/releases/tags/" + version
		body, err = fetch.GetText(plain)
		if err != nil {
			return "", time.Time{}, err
		}
	}
	value, err := parseJSON(body)
	if err != nil {
		return "", time.Time{}, err
	}
	raw, ok := jsonString(value, "published_at")
	if !ok {
		return "", time.Time{}, fmt.Errorf("missing published_at")
	}
	published, err := parseTS(raw)
	if err != nil {
		return "", time.Time{}, err
	}
	tag, ok := jsonString(value, "tag_name")
	if !ok {
		tag = "v" + version
	}
	return tag, published, nil
}

func vendorPublished(tool *Tool, fetch Fetch) (time.Time, error) {
	url, err := need(tool.URL, "url")
	if err != nil {
		return time.Time{}, err
	}
	header, err := fetch.HeadLastModified(url)
	if err != nil {
		return time.Time{}, err
	}
	if header == nil {
		return time.Time{}, fmt.Errorf("published time unknown")
	}
	return parseTS(*header)
}

func goPublished(tool *Tool, version string, fetch Fetch) (time.Time, error) {
	moduleName, err := need(tool.Module, "module")
	if err != nil {
		return time.Time{}, err
	}
	module := goEscape(moduleName)
	url := "https://proxy.golang.org/" + module + "/@v/v" + version + ".info"
	body, err := fetch.GetText(url)
	if err != nil {
		return time.Time{}, err
	}
	value, err := parseJSON(body)
	if err != nil {
		return time.Time{}, err
	}
	raw, ok := jsonString(value, "Time")
	if !ok {
		return time.Time{}, fmt.Errorf("missing Time")
	}
	return parseTS(raw)
}

func cargoPublished(tool *Tool, version string, fetch Fetch) (time.Time, error) {
	pkg, err := need(tool.Package, "package")
	if err != nil {
		return time.Time{}, err
	}
	url := "https://crates.io/api/v1/crates/" + pkg + "/" + version
	body, err := fetch.GetText(url)
	if err != nil {
		return time.Time{}, err
	}
	value, err := parseJSON(body)
	if err != nil {
		return time.Time{}, err
	}
	raw, ok := jsonPointerString(value, "/version/created_at")
	if !ok {
		return time.Time{}, fmt.Errorf("missing version.created_at")
	}
	return parseTS(raw)
}

// npmVersionInfo is npm_version_info. Publish time and dist.integrity (sha512-…).
func npmVersionInfo(tool *Tool, version string, fetch Fetch) (time.Time, *string, error) {
	pkgName, err := need(tool.Package, "package")
	if err != nil {
		return time.Time{}, nil, err
	}
	pkg := npmPath(pkgName)
	url := "https://registry.npmjs.org/" + pkg
	body, err := fetch.GetText(url)
	if err != nil {
		return time.Time{}, nil, err
	}
	value, err := parseJSON(body)
	if err != nil {
		return time.Time{}, nil, err
	}
	raw, ok := jsonNestedString(value, "time", version)
	if !ok {
		return time.Time{}, nil, fmt.Errorf("missing time[version]")
	}
	published, err := parseTS(raw)
	if err != nil {
		return time.Time{}, nil, err
	}
	pointer := "/versions/" + jsonPointerEscape(version) + "/dist/integrity"
	integrity, ok := jsonPointerString(value, pointer)
	if !ok {
		return published, nil, nil
	}
	return published, &integrity, nil
}

func bunPublished(tool *Tool, version string, fetch Fetch) (time.Time, error) {
	pkgName, err := need(tool.Package, "package")
	if err != nil {
		return time.Time{}, err
	}
	pkg := npmPath(pkgName)
	url := "https://registry.npmjs.org/" + pkg
	body, err := fetch.GetText(url)
	if err != nil {
		return time.Time{}, err
	}
	value, err := parseJSON(body)
	if err != nil {
		return time.Time{}, err
	}
	raw, ok := jsonNestedString(value, "time", version)
	if !ok {
		return time.Time{}, fmt.Errorf("missing time[version]")
	}
	return parseTS(raw)
}

func vendorLatest(tool *Tool, fetch Fetch) (string, error) {
	raw, err := need(tool.VersionFrom, "version_from")
	if err != nil {
		return "", err
	}
	rest, ok := strings.CutPrefix(raw, "github:")
	if !ok {
		return "", fmt.Errorf("version_from is not github:owner/repo")
	}
	repo, err := githubRepo(rest)
	if err != nil {
		return "", err
	}
	url := "https://api.github.com/repos/" + repo + "/tags"
	body, err := fetch.GetText(url)
	if err != nil {
		return "", err
	}
	value, err := parseJSON(body)
	if err != nil {
		return "", err
	}
	tags, ok := value.([]any)
	if !ok {
		return "", fmt.Errorf("tags are not an array")
	}
	for _, tag := range tags {
		name, ok := jsonString(tag, "name")
		if ok && isStable(name) {
			return name, nil
		}
	}
	return "", fmt.Errorf("no semver tag")
}

func need(value *string, field string) (string, error) {
	if value == nil {
		return "", fmt.Errorf("missing %s", field)
	}
	text := strings.TrimSpace(*value)
	if text == "" {
		return "", fmt.Errorf("missing %s", field)
	}
	return text, nil
}

func githubRepo(repo string) (string, error) {
	owner, name, ok := strings.Cut(repo, "/")
	if !ok || !githubComponent(owner) || !githubComponent(name) || strings.Contains(name, "/") {
		return "", fmt.Errorf("repo must be owner/name")
	}
	return repo, nil
}

func githubComponent(value string) bool {
	if value == "" {
		return false
	}
	for _, ch := range value {
		if !isASCIIAlnum(ch) && ch != '-' && ch != '_' && ch != '.' {
			return false
		}
	}
	return true
}

func isASCIIAlnum(ch rune) bool {
	return (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')
}

// goEscape is Go module proxy case encoding: each ASCII uppercase letter becomes `!` + lowercase.
func goEscape(module string) string {
	var out strings.Builder
	out.Grow(len(module))
	for _, ch := range module {
		if ch >= 'A' && ch <= 'Z' {
			out.WriteByte('!')
			out.WriteByte(byte(ch - 'A' + 'a'))
		} else {
			out.WriteRune(ch)
		}
	}
	return out.String()
}

// npmPath encodes the single slash of a scoped npm name (`@scope/name` → `@scope%2Fname`).
func npmPath(pkg string) string {
	rest, ok := strings.CutPrefix(pkg, "@")
	if !ok {
		return pkg
	}
	scope, name, ok := strings.Cut(rest, "/")
	if !ok || scope == "" || name == "" || strings.Contains(name, "/") {
		return pkg
	}
	return "@" + scope + "%2F" + name
}

func parseJSON(text string) (any, error) {
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return nil, fmt.Errorf("invalid json: %w", err)
	}
	return value, nil
}

func parseTS(raw string) (time.Time, error) {
	return parseTime(raw)
}

func isNotFound(err error) bool {
	seen := map[error]struct{}{}
	for err != nil {
		if _, ok := seen[err]; ok {
			break
		}
		seen[err] = struct{}{}
		if hasDigitToken(err.Error(), "404") {
			return true
		}
		err = errors.Unwrap(err)
	}
	return false
}

func hasDigitToken(text, token string) bool {
	for _, part := range strings.FieldsFunc(text, func(ch rune) bool {
		return ch < '0' || ch > '9'
	}) {
		if part == token {
			return true
		}
	}
	return false
}

// isPrerelease reports a prerelease tail (`-beta.1`, `-rc.2`).
func isPrerelease(version string) bool {
	rest := strings.TrimPrefix(version, "v")
	if core, _, ok := strings.Cut(rest, "+"); ok {
		rest = core
	}
	return strings.Contains(rest, "-")
}

// isStable reports a `major.minor.patch` release with no prerelease tail.
func isStable(version string) bool {
	return isSemverTag(version) && !isPrerelease(version)
}

func stableKey(version string) (uint64, uint64, uint64) {
	rest := strings.TrimPrefix(version, "v")
	if core, _, ok := strings.Cut(rest, "+"); ok {
		rest = core
	}
	parts := strings.Split(rest, ".")
	var nums [3]uint64
	for i := 0; i < 3 && i < len(parts); i++ {
		n, err := strconv.ParseUint(parts[i], 10, 64)
		if err != nil {
			continue
		}
		nums[i] = n
	}
	return nums[0], nums[1], nums[2]
}

func isSemverTag(name string) bool {
	rest := strings.TrimPrefix(name, "v")
	if core, _, ok := strings.Cut(rest, "+"); ok {
		rest = core
	}
	core, pre, hasPre := strings.Cut(rest, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 || !numericID(parts[0]) || !numericID(parts[1]) || !numericID(parts[2]) {
		return false
	}
	if !hasPre {
		return true
	}
	if pre == "" {
		return false
	}
	for _, part := range strings.Split(pre, ".") {
		if part == "" || !prePart(part) {
			return false
		}
	}
	return true
}

func prePart(part string) bool {
	for _, ch := range part {
		if !isASCIIAlnum(ch) && ch != '-' {
			return false
		}
	}
	return true
}

func numericID(part string) bool {
	if part == "" {
		return false
	}
	for i := 0; i < len(part); i++ {
		if part[i] < '0' || part[i] > '9' {
			return false
		}
	}
	return len(part) == 1 || part[0] != '0'
}

func jsonString(value any, key string) (string, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return "", false
	}
	text, ok := object[key].(string)
	return text, ok
}

func jsonNestedString(value any, key, child string) (string, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return "", false
	}
	return jsonString(object[key], child)
}

func jsonPointerString(value any, pointer string) (string, bool) {
	found, ok := jsonPointer(value, pointer)
	if !ok {
		return "", false
	}
	text, ok := found.(string)
	return text, ok
}

func jsonPointer(value any, pointer string) (any, bool) {
	if pointer == "" {
		return value, true
	}
	if !strings.HasPrefix(pointer, "/") {
		return nil, false
	}
	cur := value
	for _, raw := range strings.Split(pointer[1:], "/") {
		token := strings.ReplaceAll(strings.ReplaceAll(raw, "~1", "/"), "~0", "~")
		object, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = object[token]
		if !ok {
			return nil, false
		}
	}
	return cur, true
}

func jsonPointerEscape(token string) string {
	return strings.ReplaceAll(strings.ReplaceAll(token, "~", "~0"), "/", "~1")
}

// highestStable picks the greatest stable key. Equal keys keep the
// lexicographically later name, matching serde_json's BTreeMap + max_by_key.
func highestStable(value any) (string, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return "", false
	}
	versions, ok := object["versions"].(map[string]any)
	if !ok {
		return "", false
	}
	var best string
	var bestKey [3]uint64
	found := false
	for name := range versions {
		if !isStable(name) {
			continue
		}
		key := stableKeyTuple(name)
		if !found || cmpStable(key, bestKey) > 0 || (cmpStable(key, bestKey) == 0 && name > best) {
			best = name
			bestKey = key
			found = true
		}
	}
	return best, found
}

func stableKeyTuple(version string) [3]uint64 {
	a, b, c := stableKey(version)
	return [3]uint64{a, b, c}
}

func cmpStable(a, b [3]uint64) int {
	for i := 0; i < 3; i++ {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}
