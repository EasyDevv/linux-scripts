package oauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var fixedNow = time.UnixMilli(1_000_000)

func flow(t *testing.T, handler http.HandlerFunc) *XAI {
	t.Helper()
	srv := httptest.NewTLSServer(handler)
	t.Cleanup(srv.Close)
	x := NewXAI()
	x.DeviceURL = srv.URL + "/device"
	x.TokenURL = srv.URL + "/token"
	x.HTTP = srv.Client()
	x.Now = func() time.Time { return fixedNow }
	x.Sleep = func(context.Context, time.Duration) error { return nil }
	return x
}

func respond(w http.ResponseWriter, status int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func device(uri string) map[string]any {
	return map[string]any{"device_code": "dc", "user_code": "ABCD-1234", "verification_uri": uri, "expires_in": 600.0, "interval": 1.0}
}

func TestLoginPollsUntilApproved(t *testing.T) {
	var polls atomic.Int32
	var x *XAI
	x = flow(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if strings.HasSuffix(r.URL.Path, "/device") {
			if r.Form.Get("client_id") != x.ClientID {
				t.Errorf("client_id = %q", r.Form.Get("client_id"))
			}
			respond(w, 200, device("https://auth.example.invalid/verify"))
			return
		}
		if r.Form.Get("device_code") != "dc" {
			t.Errorf("device_code = %q", r.Form.Get("device_code"))
		}
		switch polls.Add(1) {
		case 1:
			respond(w, 400, map[string]any{"error": "authorization_pending"})
		case 2:
			respond(w, 400, map[string]any{"error": "slow_down"})
		default:
			respond(w, 200, map[string]any{"access_token": "at", "refresh_token": "rt", "expires_in": 3600.0})
		}
	})
	var shown Device
	c, err := x.Login(context.Background(), func(d Device) { shown = d })
	if err != nil {
		t.Fatal(err)
	}
	if shown.UserCode != "ABCD-1234" || shown.VerificationURI != "https://auth.example.invalid/verify" {
		t.Errorf("shown = %+v", shown)
	}
	wantExpires := fixedNow.Add(time.Hour - 5*time.Minute).UnixMilli()
	if c.Type != "oauth" || c.Access != "at" || c.Refresh != "rt" || c.Expires != wantExpires {
		t.Errorf("credential = %+v, want expires %d", c, wantExpires)
	}
}

func TestLoginFailures(t *testing.T) {
	cases := map[string]struct {
		poll map[string]any
		want string
	}{
		"denied":  {map[string]any{"error": "access_denied"}, "denied"},
		"expired": {map[string]any{"error": "expired_token"}, "expired"},
		"other":   {map[string]any{"error": "server_error", "error_description": "boom"}, "boom"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			x := flow(t, func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/device") {
					respond(w, 200, device("https://auth.example.invalid/verify"))
					return
				}
				respond(w, 400, tc.poll)
			})
			_, err := x.Login(context.Background(), func(Device) {})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestLoginRefusesANonHTTPSVerificationURI(t *testing.T) {
	x := flow(t, func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, device("file:///etc/passwd"))
	})
	if _, err := x.Login(context.Background(), func(Device) {}); err == nil {
		t.Fatal("a non-https verification URI was accepted")
	}
}

func TestRefreshKeepsTheOldRefreshTokenWhenNoneIsReturned(t *testing.T) {
	x := flow(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "old" {
			t.Errorf("form = %v", r.Form)
		}
		respond(w, 200, map[string]any{"access_token": "new-at", "expires_in": 3600.0})
	})
	c, err := x.Refresh(context.Background(), "old")
	if err != nil || c.Access != "new-at" || c.Refresh != "old" {
		t.Fatalf("refresh = %+v %v", c, err)
	}
}

func TestRefreshRejectionIsAnError(t *testing.T) {
	x := flow(t, func(w http.ResponseWriter, r *http.Request) {
		respond(w, 400, map[string]any{"error": "invalid_grant"})
	})
	if _, err := x.Refresh(context.Background(), "old"); err == nil || !strings.Contains(err.Error(), "invalid_grant") {
		t.Errorf("err = %v", err)
	}
}
