package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"netbird-setup/internal/ui"
)

// moduleDir is dev/netbird, whose windows/ and README.md the USB payload copies.
func moduleDir(t *testing.T) string {
	t.Helper()
	path, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return path
}

// newApp builds a non-interactive App rooted in a temp dev/netbird directory.
func newApp(t *testing.T, keysText string) (*App, string, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	tmp := t.TempDir()
	paths := pathsFromRoot(filepath.Join(tmp, "netbird"))
	if err := os.MkdirAll(paths.ScriptDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if keysText != "" {
		if err := os.WriteFile(paths.KeysPath, []byte(keysText), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	app := &App{
		Paths: paths,
		In:    strings.NewReader(""),
		Out:   stdout,
		Err:   stderr,
		Getenv: func(key string) string {
			if key == "NETBIRD_API_KEY" {
				return "pat"
			}
			return ""
		},
	}
	return app, tmp, stdout, stderr
}

// PathTests.test_keys_file_is_usb_name_in_netbird_dir
func TestPathsPort(t *testing.T) {
	paths := defaultPaths(func(key string) string {
		if key == RootEnv {
			return "/srv/scripts/dev/netbird"
		}
		return ""
	})
	if KeysName != ".env.netbird.setup.keys" {
		t.Fatalf("KeysName = %q", KeysName)
	}
	if got, want := paths.KeysPath, "/srv/scripts/dev/netbird/.env.netbird.setup.keys"; got != want {
		t.Fatalf("KeysPath = %q, want %q", got, want)
	}
	if got, want := paths.ConfigPath, "/srv/scripts/dev/.env.netbird"; got != want {
		t.Fatalf("ConfigPath = %q, want %q", got, want)
	}
	if got, want := paths.MSICache, "/srv/scripts/dev/netbird/.data/"+MSIName; got != want {
		t.Fatalf("MSICache = %q, want %q", got, want)
	}
}

// NameTests.*
func TestNormalizeKeyName(t *testing.T) {
	cases := []struct{ in, want, err string }{
		{"green_user_01", "GREEN_USER_01", ""},
		{"NETBIRD_SETUP_KEY_GREEN_ADMIN_PC", "GREEN_ADMIN_PC", ""},
		{"NETBIRD_API_KEY", "", "key name is reserved: NETBIRD_API_KEY"},
		{"green-user", "", "key name must look like GREEN_USER_01 (uppercase letters, digits, underscore)"},
	}
	for _, tc := range cases {
		got, err := normalizeKeyName(tc.in)
		if tc.err != "" {
			if err == nil || err.Error() != tc.err {
				t.Fatalf("normalizeKeyName(%q) error = %v, want %q", tc.in, err, tc.err)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Fatalf("normalizeKeyName(%q) = %q, %v; want %q", tc.in, got, err, tc.want)
		}
	}
}

// EnvTests.*
func TestUpsertEnv(t *testing.T) {
	original := "# keep\nGREEN_USER_01=old-secret\nGREEN_ADMIN_PC=other-secret\n"
	updated := upsertEnv(original, "GREEN_USER_01", "new-secret")
	for _, want := range []string{"# keep", "GREEN_USER_01=new-secret", "GREEN_ADMIN_PC=other-secret"} {
		if !strings.Contains(updated, want) {
			t.Fatalf("upsert lost %q:\n%s", want, updated)
		}
	}
	if strings.Contains(updated, "old-secret") {
		t.Fatalf("upsert kept the old value:\n%s", updated)
	}
	if got, want := upsertEnv("", "A_1", "v"), "A_1=v\n"; got != want {
		t.Fatalf("upsert on empty text = %q, want %q", got, want)
	}
	if got, want := upsertEnv("# only comment", "A_1", "v"), "# only comment\n\nA_1=v\n"; got != want {
		t.Fatalf("upsert appended = %q, want %q", got, want)
	}
}

func TestParseEnvSkipsComments(t *testing.T) {
	values := parseEnv("# c\nGREEN_USER_01=abc\nexport GREEN_ADMIN_PC='xyz'\n")
	if values["GREEN_USER_01"] != "abc" || values["GREEN_ADMIN_PC"] != "xyz" {
		t.Fatalf("parseEnv = %#v", values)
	}
	if len(values) != 2 {
		t.Fatalf("parseEnv kept %d entries, want 2", len(values))
	}
}

// UsbParseTests.test_parse_lsblk_keeps_mounted_usb_only
const lsblkFixture = `{"blockdevices":[
 {"name":"nvme0n1","tran":"nvme","rm":false,"type":"disk","model":"Samsung",
  "children":[{"name":"nvme0n1p1","type":"part","mountpoint":"/boot","label":"boot","size":"1G"}]},
 {"name":"sda","tran":"usb","rm":true,"type":"disk","model":"Cruzer","size":"58.6G",
  "children":[{"name":"sda1","type":"part","mountpoints":["/run/media/easydev/USB"],"label":"USB","size":"58.6G"}]}]}`

func TestParseLsblk(t *testing.T) {
	volumes, err := listUsbVolumes(lsblkFixture)
	if err != nil {
		t.Fatal(err)
	}
	if len(volumes) != 1 {
		t.Fatalf("volumes = %d, want 1: %#v", len(volumes), volumes)
	}
	got := volumes[0]
	if got.Mountpoint != "/run/media/easydev/USB" || got.Label != "USB" || got.Model != "Cruzer" {
		t.Fatalf("volume = %#v", got)
	}
	if want := "USB  /run/media/easydev/USB  58.6G  Cruzer"; got.ChoiceLabel() != want {
		t.Fatalf("ChoiceLabel = %q, want %q", got.ChoiceLabel(), want)
	}
	if _, err := listUsbVolumes("not json"); err == nil || err.Error() != "failed to parse lsblk json" {
		t.Fatalf("bad json error = %v", err)
	}
}

// WindowsScriptTests.*
func TestRenderWindowsScripts(t *testing.T) {
	paths := pathsFromRoot(moduleDir(t))
	ps1, err := renderWindowsPS1(paths)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{".env.netbird.setup.keys", "param(", "$DryRun", "[Console]::ReadKey",
		"msiexec.exe", "winget", "netbird up", "--setup-key", "Disable-UsedSetupKey", "already used", "0x0336"} {
		if !strings.Contains(ps1, want) {
			t.Fatalf("ps1 missing %q", want)
		}
	}
	cmdText, err := renderWindowsCMD(paths)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(cmdText, "install-netbird.ps1") || !strings.Contains(cmdText, "@echo off") {
		t.Fatalf("cmd launcher = %q", cmdText)
	}
	if _, err := renderWindowsReadme(paths); err != nil {
		t.Fatal(err)
	}
}

// CommandTests.test_issue_saves_key_without_printing_it
func TestIssueSavesKeyWithoutPrintingIt(t *testing.T) {
	app, _, stdout, _ := newApp(t, "")
	app.Create = func(_ Config, name string) (string, error) { return "secret-for-" + name, nil }
	if err := app.Issue("green_user_01", false); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(app.Paths.KeysPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{
		"GREEN_USER_01=secret-for-GREEN_USER_01",
		"# auto-group: employees",
		"#   netbird up --management-url " + DefaultManagementURL + " --setup-key <KEY>",
		"#   1. Change Server",
		"#   3. Add this device with a setup key",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("keys file missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(strings.SplitN(text, "GREEN_USER_01=", 2)[0], "secret-for-GREEN_USER_01") {
		t.Fatal("header leaked the key")
	}
	if strings.Contains(stdout.String(), "secret-for-GREEN_USER_01") {
		t.Fatalf("stdout leaked the key: %q", stdout.String())
	}
	if !strings.Contains(stdout.String(), "issued GREEN_USER_01") {
		t.Fatalf("stdout = %q", stdout.String())
	}
	info, err := os.Stat(app.Paths.KeysPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("keys file mode = %o, want 600", got)
	}
}

// CommandTests.test_issue_requires_replace_without_tty
func TestIssueRequiresReplaceWithoutTTY(t *testing.T) {
	app, _, _, _ := newApp(t, "GREEN_USER_01=already\n")
	app.Create = func(Config, string) (string, error) {
		t.Fatal("minted a key without --replace")
		return "", nil
	}
	err := app.Issue("GREEN_USER_01", false)
	if err == nil || err.Error() != "GREEN_USER_01 already exists; pass --replace" {
		t.Fatalf("error = %v", err)
	}
}

// CommandTests.test_usb_writes_script_to_dest
func TestUSBWritesScriptToDest(t *testing.T) {
	app, tmp, stdout, _ := newApp(t, "GREEN_USER_01=usb-secret-key\n")
	app.Paths = pathsFromRoot(moduleDir(t))
	app.EnsureMSI = func(string) (string, bool) { return "", false }
	dest := filepath.Join(tmp, "usb")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	a := *app
	a.Paths.KeysPath = filepath.Join(tmp, "keys", KeysName)
	if err := os.MkdirAll(filepath.Dir(a.Paths.KeysPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(a.Paths.KeysPath, []byte("GREEN_USER_01=usb-secret-key\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := a.USB(dest); err != nil {
		t.Fatal(err)
	}
	payload := filepath.Join(dest, USBPayloadDir)
	for _, name := range []string{KeysName, WindowsPS1Name, WindowsCMDName, WindowsReadmeName} {
		if _, err := os.Stat(filepath.Join(payload, name)); err != nil {
			t.Fatalf("payload missing %s: %v", name, err)
		}
	}
	envText, err := os.ReadFile(filepath.Join(payload, KeysName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(envText), "usb-secret-key") {
		t.Fatal("keys file was not copied")
	}
	ps1Text, err := os.ReadFile(filepath.Join(payload, WindowsPS1Name))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(ps1Text), "usb-secret-key") || strings.Contains(stdout.String(), "usb-secret-key") {
		t.Fatal("the key leaked into the ps1 or stdout")
	}
	if !strings.Contains(stdout.String(), "wrote ") {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

// CommandTests.test_usb_non_tty_requires_dest
func TestUSBNonTTYRequiresDest(t *testing.T) {
	app, _, _, _ := newApp(t, "GREEN_USER_01=usb-secret-key\n")
	err := app.USB("")
	if err == nil || err.Error() != "--dest is required when stdin is not a TTY" {
		t.Fatalf("error = %v", err)
	}
}

// CommandTests.test_list_prints_names_only
func TestListPrintsNamesOnly(t *testing.T) {
	app, _, stdout, _ := newApp(t, "GREEN_USER_01=hidden-secret\nGREEN_ADMIN_PC=other\n")
	if err := app.List(); err != nil {
		t.Fatal(err)
	}
	if got, want := stdout.String(), "GREEN_USER_01\nGREEN_ADMIN_PC\n"; got != want {
		t.Fatalf("list = %q, want %q", got, want)
	}
	if strings.Contains(stdout.String(), "hidden-secret") {
		t.Fatal("list printed a key value")
	}
}

// CommandTests.test_main_help_and_missing_command
func TestParseHelpAndMissingCommand(t *testing.T) {
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	if got := Parse([]string{"--help"}, stdout, stderr); !got.Handled || got.Exit != 0 {
		t.Fatalf("--help = %#v", got)
	}
	if strings.TrimSuffix(stdout.String(), "\n") != topHelp {
		t.Fatalf("help text = %q", stdout.String())
	}
	if !strings.HasSuffix(stdout.String(), "  usb requires --dest.\n") {
		t.Fatalf("help text does not end with the epilog: %q", stdout.String())
	}
	stdout.Reset()
	if got := Parse(nil, stdout, stderr); !got.Handled || got.Exit != 2 {
		t.Fatalf("no args = %#v", got)
	}
	if stdout.Len() != 0 || strings.TrimSuffix(stderr.String(), "\n") != topHelp {
		t.Fatalf("no args wrote stdout %q stderr %q", stdout.String(), stderr.String())
	}
	// argparse diagnostics: usage line, then the prog-prefixed error.
	stderr.Reset()
	got := Parse([]string{"bogus"}, stdout, stderr)
	want := topUsage + "\nnetbird-setup: error: argument command: invalid choice: 'bogus' " +
		"(choose from 'issue', 'usb', 'list', 'employees')\n"
	if !got.Handled || got.Exit != 2 || stderr.String() != want {
		t.Fatalf("invalid choice = %#v, stderr %q", got, stderr.String())
	}
	stderr.Reset()
	Parse([]string{"employees"}, stdout, stderr)
	if !strings.HasSuffix(stderr.String(), "employees: error: the following arguments are required: --roster\n") {
		t.Fatalf("missing roster stderr = %q", stderr.String())
	}
	stderr.Reset()
	Parse([]string{"issue", "a", "b"}, stdout, stderr)
	if !strings.HasSuffix(stderr.String(), "netbird-setup: error: unrecognized arguments: b\n") {
		t.Fatalf("extra positional stderr = %q", stderr.String())
	}
	// `--dest -h` is a missing value, not help: argparse reads -h as an option.
	stdout.Reset()
	stderr.Reset()
	if got := Parse([]string{"usb", "--dest", "-h"}, stdout, stderr); !got.Handled ||
		got.Exit != 2 || stdout.Len() != 0 ||
		!strings.HasSuffix(stderr.String(), "usb: error: argument --dest: expected one argument\n") {
		t.Fatalf("usb --dest -h = %#v, stderr %q", got, stderr.String())
	}
}

// CommandTests.test_load_config_requires_pat_only_for_issue
func TestLoadConfigRequiresPATOnlyForIssue(t *testing.T) {
	tmp := t.TempDir()
	paths := pathsFromRoot(filepath.Join(tmp, "netbird"))
	empty := func(string) string { return "" }
	if _, err := loadConfig(empty, paths, paths.KeysPath, true); err == nil ||
		err.Error() != "NETBIRD_API_KEY is required; copy .env.netbird.example to .env.netbird and set the PAT" {
		t.Fatalf("error = %v", err)
	}
	config, err := loadConfig(empty, paths, paths.KeysPath, false)
	if err != nil {
		t.Fatal(err)
	}
	if config.ManagementURL != DefaultManagementURL || config.AutoGroup != DefaultAutoGroup {
		t.Fatalf("config = %#v", config)
	}
}

// CreateKeyTests.test_posts_one_off_employee_key: same fake request, same asserts.
func TestCreateSetupKeyPort(t *testing.T) {
	type call struct {
		method, path string
		body         any
	}
	var calls []call
	request := func(method, path string, body any) (any, error) {
		calls = append(calls, call{method, path, body})
		if strings.HasPrefix(path, "/api/groups") {
			return []any{map[string]any{"id": "grp1", "name": "employees"}}, nil
		}
		return map[string]any{"key": "minted-secret"}, nil
	}
	config := Config{APIKey: "pat", ManagementURL: DefaultManagementURL, AutoGroup: "employees"}
	key, err := createSetupKey(config, "GREEN_USER_01", request)
	if err != nil || key != "minted-secret" {
		t.Fatalf("key = %q, %v", key, err)
	}
	if len(calls) != 2 || calls[0].method != "GET" || calls[1].method != "POST" ||
		calls[1].path != "/api/setup-keys" {
		t.Fatalf("calls = %#v", calls)
	}
	posted, ok := calls[1].body.(setupKeyBody)
	if !ok {
		t.Fatalf("body type = %T", calls[1].body)
	}
	if posted.Type != "one-off" || posted.UsageLimit != 1 || posted.ExpiresIn != 604800 ||
		len(posted.AutoGroups) != 1 || posted.AutoGroups[0] != "grp1" || posted.Ephemeral {
		t.Fatalf("posted = %#v", posted)
	}
	if got, want := calls[0].path, "/api/groups?name=employees"; got != want {
		t.Fatalf("first path = %q, want %q", got, want)
	}
}

// The HTTP layer: request shape, headers, and the original's error texts.
func TestAPIClientRequestShape(t *testing.T) {
	var seen *http.Request
	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r
		body, _ = io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/api/groups":
			if r.URL.Query().Get("name") == "" {
				if _, err := w.Write([]byte(`[{"id":"grp1","name":"employees"}]`)); err != nil {
					t.Error(err)
				}
				return
			}
			_, _ = w.Write([]byte(`[{"id":"grp1","name":"employees"}]`))
		case "/api/setup-keys":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"key":"minted-secret"}`))
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer server.Close()

	config := Config{APIKey: "pat-token", ManagementURL: server.URL, AutoGroup: "employees"}
	key, err := createSetupKey(config, "GREEN_USER_01", defaultRequest(config))
	if err != nil || key != "minted-secret" {
		t.Fatalf("key = %q, %v", key, err)
	}
	if seen.Method != http.MethodPost {
		t.Fatalf("method = %s", seen.Method)
	}
	if got := seen.Header.Get("Authorization"); got != "Token pat-token" {
		t.Fatalf("Authorization = %q", got)
	}
	if got := seen.Header.Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := seen.Header.Get("Accept"); got != "application/json" {
		t.Fatalf("Accept = %q", got)
	}
	if got := seen.Header.Get("Accept-Encoding"); got != "identity" {
		t.Fatalf("Accept-Encoding = %q, want identity (http.client's default)", got)
	}
	// json.dumps separators, key order as in the original's dict.
	want := `{"name": "GREEN_USER_01", "type": "one-off", "expires_in": 604800, ` +
		`"auto_groups": ["grp1"], "usage_limit": 1, "ephemeral": false}`
	if string(body) != want {
		t.Fatalf("body = %s\nwant   %s", body, want)
	}
}

// pythonJSON must reproduce json.dumps: separators, order, ensure_ascii.
func TestPythonJSON(t *testing.T) {
	body := setupKeyBody{Name: "GREEN_USER_01", Type: "one-off", ExpiresIn: 604800,
		AutoGroups: []string{"grp1"}, UsageLimit: 1}
	got, err := pythonJSON(body)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"name": "GREEN_USER_01", "type": "one-off", "expires_in": 604800, ` +
		`"auto_groups": ["grp1"], "usage_limit": 1, "ephemeral": false}`
	if string(got) != want {
		t.Fatalf("pythonJSON = %s\nwant         %s", got, want)
	}
	// Nested object, empty list, and ensure_ascii escaping.
	got, err = pythonJSON(map[string]any{"k": "한\"\\\n\t\x01", "a": []any{}, "z": nil})
	if err != nil {
		t.Fatal(err)
	}
	want = `{"a": [], "k": "\ud55c\"\\\n\t\u0001", "z": null}`
	if string(got) != want {
		t.Fatalf("pythonJSON = %s\nwant         %s", got, want)
	}
}

func TestAPIClientErrorTexts(t *testing.T) {
	cases := []struct {
		status int
		body   string
		want   string
	}{
		{401, "", "NetBird API token invalid (401)"},
		{500, "", "NetBird API GET /api/groups failed (500)"},
		{200, "{not json", "NetBird API returned invalid JSON"},
	}
	for _, tc := range cases {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		}))
		client := newAPIClient(server.URL, "pat")
		_, err := client.request("GET", "/api/groups", nil)
		server.Close()
		if err == nil || err.Error() != tc.want {
			t.Fatalf("status %d error = %v, want %q", tc.status, err, tc.want)
		}
	}
	// A refused connection is urllib's URLError path.
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := server.URL
	server.Close()
	if _, err := newAPIClient(url, "pat").request("GET", "/api/groups", nil); err == nil ||
		err.Error() != "NetBird API request failed" {
		t.Fatalf("connection error = %v", err)
	}
}

// urllib follows 308 (it is in HTTPRedirectHandler's set) and follows ten
// redirects; the eleventh is reported as a failed request.
func TestAPIClientRedirects(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[]`))
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/api/groups", http.StatusPermanentRedirect)
	}))
	defer server.Close()
	payload, err := newAPIClient(server.URL, "pat").request("GET", "/api/groups", nil)
	if err != nil {
		t.Fatalf("308 error = %v, want followed", err)
	}
	if groups, ok := payload.([]any); !ok || len(groups) != 0 {
		t.Fatalf("308 payload = %#v", payload)
	}

	// A chain of 10 redirects is followed, 11 is not (urllib's max_redirections).
	var hop *httptest.Server
	hop = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := 0
		if _, err := fmt.Sscanf(r.URL.Query().Get("n"), "%d", &n); err != nil {
			t.Errorf("hop: %v", err)
		}
		if n == 0 {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		http.Redirect(w, r, fmt.Sprintf("%s/?n=%d", hop.URL, n-1), http.StatusFound)
	}))
	defer hop.Close()
	for _, tc := range []struct {
		hops int
		fail bool
	}{{10, false}, {11, true}} {
		_, err := newAPIClient(hop.URL, "pat").request("GET", fmt.Sprintf("/?n=%d", tc.hops), nil)
		if tc.fail {
			if err == nil || err.Error() != fmt.Sprintf("NetBird API GET /?n=%d failed (302)", tc.hops) {
				t.Fatalf("%d hops error = %v, want failed (302)", tc.hops, err)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%d hops error = %v, want followed", tc.hops, err)
		}
	}
}

// EmployeeRosterTests.test_employees_mints_missing_only
func TestEmployeesMintsMissingOnly(t *testing.T) {
	app, tmp, stdout, _ := newApp(t, "")
	keysPath := filepath.Join(tmp, "netbird-employees.env")
	if err := os.WriteFile(keysPath, []byte("GREEN_A_PC=already\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	roster := map[string]any{
		"keys_path": keysPath,
		"people":    []any{map[string]any{"email": "a@example.com", "pc": "GREEN_A_PC", "phone": "GREEN_A_PHONE"}},
	}
	encoded, err := json.Marshal(roster)
	if err != nil {
		t.Fatal(err)
	}
	rosterPath := filepath.Join(tmp, "roster.json")
	if err := os.WriteFile(rosterPath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	app.Create = func(_ Config, name string) (string, error) { return "secret-" + name, nil }
	if err := app.Employees(rosterPath, "", true); err != nil {
		t.Fatal(err)
	}
	stored := loadEnvFile(keysPath)
	if stored["GREEN_A_PC"] != "already" || stored["GREEN_A_PHONE"] != "secret-GREEN_A_PHONE" {
		t.Fatalf("stored = %#v", stored)
	}
	if strings.Contains(stdout.String(), "secret-GREEN_A_PHONE") {
		t.Fatalf("stdout leaked a key: %q", stdout.String())
	}
	if !strings.Contains(stdout.String(), "CHANGE minted GREEN_A_PHONE") {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

// EmployeeRosterTests.test_roster_has_eight_waiting_keys, when the roster exists.
func TestRosterEightWaitingKeys(t *testing.T) {
	path := filepath.Join(moduleDir(t), "..", "init-server", "profiles", "ovh-vps.employees.example.json")
	if _, err := os.Stat(path); err != nil {
		t.Skip("example roster not present")
	}
	names, keysPath, err := loadEmployeeRoster(pathsFromRoot(moduleDir(t)), path)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 8 {
		t.Fatalf("roster names = %d, want 8: %v", len(names), names)
	}
	want := map[string]bool{"EXAMPLE_ADMIN_PC": true, "EXAMPLE_MANAGER_01_PHONE": true}
	for _, name := range names {
		delete(want, name)
	}
	if len(want) != 0 {
		t.Fatalf("roster missing %v", want)
	}
	if keysPath != filepath.Join(moduleDir(t), KeysName) {
		t.Fatalf("keysPath = %q", keysPath)
	}
}

// The picker seams the commands use: resolve_name via a picker and via prompt.
func TestResolveNameUsesPickerAndPrompt(t *testing.T) {
	app, _, errOut, _ := newApp(t, "")
	app.InTTY, app.ErrTTY = true, true
	app.Pick = func(_ string, choices []ui.Choice) (ui.Choice, bool, error) {
		if len(choices) != 2 || choices[1].ID != "GREEN_B" {
			t.Fatalf("choices = %#v", choices)
		}
		return choices[1], true, nil
	}
	name, err := app.resolveName("", []string{"GREEN_A", "GREEN_B"})
	if err != nil || name != "GREEN_B" {
		t.Fatalf("resolveName = %q, %v", name, err)
	}
	app.Prompt = func() (string, error) { return " green_typed_01 ", nil }
	name, err = app.resolveName("", nil)
	if err != nil || name != "GREEN_TYPED_01" {
		t.Fatalf("prompted name = %q, %v", name, err)
	}
	if errOut.Len() != 0 {
		t.Fatalf("resolveName wrote stderr: %q", errOut.String())
	}
	app.InTTY, app.ErrTTY = false, false
	if _, err := app.resolveName("", []string{"GREEN_A"}); err == nil ||
		err.Error() != "NAME is required when stdin is not a TTY" {
		t.Fatalf("non-tty error = %v", err)
	}
}
