package auth

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"auth/internal/oauth"
	"auth/internal/store"
)

var now = time.UnixMilli(5_000_000)

type fakeFlow struct {
	refreshes atomic.Int32
	err       error
}

func (f *fakeFlow) Login(_ context.Context, show func(oauth.Device)) (store.Credential, error) {
	show(oauth.Device{UserCode: "CODE", VerificationURI: "https://auth.example.invalid"})
	return store.Credential{Type: store.TypeOAuth, Access: "login-at", Refresh: "login-rt", Expires: now.Add(time.Hour).UnixMilli()}, nil
}

func (f *fakeFlow) Refresh(_ context.Context, refresh string) (store.Credential, error) {
	f.refreshes.Add(1)
	if f.err != nil {
		return store.Credential{}, f.err
	}
	return store.Credential{Type: store.TypeOAuth, Access: "fresh-at", Refresh: refresh + "+", Expires: now.Add(time.Hour).UnixMilli()}, nil
}

func service(t *testing.T) (Service, *fakeFlow) {
	t.Helper()
	flow := &fakeFlow{}
	return Service{
		Store: store.Store{Path: filepath.Join(t.TempDir(), "credentials.json")},
		Flows: map[string]oauth.Flow{"xai": flow},
		Now:   func() time.Time { return now },
	}, flow
}

func seedXAI(t *testing.T, s Service, expires time.Time) {
	t.Helper()
	_, err := s.Store.Modify("xai", func(*store.Credential) (*store.Credential, error) {
		return &store.Credential{Type: store.TypeOAuth, Access: "old-at", Refresh: "rt", Expires: expires.UnixMilli()}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestGetFromStoreAndMissing(t *testing.T) {
	s, _ := service(t)
	_ = s.SetKey("lithosai", "k")
	if c, err := s.Get(context.Background(), "lithosai"); err != nil || c.Key != "k" {
		t.Fatalf("get = %+v %v", c, err)
	}
	_, err := s.Get(context.Background(), "nope")
	if !errors.Is(err, ErrNotSignedIn) || !strings.Contains(err.Error(), "auth login nope") {
		t.Errorf("err = %v", err)
	}
}

func TestExpiredTokenIsRefreshedAndPersisted(t *testing.T) {
	s, flow := service(t)
	seedXAI(t, s, now.Add(-time.Minute))
	c, err := s.Get(context.Background(), "xai")
	if err != nil || c.Access != "fresh-at" || c.Refresh != "rt+" {
		t.Fatalf("get = %+v %v", c, err)
	}
	stored, _, _ := s.Store.Read("xai")
	if stored.Access != "fresh-at" || flow.refreshes.Load() != 1 {
		t.Errorf("stored = %+v, refreshes = %d", stored, flow.refreshes.Load())
	}
}

func TestConcurrentGetsRefreshOnce(t *testing.T) {
	s, flow := service(t)
	seedXAI(t, s, now.Add(-time.Minute))
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if c, err := s.Get(context.Background(), "xai"); err != nil || c.Access != "fresh-at" {
				t.Errorf("get = %+v %v", c, err)
			}
		}()
	}
	wg.Wait()
	if n := flow.refreshes.Load(); n != 1 {
		t.Errorf("refreshed %d times, want 1 (a rotated token must not be spent twice)", n)
	}
}

func TestValidTokenIsNotRefreshed(t *testing.T) {
	s, flow := service(t)
	seedXAI(t, s, now.Add(time.Hour))
	if c, _ := s.Get(context.Background(), "xai"); c.Access != "old-at" || flow.refreshes.Load() != 0 {
		t.Errorf("c = %+v, refreshes = %d", c, flow.refreshes.Load())
	}
}

func TestRefreshFailureKeepsTheStoredTokenAndSaysHowToFixIt(t *testing.T) {
	s, flow := service(t)
	flow.err = errors.New("invalid_grant")
	seedXAI(t, s, now.Add(-time.Minute))
	_, err := s.Get(context.Background(), "xai")
	if err == nil || !strings.Contains(err.Error(), "auth login xai") {
		t.Errorf("err = %v", err)
	}
	if c, _, _ := s.Store.Read("xai"); c.Access != "old-at" {
		t.Errorf("stored token changed: %+v", c)
	}
}

func TestLoginStoresTheCredential(t *testing.T) {
	s, _ := service(t)
	var code string
	if err := s.Login(context.Background(), "xai", func(d oauth.Device) { code = d.UserCode }); err != nil {
		t.Fatal(err)
	}
	if c, _, _ := s.Store.Read("xai"); c.Access != "login-at" || code != "CODE" {
		t.Errorf("c = %+v code = %q", c, code)
	}
	if err := s.Login(context.Background(), "lithosai", nil); err == nil {
		t.Error("a key provider has no sign-in flow")
	}
}

func TestSetKeyRejectsEmpty(t *testing.T) {
	s, _ := service(t)
	if err := s.SetKey("lithosai", "  "); err == nil {
		t.Error("empty key accepted")
	}
}

func TestListShowsKnownProvidersWithoutSecrets(t *testing.T) {
	s, _ := service(t)
	_ = s.SetKey("custom-x", "secret-store")
	seedXAI(t, s, now.Add(-time.Minute))
	rows, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]Status{}
	for _, r := range rows {
		byID[r.ID] = r
		if strings.Contains(r.Source, "secret") {
			t.Errorf("secret leaked: %+v", r)
		}
	}
	if !byID["xai"].Expired || byID["custom-x"].Known || byID["lithosai"].Type != "" {
		t.Errorf("rows = %+v", byID)
	}
}

