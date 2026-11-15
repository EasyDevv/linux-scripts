package store

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func newStore(t *testing.T) Store {
	t.Helper()
	return Store{Path: filepath.Join(t.TempDir(), "auth", "credentials.json")}
}

func put(t *testing.T, s Store, id, key string) {
	t.Helper()
	if _, err := s.Modify(id, func(*Credential) (*Credential, error) {
		return &Credential{Type: TypeAPIKey, Key: key}, nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRoundTripIsPrivate(t *testing.T) {
	s := newStore(t)
	put(t, s, "openrouter", "sk-test")
	c, ok, err := s.Read("openrouter")
	if err != nil || !ok || c.Key != "sk-test" {
		t.Fatalf("read = %+v %v %v", c, ok, err)
	}
	info, _ := os.Stat(s.Path)
	if info.Mode().Perm() != 0o600 {
		t.Errorf("file mode = %v, want 0600", info.Mode().Perm())
	}
	dir, _ := os.Stat(filepath.Dir(s.Path))
	if dir.Mode().Perm() != 0o700 {
		t.Errorf("dir mode = %v, want 0700", dir.Mode().Perm())
	}
	leftovers, _ := filepath.Glob(filepath.Join(filepath.Dir(s.Path), ".credentials-*"))
	if len(leftovers) != 0 {
		t.Errorf("temp files left behind: %v", leftovers)
	}
}

func TestMissingFileIsEmpty(t *testing.T) {
	all, err := newStore(t).List()
	if err != nil || len(all) != 0 {
		t.Fatalf("list = %v %v", all, err)
	}
}

func TestBrokenOrNewerFileIsAnErrorNotEmpty(t *testing.T) {
	s := newStore(t)
	_ = os.MkdirAll(filepath.Dir(s.Path), 0o700)
	for name, body := range map[string]string{"broken": "{", "version": `{"version":2,"credentials":{}}`} {
		_ = os.WriteFile(s.Path, []byte(body), 0o600)
		if _, err := s.List(); err == nil {
			t.Errorf("%s: want an error, got none", name)
		}
	}
}

func TestModifyNilKeepsTheEntry(t *testing.T) {
	s := newStore(t)
	put(t, s, "a", "one")
	if _, err := s.Modify("a", func(*Credential) (*Credential, error) { return nil, nil }); err != nil {
		t.Fatal(err)
	}
	if c, _, _ := s.Read("a"); c.Key != "one" {
		t.Errorf("entry changed: %+v", c)
	}
}

func TestConcurrentModifiesLoseNothing(t *testing.T) {
	s := newStore(t)
	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			put(t, s, "p"+strings.Repeat("x", i), "k")
		}()
	}
	wg.Wait()
	all, err := s.List()
	if err != nil || len(all) != 20 {
		t.Fatalf("got %d entries (%v), want 20", len(all), err)
	}
}

func TestDeleteAndInvalidID(t *testing.T) {
	s := newStore(t)
	put(t, s, "a", "k")
	if err := s.Delete("a"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("a"); err != nil {
		t.Errorf("deleting an absent entry: %v", err)
	}
	if _, err := s.Modify("../x", func(*Credential) (*Credential, error) { return nil, nil }); err == nil {
		t.Error("invalid id accepted")
	}
}

func TestExpired(t *testing.T) {
	now := time.UnixMilli(1_000)
	if (Credential{Type: TypeAPIKey}).Expired(now) {
		t.Error("an API key never expires")
	}
	if !(Credential{Type: TypeOAuth, Expires: 1_000}).Expired(now) {
		t.Error("expiry at now counts as expired")
	}
	if (Credential{Type: TypeOAuth, Expires: 1_001}).Expired(now) {
		t.Error("future expiry is not expired")
	}
}

func TestDefaultPath(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	if p, _ := DefaultPath(env(map[string]string{"AUTH_FILE": "/x/y.json"})); p != "/x/y.json" {
		t.Errorf("AUTH_FILE: %s", p)
	}
	if p, _ := DefaultPath(env(map[string]string{"XDG_CONFIG_HOME": "/cfg"})); p != "/cfg/auth/credentials.json" {
		t.Errorf("XDG: %s", p)
	}
}
