package app

import (
	"errors"
	"strings"
	"testing"
	"time"
)

type scripted struct {
	url   string
	body  string
	head  *string
	err   error
	isGet bool
}

type seqFetch struct {
	gets  []scripted
	heads []scripted
}

func gets(items ...scripted) *seqFetch {
	return &seqFetch{gets: items}
}

func heads(items ...scripted) *seqFetch {
	return &seqFetch{heads: items}
}

func okGet(url, body string) scripted {
	return scripted{url: url, body: body, isGet: true}
}

func errGet(url, message string) scripted {
	return scripted{url: url, err: errors.New(message), isGet: true}
}

func (f *seqFetch) GetText(url string) (string, error) {
	if len(f.gets) == 0 {
		return "", errors.New("unexpected GET " + url)
	}
	item := f.gets[0]
	f.gets = f.gets[1:]
	if item.url != url {
		return "", errors.New("GET " + url + " != " + item.url)
	}
	if item.err != nil {
		return "", item.err
	}
	return item.body, nil
}

func (f *seqFetch) HeadLastModified(url string) (*string, error) {
	if len(f.heads) == 0 {
		return nil, errors.New("unexpected HEAD " + url)
	}
	item := f.heads[0]
	f.heads = f.heads[1:]
	if item.url != url {
		return nil, errors.New("HEAD " + url + " != " + item.url)
	}
	if item.err != nil {
		return nil, item.err
	}
	return item.head, nil
}

func emptyTool(method Method) Tool {
	return Tool{
		Name:     "t",
		Method:   method,
		Priority: "P1",
		Group:    "g",
		Status:   StatusReady,
		Env:      []string{},
		Probe:    []string{},
	}
}

func strPtr(value string) *string {
	return &value
}

func at(raw string) time.Time {
	parsed, err := parseTime(raw)
	if err != nil {
		panic(err)
	}
	return parsed
}

func TestPublishedAtReleaseParsesPublishedAtOnly(t *testing.T) {
	tool := emptyTool(MethodRelease)
	tool.Repo = strPtr("benbjohnson/litestream")
	url := "https://api.github.com/repos/benbjohnson/litestream/releases/tags/v0.5.17"
	fetch := gets(okGet(url, `{"created_at":"2019-01-01T00:00:00Z","published_at":"2024-06-01T00:00:00Z"}`))
	got, err := publishedAt(&tool, "0.5.17", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at("2024-06-01T00:00:00Z")) {
		t.Fatalf("got %s", got)
	}
}

func TestPublishedAtReleaseDoesNotUseCreatedAt(t *testing.T) {
	tool := emptyTool(MethodRelease)
	tool.Repo = strPtr("benbjohnson/litestream")
	url := "https://api.github.com/repos/benbjohnson/litestream/releases/tags/v0.5.17"
	fetch := gets(okGet(url, `{"created_at":"2024-06-01T00:00:00Z"}`))
	_, err := publishedAt(&tool, "0.5.17", fetch)
	if err == nil || !strings.Contains(err.Error(), "missing published_at") {
		t.Fatalf("error = %v", err)
	}
}

func TestPublishedAtVendorUsesLastModified(t *testing.T) {
	tool := emptyTool(MethodVendor)
	tool.URL = strPtr("https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip")
	header := "Sat, 01 Jun 2024 00:00:00 GMT"
	fetch := heads(scripted{url: *tool.URL, head: strPtr(header)})
	got, err := publishedAt(&tool, "2.15.0", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at(header)) {
		t.Fatalf("got %s", got)
	}
}

func TestPublishedAtVendorMissingLastModifiedIsAnError(t *testing.T) {
	tool := emptyTool(MethodVendor)
	tool.URL = strPtr("https://awscli.amazonaws.com/a.zip")
	fetch := heads(scripted{url: *tool.URL, head: nil})
	_, err := publishedAt(&tool, "1", fetch)
	if err == nil || !strings.Contains(err.Error(), "published time unknown") {
		t.Fatalf("error = %v", err)
	}
}

