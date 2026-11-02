// http.go ports cli-rust/src/http.rs (HTTPS downloads limited to a per-tool host allow-list).
//
// reqwest was built with default-features = false and features blocking, json, rustls-tls:
// no gzip/brotli/deflate and no HTTP/2. This client sets DisableCompression and
// ForceAttemptHTTP2=false (TLSNextProto is an empty map so HTTP/2 stays off).
// Proxies come only from HTTP(S)_PROXY / ALL_PROXY / NO_PROXY (and lowercase). If
// REQUEST_METHOD is set, every proxy is off (hyper-util CGI rule, not only HTTP_PROXY).
// Redirects: at most 5 (a 6th hop is "too many redirects"). Cross host or port drops
// Authorization. Redirect targets are checked against the same allow-list.
//
// Allowed differences from Rust: TLS roots are the system pool (not webpki-roots),
// IDNA is not applied, and the 10s connect budget is split into dial 10s + TLS handshake 10s.
// SOCKS proxy URLs are ignored (stdlib has no SOCKS dialer). parseTime is not in http.rs.

package app

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	userAgent        = "cli/0.1 (+local)"
	maxRedirects     = 5
	maxDownloadBytes = 2 * 1024 * 1024 * 1024
	maxTextBytes     = 16 * 1024 * 1024
)

var githubHosts = []string{
	"github.com",
	"api.github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
	"github-releases.githubusercontent.com",
}

// HostPolicy is the per-tool HTTPS host allow-list.
// Allowed is the public host list (lowercased, deduped). testPorts is test-only.
type HostPolicy struct {
	Allowed   []string
	testPorts []uint16
}

// HostBlocked is a refused URL. Error text is "host blocked: {url} ({reason})".
type HostBlocked struct {
	URL    string
	Reason string
}

func (e *HostBlocked) Error() string {
	return fmt.Sprintf("host blocked: %s (%s)", e.URL, e.Reason)
}

func hostBlocked(raw, reason string) error {
	return &HostBlocked{URL: raw, Reason: reason}
}

// ForTool is HostPolicy::for_tool.
func ForTool(tool *Tool) HostPolicy {
	var allowed []string
	if tool.Repo != nil && strings.TrimSpace(*tool.Repo) != "" {
		for _, host := range githubHosts {
			pushHost(&allowed, host)
		}
	}
	if tool.URL != nil {
		if host, ok := hostOf(*tool.URL); ok {
			pushHost(&allowed, host)
		}
	}
	if tool.SigURL != nil {
		if host, ok := hostOf(*tool.SigURL); ok {
			pushHost(&allowed, host)
		}
	}
	if tool.VersionFrom != nil && strings.HasPrefix(*tool.VersionFrom, "github:") {
		pushHost(&allowed, "api.github.com")
	}
	var fixed []string
	switch tool.Method {
	case MethodGo:
		fixed = []string{"proxy.golang.org", "sum.golang.org"}
	case MethodCargo:
		fixed = []string{"crates.io", "static.crates.io", "index.crates.io"}
	case MethodBun:
		fixed = []string{"registry.npmjs.org"}
	default:
		fixed = nil
	}
	for _, host := range fixed {
		pushHost(&allowed, host)
	}
	return HostPolicy{Allowed: allowed}
}

// AllowLocalhostForTests allows only http://127.0.0.1:<port>/…. Not install policy.
func AllowLocalhostForTests(port uint16) HostPolicy {
	return HostPolicy{testPorts: []uint16{port}}
}

// AndLocalhostForTests adds another loopback port (two local servers).
func (p HostPolicy) AndLocalhostForTests(port uint16) HostPolicy {
	for _, existing := range p.testPorts {
		if existing == port {
			return p
		}
	}
	p.testPorts = append(append([]uint16{}, p.testPorts...), port)
	return p
}

