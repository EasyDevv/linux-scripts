// Package oauth holds the providers that sign in with a flow instead of a pasted key.
package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"auth/internal/store"
)

// Device is what the person must do to finish a device-code login.
type Device struct {
	UserCode        string
	VerificationURI string
	ExpiresIn       time.Duration
}

// Flow is a provider's sign-in and refresh.
type Flow interface {
	Login(ctx context.Context, show func(Device)) (store.Credential, error)
	Refresh(ctx context.Context, refreshToken string) (store.Credential, error)
}

// XAI is the SuperGrok / X Premium device-code flow. ClientID is the one registered for pi, the
// same app the cc-proxy refresh has always used; replace it here if the dashboard ever gets its own.
type XAI struct {
	ClientID  string
	Scope     string
	DeviceURL string
	TokenURL  string
	HTTP      *http.Client
	Now       func() time.Time
	Sleep     func(ctx context.Context, d time.Duration) error
}

const (
	refreshSkew     = 5 * time.Minute
	defaultLifetime = time.Hour
	minInterval     = time.Second
	defaultInterval = 5 * time.Second
	slowDownStep    = 5 * time.Second
)

func NewXAI() *XAI {
	return &XAI{
		ClientID:  "b1a00492-073a-47ea-816f-4c329264a828",
		Scope:     "openid profile email offline_access grok-cli:access api:access",
		DeviceURL: "https://auth.x.ai/oauth2/device/code",
		TokenURL:  "https://auth.x.ai/oauth2/token",
		HTTP:      &http.Client{Timeout: 20 * time.Second},
		Now:       time.Now,
		Sleep: func(ctx context.Context, d time.Duration) error {
			t := time.NewTimer(d)
			defer t.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-t.C:
				return nil
			}
		},
	}
}

type reply struct {
	status int
	body   map[string]any
}

func (x *XAI) post(ctx context.Context, endpoint string, form url.Values) (reply, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return reply{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := x.HTTP.Do(req)
	if err != nil {
		return reply{}, err
	}
	defer res.Body.Close()
	body := map[string]any{}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return reply{}, fmt.Errorf("xai returned invalid JSON (HTTP %d)", res.StatusCode)
	}
	return reply{status: res.StatusCode, body: body}, nil
}

func str(body map[string]any, field string) string {
	s, _ := body[field].(string)
	return s
}

func num(body map[string]any, field string) float64 {
	n, _ := body[field].(float64)
	return n
}

func failure(action string, r reply) error {
	detail := strings.Join(nonEmpty(str(r.body, "error"), str(r.body, "error_description")), ": ")
	if detail != "" {
		detail = ": " + detail
	}
	return fmt.Errorf("xai %s failed (HTTP %d)%s", action, r.status, detail)
}

func nonEmpty(values ...string) []string {
	var out []string
	for _, v := range values {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

// httpsURL refuses anything but https, so a hostile response cannot make a browser open another scheme.
func httpsURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return "", errors.New("untrusted verification URI in xai response")
	}
	return u.String(), nil
}

func (x *XAI) credential(body map[string]any, previousRefresh string) (store.Credential, error) {
	access := str(body, "access_token")
	if access == "" {
		return store.Credential{}, errors.New("xai response has no access_token")
	}
	refresh := str(body, "refresh_token")
	if refresh == "" {
		refresh = previousRefresh
	}
	if refresh == "" {
		return store.Credential{}, errors.New("xai response has no refresh_token")
	}
	life := defaultLifetime
	if n := num(body, "expires_in"); n > 0 {
		life = time.Duration(n * float64(time.Second))
	}
	return store.Credential{
		Type:    store.TypeOAuth,
		Access:  access,
		Refresh: refresh,
		Expires: x.Now().Add(life - refreshSkew).UnixMilli(),
	}, nil
}

// Login runs the device-code flow: show the code, then poll until the person approves it.
func (x *XAI) Login(ctx context.Context, show func(Device)) (store.Credential, error) {
	r, err := x.post(ctx, x.DeviceURL, url.Values{"client_id": {x.ClientID}, "scope": {x.Scope}, "referrer": {"pi"}})
	if err != nil {
		return store.Credential{}, err
	}
	if r.status < 200 || r.status > 299 {
		return store.Credential{}, failure("device authorization", r)
	}
	deviceCode, userCode := str(r.body, "device_code"), str(r.body, "user_code")
	if deviceCode == "" || userCode == "" {
		return store.Credential{}, errors.New("xai device response is missing a code")
	}
	uri := str(r.body, "verification_uri_complete")
	if uri == "" {
		uri = str(r.body, "verification_uri")
	}
	if uri, err = httpsURL(uri); err != nil {
		return store.Credential{}, err
	}
	expires := time.Duration(num(r.body, "expires_in") * float64(time.Second))
	if expires <= 0 {
		return store.Credential{}, errors.New("xai device response has no expires_in")
	}
	interval := defaultInterval
	if n := num(r.body, "interval"); n > 0 {
		interval = time.Duration(n * float64(time.Second))
	}
	interval = max(interval, minInterval)
	show(Device{UserCode: userCode, VerificationURI: uri, ExpiresIn: expires})

	deadline := x.Now().Add(expires)
	slowed := false
	if err := x.Sleep(ctx, interval); err != nil {
		return store.Credential{}, err
	}
	for x.Now().Before(deadline) {
		p, err := x.post(ctx, x.TokenURL, url.Values{
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
			"client_id":   {x.ClientID},
			"device_code": {deviceCode},
		})
		if err != nil {
			return store.Credential{}, err
		}
		if p.status >= 200 && p.status <= 299 {
			return x.credential(p.body, "")
		}
		switch str(p.body, "error") {
		case "authorization_pending":
		case "slow_down":
			slowed = true
			if n := num(p.body, "interval"); n > 0 {
				interval = max(time.Duration(n*float64(time.Second)), minInterval)
			} else {
				interval += slowDownStep
			}
		case "access_denied", "authorization_denied":
			return store.Credential{}, errors.New("xai device authorization was denied")
		case "expired_token":
			return store.Credential{}, errors.New("xai device code expired")
		default:
			return store.Credential{}, failure("device token polling", p)
		}
		if err := x.Sleep(ctx, interval); err != nil {
			return store.Credential{}, err
		}
	}
	if slowed {
		return store.Credential{}, errors.New("device flow timed out after slow_down responses; check the system clock")
	}
	return store.Credential{}, errors.New("device flow timed out")
}

// Refresh trades a refresh token for a new access token. xAI may leave the refresh token
// unchanged, in which case the old one is kept.
func (x *XAI) Refresh(ctx context.Context, refreshToken string) (store.Credential, error) {
	r, err := x.post(ctx, x.TokenURL, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {x.ClientID},
		"refresh_token": {refreshToken},
	})
	if err != nil {
		return store.Credential{}, err
	}
	if r.status < 200 || r.status > 299 {
		return store.Credential{}, failure("token refresh", r)
	}
	return x.credential(r.body, refreshToken)
}