func TestPublishedAtGoParsesTime(t *testing.T) {
	tool := emptyTool(MethodGo)
	tool.Module = strPtr("golang.org/x/tools")
	url := "https://proxy.golang.org/golang.org/x/tools/@v/v0.1.0.info"
	fetch := gets(okGet(url, `{"Version":"v0.1.0","Time":"2024-06-01T00:00:00Z"}`))
	got, err := publishedAt(&tool, "0.1.0", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at("2024-06-01T00:00:00Z")) {
		t.Fatalf("got %s", got)
	}
}

func TestPublishedAtCargoParsesCreatedAt(t *testing.T) {
	tool := emptyTool(MethodCargo)
	tool.Package = strPtr("serde")
	url := "https://crates.io/api/v1/crates/serde/1.0.210"
	fetch := gets(okGet(url, `{"version":{"num":"1.0.210","created_at":"2024-06-01T00:00:00Z"}}`))
	got, err := publishedAt(&tool, "1.0.210", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at("2024-06-01T00:00:00Z")) {
		t.Fatalf("got %s", got)
	}
}

func TestPublishedAtBunParsesTimeMap(t *testing.T) {
	tool := emptyTool(MethodBun)
	tool.Package = strPtr("cf")
	url := "https://registry.npmjs.org/cf"
	fetch := gets(okGet(url, `{"dist-tags":{"latest":"9.9.9"},"time":{"1.0.0-beta.26":"2024-06-01T00:00:00.123Z"}}`))
	got, err := publishedAt(&tool, "1.0.0-beta.26", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at("2024-06-01T00:00:00.123Z")) {
		t.Fatalf("got %s", got)
	}
}

func TestReleaseRetriesWithoutVPrefixOn404(t *testing.T) {
	tool := emptyTool(MethodRelease)
	tool.Repo = strPtr("ovh/ovhcloud-cli")
	fetch := gets(
		errGet("https://api.github.com/repos/ovh/ovhcloud-cli/releases/tags/v0.16.0", "GET status 404"),
		okGet("https://api.github.com/repos/ovh/ovhcloud-cli/releases/tags/0.16.0", `{"published_at":"2024-06-01T00:00:00Z"}`),
	)
	got, err := publishedAt(&tool, "0.16.0", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at("2024-06-01T00:00:00Z")) {
		t.Fatalf("got %s", got)
	}
}

func TestReleaseDoesNotRetryOnOtherStatus(t *testing.T) {
	tool := emptyTool(MethodRelease)
	tool.Repo = strPtr("ovh/ovhcloud-cli")
	fetch := gets(errGet("https://api.github.com/repos/ovh/ovhcloud-cli/releases/tags/v0.16.0", "GET status 500"))
	_, err := publishedAt(&tool, "0.16.0", fetch)
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("error = %v", err)
	}
}

func TestGoUpperCaseIsEscaped(t *testing.T) {
	tool := emptyTool(MethodGo)
	tool.Module = strPtr("github.com/Foo/Bar")
	url := "https://proxy.golang.org/github.com/!foo/!bar/@v/v1.2.3.info"
	fetch := gets(okGet(url, `{"Time":"2024-06-01T00:00:00Z"}`))
	got, err := publishedAt(&tool, "1.2.3", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at("2024-06-01T00:00:00Z")) {
		t.Fatalf("got %s", got)
	}
	if goEscape("github.com/Foo/Bar") != "github.com/!foo/!bar" {
		t.Fatalf("escape = %s", goEscape("github.com/Foo/Bar"))
	}
}

func TestScopedNpmEncodesOnlyTheSlash(t *testing.T) {
	tool := emptyTool(MethodBun)
	tool.Package = strPtr("@creem_io/cli")
	url := "https://registry.npmjs.org/@creem_io%2Fcli"
	fetch := gets(okGet(url, `{"time":{"0.9.0":"2024-06-01T00:00:00Z"}}`))
	got, err := publishedAt(&tool, "0.9.0", fetch)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at("2024-06-01T00:00:00Z")) {
		t.Fatalf("got %s", got)
	}
	if npmPath("@creem_io/cli") != "@creem_io%2Fcli" || npmPath("cf") != "cf" {
		t.Fatalf("npmPath scoped=%s plain=%s", npmPath("@creem_io/cli"), npmPath("cf"))
	}
}