// CheckURL is HostPolicy::check_url.
// A missing scheme and a port that does not fit in u16 are "invalid url"
// (net/url accepts both; the url crate does not).
func (p HostPolicy) CheckURL(raw string) error {
	parsed, port, ok := parseHTTPURL(raw)
	if !ok {
		return hostBlocked(raw, "invalid url")
	}
	if parsed.User != nil {
		name := parsed.User.Username()
		_, hasPass := parsed.User.Password()
		if name != "" || hasPass {
			return hostBlocked(raw, "userinfo is not allowed")
		}
	}
	host := asciiLower(parsed.Hostname())
	if host == "" {
		return hostBlocked(raw, "missing host")
	}
	testLocal := host == "127.0.0.1" && port != nil && containsPort(p.testPorts, *port)
	scheme := asciiLower(parsed.Scheme)
	if scheme != "https" && !(scheme == "http" && testLocal) {
		return hostBlocked(raw, "scheme is not https")
	}
	if testLocal {
		return nil
	}
	if !hostAllowed(p.Allowed, host) {
		return hostBlocked(raw, "host is not allowed")
	}
	if port != nil {
		return hostBlocked(raw, "port is not allowed")
	}
	return nil
}

// httpClient is the reqwest blocking Client plus the policy captured by its redirect hook.
type httpClient struct {
	hc     *http.Client
	policy HostPolicy
}

// client builds the HTTP client. Proxy env is read once, matching reqwest's build-time snapshot.
func client(policy HostPolicy) (*httpClient, error) {
	c := &httpClient{policy: policy}
	transport := &http.Transport{
		Proxy:               proxyFromEnv(),
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
		ForceAttemptHTTP2:   false,
		DisableCompression:  true,
		TLSNextProto:        map[string]func(string, *tls.Conn) http.RoundTripper{},
	}
	c.hc = &http.Client{
		Timeout:   120 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return c.checkRedirect(req, via)
		},
	}
	return c, nil
}

func (c *httpClient) checkRedirect(req *http.Request, via []*http.Request) error {
	// via includes the initial request, so len > 5 means a 6th hop (7th request is not sent).
	if len(via) > maxRedirects {
		return fmt.Errorf("too many redirects")
	}
	if err := c.policy.CheckURL(req.URL.String()); err != nil {
		return err
	}
	prev := via[len(via)-1].URL
	if hostOrPortDiffers(prev, req.URL) {
		req.Header.Del("Authorization")
		req.Header.Del("Cookie")
		req.Header.Del("Cookie2")
		req.Header.Del("Proxy-Authorization")
		req.Header.Del("Www-Authenticate")
	}
	return nil
}

func getText(c *httpClient, policy *HostPolicy, rawURL string) (string, error) {
	resp, err := send(c, policy, http.MethodGet, rawURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := readBody(resp, rawURL, maxTextBytes)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(body) {
		return "", fmt.Errorf("GET %s body is not utf-8", rawURL)
	}
	return string(body), nil
}

func getJSON(c *httpClient, policy *HostPolicy, rawURL string) (any, error) {
	text, err := getText(c, policy, rawURL)
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return nil, fmt.Errorf("invalid json from %s: %w", rawURL, err)
	}
	return value, nil
}

func headLastModified(c *httpClient, policy *HostPolicy, rawURL string) (*string, error) {
	resp, err := send(c, policy, http.MethodHead, rawURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("HEAD %s status %d", rawURL, resp.StatusCode)
	}
	if _, ok := resp.Header["Last-Modified"]; !ok {
		return nil, nil
	}
	value := resp.Header.Get("Last-Modified")
	return &value, nil
}

func download(c *httpClient, policy *HostPolicy, rawURL, dest string) error {
	resp, err := send(c, policy, http.MethodGet, rawURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("GET %s status %d", rawURL, resp.StatusCode)
	}
	if resp.ContentLength > maxDownloadBytes {
		return fmt.Errorf("GET %s exceeds 2 GiB", rawURL)
	}
	if parent := parentDir(dest); parent != "" {
		if err := os.MkdirAll(parent, 0o777); err != nil {
			return fmt.Errorf("create %s: %w", parent, err)
		}
	}
	part := dest + ".part"
	file, err := os.Create(part)
	if err != nil {
		return fmt.Errorf("create %s: %w", part, err)
	}
	armed := true
	defer func() {
		if armed {
			_ = os.Remove(part)
		}
	}()
	if _, err := copyCapped(resp.Body, file, maxDownloadBytes); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("write %s: %w", part, err)
	}
	if err := os.Rename(part, dest); err != nil {
		return fmt.Errorf("rename %s -> %s: %w", part, dest, err)
	}
	armed = false
	return nil
}