func TestFromPiCopiesKeysOnly(t *testing.T) {
	s, _ := service(t)
	pi := filepath.Join(t.TempDir(), "auth.json")
	_ = os.WriteFile(pi, []byte(`{
		"opencode-go": {"type":"api_key","key":"k1"},
		"lithosai":    {"type":"api-key","key":"k2"},
		"cmd":         {"type":"api_key","key":"!pass show x"},
		"xai":         {"type":"oauth","access":"a","refresh":"r","expires":1}
	}`), 0o600)
	rep, err := s.FromPi(pi, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(rep.Imported, ",") != "lithosai,opencode-go" || len(rep.Ignored) != 2 {
		t.Errorf("report = %+v", rep)
	}
	if _, ok, _ := s.Store.Read("xai"); ok {
		t.Error("OAuth entry copied without --include-oauth")
	}
	// A second run keeps what is there; --overwrite replaces it.
	_ = s.SetKey("lithosai", "mine")
	rep, _ = s.FromPi(pi, false, false)
	if c, _, _ := s.Store.Read("lithosai"); c.Key != "mine" || len(rep.Skipped) != 2 {
		t.Errorf("rep = %+v c = %+v", rep, c)
	}
	_, _ = s.FromPi(pi, false, true)
	if c, _, _ := s.Store.Read("lithosai"); c.Key != "k2" {
		t.Errorf("overwrite did not replace: %+v", c)
	}
}

func TestFromPiCanCopyOAuthOnRequest(t *testing.T) {
	s, _ := service(t)
	pi := filepath.Join(t.TempDir(), "auth.json")
	_ = os.WriteFile(pi, []byte(`{"xai":{"type":"oauth","access":"a","refresh":"r","expires":1}}`), 0o600)
	if _, err := s.FromPi(pi, true, false); err != nil {
		t.Fatal(err)
	}
	if c, ok, _ := s.Store.Read("xai"); !ok || c.Refresh != "r" {
		t.Errorf("c = %+v", c)
	}
}

func TestFromEnvFileReadsOnlyKnownVariables(t *testing.T) {
	s, _ := service(t)
	file := filepath.Join(t.TempDir(), ".env")
	_ = os.WriteFile(file, []byte("UNRELATED=nope\nexport OPENROUTER_API_KEY=\"sk-or\"\n"), 0o600)
	rep, err := s.FromEnvFile(file, false)
	if err != nil || len(rep.Imported) != 1 {
		t.Fatalf("rep = %+v %v", rep, err)
	}
	if c, _, _ := s.Store.Read("openrouter"); c.Key != "sk-or" {
		t.Errorf("c = %+v", c)
	}
	all, _ := s.Store.List()
	if len(all) != 1 {
		t.Errorf("stored %d entries, want 1", len(all))
	}
}

func TestEnvFileValue(t *testing.T) {
	text := "A=1\n  export B = 'two' \nC=\"\"\nD=x=y\n"
	for name, want := range map[string]string{"A": "1", "B": "two", "C": "", "D": "x=y", "Z": ""} {
		if got := EnvFileValue(text, name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
}
