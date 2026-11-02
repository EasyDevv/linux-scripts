// api.go ports the NetBird management API calls. The HTTP client is configured
// to match Python's urllib, not Go's defaults: HTTP/1.1 only, no compression,
// no keep-alive, a 30 s timeout, and the same redirect codes urllib follows
// (301/302/303/307/308, at most 10 hops).
package app

import (
	"bytes"
	"crypto/tls"
	"encoding/json"

	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// pythonRedirects are the codes urllib.request.HTTPRedirectHandler follows.
var pythonRedirects = map[int]bool{301: true, 302: true, 303: true, 307: true, 308: true}

// pythonMaxRedirections is urllib's max_redirections: ten hops are followed,
// the eleventh is reported as a failed request.
const pythonMaxRedirections = 10

// urllibTransport is Python's urllib fingerprint where it differs from Go:
// no gzip (urllib sends no Accept-Encoding), HTTP/1.1 only (urllib never
// negotiates h2), one connection per request, environment proxies like
// urllib's ProxyHandler.
func urllibTransport() *http.Transport {
	return &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   30 * time.Second,
		DisableCompression:    true,
		DisableKeepAlives:     true,
		ForceAttemptHTTP2:     false,
		TLSNextProto:          map[string]func(string, *tls.Conn) http.RoundTripper{},
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		MaxIdleConns:          1,
		ExpectContinueTimeout: time.Second,
	}
}

// newHTTPClient builds a client with urllib's redirect rules.
func newHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: urllibTransport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > pythonMaxRedirections {
				return fmt.Errorf("stopped after %d redirects", pythonMaxRedirections)
			}
			if req.Response != nil && !pythonRedirects[req.Response.StatusCode] {
				return fmt.Errorf("unfollowed redirect (%d)", req.Response.StatusCode)
			}
			return nil
		},
	}
}

// requestFunc is the seam the command layer and tests use instead of HTTP.
type requestFunc func(method, path string, body any) (any, error)

// apiClient issues authorized management-API requests.
type apiClient struct {
	managementURL string
	token         string
	client        *http.Client
}

func newAPIClient(managementURL, token string) *apiClient {
	return &apiClient{managementURL: managementURL, token: token, client: newHTTPClient(30 * time.Second)}
}