func send(c *httpClient, policy *HostPolicy, method, rawURL string) (*http.Response, error) {
	if err := policy.CheckURL(rawURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequest(method, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", method, rawURL, err)
	}
	req.URL.Scheme = asciiLower(req.URL.Scheme)
	req.Header.Set("User-Agent", userAgent)
	auth, err := authorizationFor(rawURL)
	if err != nil {
		return nil, err
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		return nil, fmt.Errorf("%s %s: %w", method, rawURL, err)
	}
	return resp, nil
}

// authorizationFor attaches a bearer token only for api.github.com.
// A token that cannot be a header value is an error that does not include the token.
func authorizationFor(rawURL string) (string, error) {
	parsed, _, ok := parseHTTPURL(rawURL)
	if !ok {
		return "", nil
	}
	if asciiLower(parsed.Hostname()) != "api.github.com" {
		return "", nil
	}
	token, ok := envUnicode("GITHUB_TOKEN")
	if !ok {
		return "", nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", nil
	}
	value := "Bearer " + token
	if !validHeaderValue(value) {
		return "", fmt.Errorf("GITHUB_TOKEN cannot be used as an Authorization header")
	}
	return value, nil
}

func readBody(resp *http.Response, rawURL string, cap int64) ([]byte, error) {
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("GET %s status %d", rawURL, resp.StatusCode)
	}
	if resp.ContentLength > cap {
		return nil, fmt.Errorf("GET %s exceeds %d bytes", rawURL, cap)
	}
	return copyCapped(io.LimitReader(resp.Body, cap+1), &bytesBuf{}, cap)
}

type bytesBuf struct {
	b []byte
}

func (w *bytesBuf) Write(p []byte) (int, error) {
	w.b = append(w.b, p...)
	return len(p), nil
}

func copyCapped(reader io.Reader, writer io.Writer, cap int64) ([]byte, error) {
	buf := make([]byte, 64*1024)
	var total int64
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			if total > cap-int64(n) {
				return nil, fmt.Errorf("response exceeds %d bytes", cap)
			}
			total += int64(n)
			if _, werr := writer.Write(buf[:n]); werr != nil {
				return nil, werr
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	if bb, ok := writer.(*bytesBuf); ok {
		return bb.b, nil
	}
	return nil, nil
}

func pushHost(allowed *[]string, host string) {
	host = asciiLower(strings.TrimSpace(host))
	if host == "" {
		return
	}
	for _, item := range *allowed {
		if item == host {
			return
		}
	}
	*allowed = append(*allowed, host)
}

func hostOf(raw string) (string, bool) {
	parsed, _, ok := parseHTTPURL(raw)
	if !ok {
		return "", false
	}
	host := asciiLower(parsed.Hostname())
	if host == "" {
		return "", false
	}
	return host, true
}

func hostAllowed(allowed []string, host string) bool {
	for _, item := range allowed {
		if asciiEq(item, host) {
			return true
		}
	}
	return false
}

func containsPort(ports []uint16, port uint16) bool {
	for _, item := range ports {
		if item == port {
			return true
		}
	}
	return false
}

// parseHTTPURL accepts a URL the url crate would accept for this checker.
// port is non-nil when the raw authority has an explicit :port that fits in u16.
// ok is false for parse failures, a missing scheme, or a port outside u16.
func parseHTTPURL(raw string) (parsed *url.URL, port *uint16, ok bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return nil, nil, false
	}
	explicit, present, invalid := rawPort(raw)
	if invalid {
		return nil, nil, false
	}
	if present {
		return u, &explicit, true
	}
	return u, nil, true
}

