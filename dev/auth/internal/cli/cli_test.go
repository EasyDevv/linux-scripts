package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"auth/internal/auth"
	"auth/internal/oauth"
	"auth/internal/store"
)

type noFlow struct{}

func (noFlow) Login(context.Context, func(oauth.Device)) (store.Credential, error) {
	return store.Credential{Type: store.TypeOAuth, Access: "at", Refresh: "rt", Expires: time.Now().Add(time.Hour).UnixMilli()}, nil
}
func (noFlow) Refresh(context.Context, string) (store.Credential, error) {
	return store.Credential{}, nil
}

func run(t *testing.T, stdin string, args ...string) (code int, out, errOut string) {
	t.Helper()
	var o, e bytes.Buffer
	dir := t.TempDir()
	env := Env{
		Service: auth.Service{
			Store: store.Store{Path: filepath.Join(dir, "credentials.json")},
			Flows: map[string]oauth.Flow{"xai": noFlow{}},
			Now:   time.Now,
		},
		Stdin: strings.NewReader(stdin), Stdout: &o, Stderr: &e, Home: dir,
	}
	return Run(context.Background(), args, env), o.String(), e.String()
}

func TestHelpAndUnknown(t *testing.T) {
	if code, out, _ := run(t, "", "help"); code != 0 || !strings.Contains(out, "usage: auth") {
		t.Errorf("help: %d %q", code, out)
	}
	if code, _, _ := run(t, ""); code != 1 {
		t.Errorf("no args: %d", code)
	}
	if code, _, e := run(t, "", "nope"); code != 1 || !strings.Contains(e, "unknown command") {
		t.Errorf("unknown: %d %q", code, e)
	}
}

func TestSetThenGet(t *testing.T) {
	var o, e bytes.Buffer
	dir := t.TempDir()
	svc := auth.Service{Store: store.Store{Path: filepath.Join(dir, "c.json")}, Now: time.Now}
	mk := func(in string) Env {
		o.Reset()
		return Env{Service: svc, Stdin: strings.NewReader(in), Stdout: &o, Stderr: &e, Home: dir}
	}
	if code := Run(context.Background(), []string{"set", "openrouter"}, mk("sk-or-test\n")); code != 0 {
		t.Fatalf("set: %d %s", code, e.String())
	}
	if strings.Contains(o.String(), "sk-or-test") {
		t.Error("set echoed the key")
	}
	if code := Run(context.Background(), []string{"get", "openrouter"}, mk("")); code != 0 || strings.TrimSpace(o.String()) != "sk-or-test" {
		t.Errorf("get: %d %q", code, o.String())
	}
	if code := Run(context.Background(), []string{"get", "--json", "openrouter"}, mk("")); code != 0 {
		t.Fatal(code)
	}
	var c store.Credential
	if err := json.Unmarshal(o.Bytes(), &c); err != nil || c.Key != "sk-or-test" {
		t.Errorf("json: %v %+v", err, c)
	}
}

func TestGetMissingExitsThree(t *testing.T) {
	if code, _, e := run(t, "", "get", "openrouter"); code != 3 || !strings.Contains(e, "auth login openrouter") {
		t.Errorf("code %d %q", code, e)
	}
}

func TestSetWithoutKeyFails(t *testing.T) {
	if code, _, _ := run(t, "", "set", "openrouter"); code != 1 {
		t.Errorf("code %d", code)
	}
}

func TestLoginOAuthPrintsTheCodeAndSigns(t *testing.T) {
	if code, out, e := run(t, "", "login", "xai"); code != 0 || !strings.Contains(out, "signed in") {
		t.Errorf("login: %d %q %q", code, out, e)
	}
}

func TestProviderArgumentIsValidated(t *testing.T) {
	for _, args := range [][]string{{"get"}, {"get", "a", "b"}, {"get", "../x"}, {"logout", "Bad Id"}} {
		if code, _, _ := run(t, "", args...); code != 1 {
			t.Errorf("%v: code %d", args, code)
		}
	}
}

func TestImportNeedsExactlyOneSource(t *testing.T) {
	if code, _, _ := run(t, "", "import"); code != 1 {
		t.Errorf("code %d", code)
	}
	if code, _, _ := run(t, "", "import", "--from-pi", "--from-env-file"); code != 1 {
		t.Errorf("code %d", code)
	}
}

func TestRefreshOfAKeyIsANoOp(t *testing.T) {
	var o, e bytes.Buffer
	dir := t.TempDir()
	svc := auth.Service{Store: store.Store{Path: filepath.Join(dir, "c.json")}, Now: time.Now}
	_ = svc.SetKey("lithosai", "k")
	env := Env{Service: svc, Stdin: strings.NewReader(""), Stdout: &o, Stderr: &e, Home: dir}
	if code := Run(context.Background(), []string{"refresh", "lithosai"}, env); code != 0 {
		t.Errorf("code %d %s", code, e.String())
	}
	if code := Run(context.Background(), []string{"refresh", "xai"}, env); code != 3 {
		t.Errorf("a missing provider should exit 3, got %d", code)
	}
}