// request performs one call and decodes the JSON body. An empty body is nil.
func (c *apiClient) request(method, path string, body any) (any, error) {
	var payload io.Reader
	if body != nil {
		encoded, err := pythonJSON(body)
		if err != nil {
			return nil, newError("NetBird API request failed")
		}
		payload = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, c.managementURL+path, payload)
	if err != nil {
		return nil, newError("NetBird API request failed")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Token "+c.token)
	req.Header.Set("Content-Type", "application/json")
	// http.client's default header; Go would otherwise send no Accept-Encoding at
	// all because the transport has compression disabled.
	req.Header.Set("Accept-Encoding", "identity")
	// urllib opens one connection per request and closes it.
	req.Close = true
	resp, err := c.client.Do(req)
	if err != nil {
		if resp != nil {
			return nil, httpFailure(method, path, resp.StatusCode)
		}
		return nil, newError("NetBird API request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, httpFailure(method, path, resp.StatusCode)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, newError("NetBird API request failed")
	}
	if len(raw) == 0 {
		return nil, nil
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, newError("NetBird API returned invalid JSON")
	}
	return decoded, nil
}

// httpFailure maps a status to the original's two messages.
func httpFailure(method, path string, code int) error {
	if code == 401 {
		return newError("NetBird API token invalid (401)")
	}
	return newError(fmt.Sprintf("NetBird API %s %s failed (%d)", method, path, code))
}

// defaultRequest is api_request(): one request per call, a fresh client each time.
func defaultRequest(config Config) requestFunc {
	return func(method, path string, body any) (any, error) {
		return newAPIClient(config.ManagementURL, config.APIKey).request(method, path, body)
	}
}

// resolveGroupID finds the auto group's id: first with the name filter, then
// the unfiltered list (some deployments ignore the query).
func resolveGroupID(config Config, request requestFunc) (string, error) {
	payload, _ := request("GET", "/api/groups?name="+config.AutoGroup, nil)
	groups, _ := payload.([]any)
	if len(groups) == 0 {
		payload, err := request("GET", "/api/groups", nil)
		if err != nil {
			return "", err
		}
		groups, _ = payload.([]any)
	}
	for _, group := range groups {
		entry, ok := group.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := entry["name"].(string); name != config.AutoGroup {
			continue
		}
		if id, ok := entry["id"].(string); ok && id != "" {
			return id, nil
		}
	}
	return "", newError("NetBird group not found: " + config.AutoGroup)
}

// setupKeyBody is the POST body, in the original's key order.
type setupKeyBody struct {
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	ExpiresIn  int      `json:"expires_in"`
	AutoGroups []string `json:"auto_groups"`
	UsageLimit int      `json:"usage_limit"`
	Ephemeral  bool     `json:"ephemeral"`
}

// createSetupKey mints a one-off key and returns it. It never prints the value.
func createSetupKey(config Config, name string, request requestFunc) (string, error) {
	groupID, err := resolveGroupID(config, request)
	if err != nil {
		return "", err
	}
	payload, err := request("POST", "/api/setup-keys", setupKeyBody{
		Name:       name,
		Type:       "one-off",
		ExpiresIn:  DefaultExpiresIn,
		AutoGroups: []string{groupID},
		UsageLimit: DefaultUsageLimit,
		Ephemeral:  false,
	})
	if err != nil {
		return "", err
	}
	entry, ok := payload.(map[string]any)
	if !ok {
		return "", newError("NetBird API did not return a setup key")
	}
	key, ok := entry["key"].(string)
	if !ok || key == "" {
		return "", newError("NetBird API did not return a setup key")
	}
	return key, nil
}

// pythonJSON renders a request body the way Python's json.dumps(body) does:
// `", "` between items, `": "` after keys, insertion order kept, and
// ensure_ascii string escaping. Go's json.Marshal would send the compact
// separators and leave non-ASCII as UTF-8, which a strict proxy or a log
// comparison sees as a different body.
func pythonJSON(value any) ([]byte, error) {
	compact, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(compact))
	decoder.UseNumber()
	var out bytes.Buffer
	if err := writePythonJSON(decoder, &out); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// writePythonJSON re-emits one JSON value from decoder's token stream.
func writePythonJSON(decoder *json.Decoder, out *bytes.Buffer) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			out.WriteByte('{')
			for first := true; decoder.More(); first = false {
				if !first {
					out.WriteString(", ")
				}
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, _ := key.(string)
				out.WriteString(pythonJSONString(name))
				out.WriteString(": ")
				if err := writePythonJSON(decoder, out); err != nil {
					return err
				}
			}
			if _, err := decoder.Token(); err != nil { // closing '}'
				return err
			}
			out.WriteByte('}')
		case '[':
			out.WriteByte('[')
			for first := true; decoder.More(); first = false {
				if !first {
					out.WriteString(", ")
				}
				if err := writePythonJSON(decoder, out); err != nil {
					return err
				}
			}
			if _, err := decoder.Token(); err != nil { // closing ']'
				return err
			}
			out.WriteByte(']')
		}
	case string:
		out.WriteString(pythonJSONString(value))
	case json.Number:
		// json.Marshal's literal is Python's for the integers this API takes.
		out.WriteString(string(value))
	case bool:
		if value {
			out.WriteString("true")
		} else {
			out.WriteString("false")
		}
	case nil:
		out.WriteString("null")
	}
	return nil
}

// pythonJSONString quotes a string with Python's json.dumps escaping: short
// escapes for the named control characters, \uXXXX for everything else
// outside printable ASCII, and surrogate pairs above the basic plane.
func pythonJSONString(value string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			out.WriteString(`\"`)
		case '\\':
			out.WriteString(`\\`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		case '\b':
			out.WriteString(`\b`)
		case '\f':
			out.WriteString(`\f`)
		default:
			if r < 0x20 || r > 0x7e {
				if r > 0xffff {
					high := 0xd800 + ((r - 0x10000) >> 10)
					low := 0xdc00 + ((r - 0x10000) & 0x3ff)
					fmt.Fprintf(&out, `\u%04x\u%04x`, high, low)
				} else {
					fmt.Fprintf(&out, `\u%04x`, r)
				}
				continue
			}
			out.WriteRune(r)
		}
	}
	out.WriteByte('"')
	return out.String()
}
