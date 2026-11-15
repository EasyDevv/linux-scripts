// Package auth resolves, stores and refreshes provider credentials on top of the store.
package auth

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"auth/internal/oauth"
	"auth/internal/store"
)

// Provider is what the tool knows about a provider id. Any other valid id still works as a
// plain API-key entry.
type Provider struct {
	ID    string
	Label string
	// Env is the shell variable `import --from-env-file` reads the key from. It is never a
	// live override: consumers read the store only, so there is one source of truth.
	Env string
	// OAuth names the sign-in flow; empty means the key is pasted.
	OAuth string
}

// Known is the registry. Order is display order.
var Known = []Provider{
	{ID: "openrouter", Label: "OpenRouter", Env: "OPENROUTER_API_KEY"},
	{ID: "opencode-go", Label: "OpenCode Go"},
	{ID: "lithosai", Label: "LithosAI"},
	{ID: "xai", Label: "xAI (Grok/X subscription)", OAuth: "xai"},
}

func Lookup(id string) (Provider, bool) {
	for _, p := range Known {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{ID: id, Label: id}, false
}

type Service struct {
	Store store.Store
	Flows map[string]oauth.Flow
	Now   func() time.Time
}

// ErrNotSignedIn means neither the environment nor the store has the provider.
var ErrNotSignedIn = errors.New("not signed in")

// Get returns a stored credential. An expired OAuth token is refreshed under the store lock,
// so concurrent callers refresh once.
func (s Service) Get(ctx context.Context, id string) (store.Credential, error) {
	c, ok, err := s.Store.Read(id)
	if err != nil {
		return store.Credential{}, err
	}
	if !ok {
		return store.Credential{}, fmt.Errorf("%s: %w; run `auth login %s`", id, ErrNotSignedIn, id)
	}
	if !c.Expired(s.Now()) {
		return c, nil
	}
	return s.Refresh(ctx, id)
}

// Refresh renews an OAuth credential that is expired. It is a no-op when another process
// already did it.
func (s Service) Refresh(ctx context.Context, id string) (store.Credential, error) {
	p, _ := Lookup(id)
	flow := s.Flows[p.OAuth]
	next, err := s.Store.Modify(id, func(cur *store.Credential) (*store.Credential, error) {
		if cur == nil {
			return nil, fmt.Errorf("%s: %w; run `auth login %s`", id, ErrNotSignedIn, id)
		}
		if cur.Type != store.TypeOAuth {
			return nil, fmt.Errorf("%s: stored credential is an API key, nothing to refresh", id)
		}
		if !cur.Expired(s.Now()) {
			return nil, nil
		}
		if flow == nil {
			return nil, fmt.Errorf("%s: no OAuth flow is known for this provider", id)
		}
		renewed, err := flow.Refresh(ctx, cur.Refresh)
		if err != nil {
			return nil, fmt.Errorf("%s: %w; run `auth login %s`", id, err, id)
		}
		return &renewed, nil
	})
	if err != nil {
		return store.Credential{}, err
	}
	return *next, nil
}

// SetKey stores an API key.
func (s Service) SetKey(id, key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("empty key")
	}
	_, err := s.Store.Modify(id, func(*store.Credential) (*store.Credential, error) {
		return &store.Credential{Type: store.TypeAPIKey, Key: key}, nil
	})
	return err
}

// Login signs in through the provider's OAuth flow and stores the result.
func (s Service) Login(ctx context.Context, id string, show func(oauth.Device)) error {
	p, _ := Lookup(id)
	flow := s.Flows[p.OAuth]
	if flow == nil {
		return fmt.Errorf("%s has no sign-in flow; use `auth set %s`", id, id)
	}
	c, err := flow.Login(ctx, show)
	if err != nil {
		return err
	}
	_, err = s.Store.Modify(id, func(*store.Credential) (*store.Credential, error) { return &c, nil })
	return err
}

// Status is one provider's row for `list`. Secrets never appear in it.
type Status struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Type    string `json:"type,omitempty"`
	Source  string `json:"source,omitempty"`
	Expired bool   `json:"expired,omitempty"`
	Known   bool   `json:"known"`
}

// List reports every known provider plus any extra stored one.
func (s Service) List() ([]Status, error) {
	stored, err := s.Store.List()
	if err != nil {
		return nil, err
	}
	var out []Status
	seen := map[string]bool{}
	for _, p := range Known {
		seen[p.ID] = true
		st := Status{ID: p.ID, Label: p.Label, Known: true}
		if c, ok := stored[p.ID]; ok {
			st.Type, st.Source, st.Expired = c.Type, "store", c.Expired(s.Now())
		}
		out = append(out, st)
	}
	var extra []string
	for id := range stored {
		if !seen[id] {
			extra = append(extra, id)
		}
	}
	sort.Strings(extra)
	for _, id := range extra {
		c := stored[id]
		out = append(out, Status{ID: id, Label: id, Type: c.Type, Source: "store", Expired: c.Expired(s.Now())})
	}
	return out, nil
}