// rawPort mirrors http.rs raw_port, except a present port that is not a u16 is invalid.
func rawPort(raw string) (port uint16, present, invalid bool) {
	i := strings.Index(raw, "://")
	if i < 0 {
		return 0, false, false
	}
	rest := raw[i+3:]
	authority := rest
	if j := strings.IndexAny(rest, "/?#"); j >= 0 {
		authority = rest[:j]
	}
	hostport := authority
	if at := strings.LastIndex(authority, "@"); at >= 0 {
		hostport = authority[at+1:]
	}
	var portStr string
	if strings.HasPrefix(hostport, "[") {
		end := strings.Index(hostport, "]")
		if end < 0 {
			return 0, false, false
		}
		after := hostport[end+1:]
		if !strings.HasPrefix(after, ":") {
			return 0, false, false
		}
		portStr = after[1:]
		present = true
	} else if host, p, cut := strings.Cut(hostport, ":"); cut {
		_ = host
		portStr = p
		present = true
	}
	if !present {
		return 0, false, false
	}
	n, err := strconv.ParseUint(portStr, 10, 16)
	if err != nil || portStr == "" {
		return 0, true, true
	}
	return uint16(n), true, false
}

func hostOrPortDiffers(prev, next *url.URL) bool {
	if prev == nil || next == nil {
		return true
	}
	if !asciiEq(prev.Hostname(), next.Hostname()) {
		return true
	}
	return portOrDefault(prev) != portOrDefault(next)
}

func portOrDefault(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	switch asciiLower(u.Scheme) {
	case "https":
		return "443"
	case "http":
		return "80"
	default:
		return ""
	}
}

func validHeaderValue(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c != '\t' && (c < ' ' || c > '~') {
			return false
		}
	}
	return true
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

func asciiEq(a, b string) bool {
	return asciiLower(a) == asciiLower(b)
}

func proxyFromEnv() func(*http.Request) (*url.URL, error) {
	if _, ok := os.LookupEnv("REQUEST_METHOD"); ok {
		return func(*http.Request) (*url.URL, error) { return nil, nil }
	}
	httpProxy := envOrEmpty("HTTP_PROXY", "http_proxy")
	httpsProxy := envOrEmpty("HTTPS_PROXY", "https_proxy")
	allProxy := envOrEmpty("ALL_PROXY", "all_proxy")
	noProxy := envOrEmpty("NO_PROXY", "no_proxy")
	return func(req *http.Request) (*url.URL, error) {
		host := ""
		scheme := ""
		if req != nil && req.URL != nil {
			host = req.URL.Hostname()
			scheme = asciiLower(req.URL.Scheme)
		}
		if noProxyMatch(noProxy, host) {
			return nil, nil
		}
		raw := httpProxy
		if scheme == "https" {
			raw = httpsProxy
		}
		if raw == "" {
			raw = allProxy
		}
		return parseProxyURL(raw), nil
	}
}

func envOrEmpty(names ...string) string {
	for _, name := range names {
		if value, ok := os.LookupEnv(name); ok {
			return value
		}
	}
	return ""
}

func parseProxyURL(raw string) *url.URL {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return nil
	}
	switch asciiLower(u.Scheme) {
	case "http", "https":
		u.Scheme = asciiLower(u.Scheme)
		return u
	default:
		return nil
	}
}

func noProxyMatch(list, host string) bool {
	if list == "" || host == "" {
		return false
	}
	host = strings.TrimPrefix(host, "[")
	host = strings.TrimSuffix(host, "]")
	var ips []net.IP
	var nets []*net.IPNet
	var domains []string
	for _, part := range strings.Split(list, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "/") {
			if _, ipnet, err := net.ParseCIDR(part); err == nil {
				nets = append(nets, ipnet)
				continue
			}
		}
		if ip := net.ParseIP(part); ip != nil {
			ips = append(ips, ip)
			continue
		}
		domains = append(domains, part)
	}
	if ip := net.ParseIP(host); ip != nil {
		for _, item := range ips {
			if item.Equal(ip) {
				return true
			}
		}
		for _, ipnet := range nets {
			if ipnet.Contains(ip) {
				return true
			}
		}
		return false
	}
	for _, domain := range domains {
		if domain == "*" || domainMatch(domain, host) {
			return true
		}
	}
	return false
}

func domainMatch(pattern, domain string) bool {
	if asciiEq(pattern, domain) {
		return true
	}
	if strings.HasPrefix(pattern, ".") && asciiEq(pattern[1:], domain) {
		return true
	}
	if len(domain) >= len(pattern) && asciiEq(domain[len(domain)-len(pattern):], pattern) {
		if strings.HasPrefix(pattern, ".") {
			return true
		}
		if len(domain) > len(pattern) && domain[len(domain)-len(pattern)-1] == '.' {
			return true
		}
	}
	return false
}