func TestLatestReleaseStripsOneV(t *testing.T) {
	tool := emptyTool(MethodRelease)
	tool.Repo = strPtr("benbjohnson/litestream")
	fetch := gets(okGet("https://api.github.com/repos/benbjohnson/litestream/releases/latest", `{"tag_name":"v0.5.17"}`))
	got, err := latestCandidate(&tool, fetch)
	if err != nil {
		t.Fatal(err)
	}
	if got != "0.5.17" {
		t.Fatalf("got %s", got)
	}
}

func TestLatestGoCargoAndBun(t *testing.T) {
	goTool := emptyTool(MethodGo)
	goTool.Module = strPtr("github.com/Foo/Bar")
	goFetch := gets(okGet("https://proxy.golang.org/github.com/!foo/!bar/@latest", `{"Version":"v1.2.3"}`))
	got, err := latestCandidate(&goTool, goFetch)
	if err != nil {
		t.Fatal(err)
	}
	if got != "v1.2.3" {
		t.Fatalf("go %s", got)
	}

	cargo := emptyTool(MethodCargo)
	cargo.Package = strPtr("serde")
	cargoFetch := gets(okGet("https://crates.io/api/v1/crates/serde", `{"crate":{"max_stable_version":"1.0.210"}}`))
	got, err = latestCandidate(&cargo, cargoFetch)
	if err != nil {
		t.Fatal(err)
	}
	if got != "1.0.210" {
		t.Fatalf("cargo %s", got)
	}

	bun := emptyTool(MethodBun)
	bun.Package = strPtr("@creem_io/cli")
	bunFetch := gets(okGet("https://registry.npmjs.org/@creem_io%2Fcli", `{"dist-tags":{"latest":"0.9.0"}}`))
	got, err = latestCandidate(&bun, bunFetch)
	if err != nil {
		t.Fatal(err)
	}
	if got != "0.9.0" {
		t.Fatalf("bun %s", got)
	}
}

func TestPrereleaseDetectionAndStablePick(t *testing.T) {
	if !isPrerelease("1.0.0-beta.26") || !isPrerelease("v2.0.0-rc.1") {
		t.Fatal("expected prerelease")
	}
	if isPrerelease("0.15.0") || isPrerelease("1.2.3+build-5") {
		t.Fatal("expected stable-shaped")
	}
	if !isStable("v1.2.3") || isStable("1.0.0-beta.1") {
		t.Fatal("stable mismatch")
	}
	bun := emptyTool(MethodBun)
	bun.Package = strPtr("cf")
	body := `{"dist-tags":{"latest":"1.0.0-beta.26"},"versions":{"0.9.1":{},"0.15.0":{},"0.10.0":{},"1.0.0-beta.26":{}}}`
	fetch := gets(okGet("https://registry.npmjs.org/cf", body))
	got, err := latestCandidate(&bun, fetch)
	if err != nil {
		t.Fatal(err)
	}
	if got != "0.15.0" {
		t.Fatalf("got %s", got)
	}
}

func TestLatestVendorTakesFirstSemverTag(t *testing.T) {
	tool := emptyTool(MethodVendor)
	tool.VersionFrom = strPtr("github:aws/aws-cli")
	fetch := gets(okGet(
		"https://api.github.com/repos/aws/aws-cli/tags",
		`[{"name":"latest"},{"name":"nightly"},{"name":"v2.15.0"},{"name":"v2.14.0"}]`,
	))
	got, err := latestCandidate(&tool, fetch)
	if err != nil {
		t.Fatal(err)
	}
	if got != "v2.15.0" {
		t.Fatalf("got %s", got)
	}
}
