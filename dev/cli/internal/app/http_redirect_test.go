package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func redirectPort(t *testing.T, srv *httptest.Server) uint16 {
	t.Helper()
	raw := srv.Listener.Addr().String()
	_, portText, ok := strings.Cut(raw, ":")
	if !ok {
		t.Fatalf("addr %q", raw)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 0 || port > 65535 {
		t.Fatalf("port %q: %v", portText, err)
	}
	return uint16(port)
}

func redirectTempDest(t *testing.T, label string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "cli-http-"+label)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "artifact.bin")
}

func TestRedirectToDisallowedHostFailsBeforeConnect(t *testing.T) {
	var blockedHits atomic.Int32
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blockedHits.Add(1)
		_, _ = w.Write([]byte("should-not-run"))
	}))
	defer blocked.Close()
	blockedPort := redirectPort(t, blocked)

	allowed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		location := fmt.Sprintf("https://127.0.0.2:%d/nope", blockedPort)
		w.Header().Set("Location", location)
		w.WriteHeader(http.StatusFound)
	}))
	defer allowed.Close()

	policy := AllowLocalhostForTests(redirectPort(t, allowed))
	httpClient, err := client(policy)
	if err != nil {
		t.Fatal(err)
	}
	dest := redirectTempDest(t, "blocked")
	err = download(httpClient, &policy, fmt.Sprintf("http://127.0.0.1:%d/file", redirectPort(t, allowed)), dest)
	if err == nil {
		t.Fatal("expected redirect to disallowed host to fail")
	}
	text := err.Error()
	if !strings.Contains(text, "host is not allowed") && !strings.Contains(text, "host blocked") {
		t.Fatalf("error = %s", text)
	}
	time.Sleep(80 * time.Millisecond)
	if blockedHits.Load() != 0 {
		t.Fatalf("blocked hits = %d", blockedHits.Load())
	}
	if _, statErr := os.Stat(dest + ".part"); !os.IsNotExist(statErr) {
		t.Fatalf(".part exists: %v", statErr)
	}
}

func TestRedirectToAllowedHostSucceeds(t *testing.T) {
	var nextHits atomic.Int32
	next := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextHits.Add(1)
		_, _ = w.Write([]byte("followed"))
	}))
	defer next.Close()

	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", fmt.Sprintf("http://127.0.0.1:%d/body", redirectPort(t, next)))
		w.WriteHeader(http.StatusFound)
	}))
	defer first.Close()

	policy := AllowLocalhostForTests(redirectPort(t, first)).AndLocalhostForTests(redirectPort(t, next))
	httpClient, err := client(policy)
	if err != nil {
		t.Fatal(err)
	}
	body, err := getText(httpClient, &policy, fmt.Sprintf("http://127.0.0.1:%d/start", redirectPort(t, first)))
	if err != nil {
		t.Fatal(err)
	}
	if body != "followed" {
		t.Fatalf("body = %q", body)
	}
	if nextHits.Load() != 1 {
		t.Fatalf("next hits = %d", nextHits.Load())
	}
}

func TestDownloadWritesPartThenRenames(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, bufrw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = bufrw.WriteString("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhel")
		_ = bufrw.Flush()
		time.Sleep(400 * time.Millisecond)
		_, _ = bufrw.WriteString("lo")
		_ = bufrw.Flush()
	}))
	defer srv.Close()

	policy := AllowLocalhostForTests(redirectPort(t, srv))
	httpClient, err := client(policy)
	if err != nil {
		t.Fatal(err)
	}
	dest := redirectTempDest(t, "part")
	part := dest + ".part"
	var seen atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 50; i++ {
			if _, statErr := os.Stat(part); statErr == nil {
				seen.Store(true)
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()
	if err := download(httpClient, &policy, fmt.Sprintf("http://127.0.0.1:%d/file", redirectPort(t, srv)), dest); err != nil {
		t.Fatal(err)
	}
	<-done
	if !seen.Load() {
		t.Fatal(".part was not observed during download")
	}
	if _, statErr := os.Stat(part); !os.IsNotExist(statErr) {
		t.Fatalf(".part still exists: %v", statErr)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Fatalf("body = %q", got)
	}
}

func TestDownload404IsAnErrorAndLeavesNoPart(t *testing.T) {
	var sawUA atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.EqualFold(r.Header.Get("User-Agent"), "cli/0.1 (+local)") {
			sawUA.Store(true)
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("missing"))
	}))
	defer srv.Close()

	policy := AllowLocalhostForTests(redirectPort(t, srv))
	httpClient, err := client(policy)
	if err != nil {
		t.Fatal(err)
	}
	dest := redirectTempDest(t, "missing")
	if err := os.WriteFile(dest, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	err = download(httpClient, &policy, fmt.Sprintf("http://127.0.0.1:%d/nope", redirectPort(t, srv)), dest)
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("error = %v", err)
	}
	if !sawUA.Load() {
		t.Fatal("missing user-agent")
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "old" {
		t.Fatalf("dest = %q", got)
	}
	if _, statErr := os.Stat(dest + ".part"); !os.IsNotExist(statErr) {
		t.Fatalf(".part exists: %v", statErr)
	}
}

func TestRedirectCapStopsAtFiveHops(t *testing.T) {
	var hits atomic.Int32
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Location", srv.URL+"/loop")
		w.WriteHeader(http.StatusFound)
	}))
	defer srv.Close()

	policy := AllowLocalhostForTests(redirectPort(t, srv))
	httpClient, err := client(policy)
	if err != nil {
		t.Fatal(err)
	}
	_, err = getText(httpClient, &policy, srv.URL+"/loop")
	if err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Fatalf("error = %v", err)
	}
	if hits.Load() != 6 {
		t.Fatalf("hits = %d", hits.Load())
	}
}

func TestLocalhostRequestDoesNotSendGithubToken(t *testing.T) {
	const marker = "cli-test-token-do-not-leak"
	t.Setenv("GITHUB_TOKEN", marker)
	var sawAuth atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sawAuth.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	policy := AllowLocalhostForTests(redirectPort(t, srv))
	httpClient, err := client(policy)
	if err != nil {
		t.Fatal(err)
	}
	value, err := getJSON(httpClient, &policy, srv.URL+"/json")
	if err != nil {
		t.Fatal(err)
	}
	obj, ok := value.(map[string]any)
	if !ok || obj["ok"] != true {
		t.Fatalf("json ok = %#v", value)
	}
	if sawAuth.Load() {
		t.Fatal("authorization sent to non-github host")
	}

	head := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Last-Modified", "Sat, 01 Jun 2024 00:00:00 GMT")
		w.WriteHeader(http.StatusOK)
	}))
	defer head.Close()
	headPolicy := AllowLocalhostForTests(redirectPort(t, head))
	headClient, err := client(headPolicy)
	if err != nil {
		t.Fatal(err)
	}
	modified, err := headLastModified(headClient, &headPolicy, head.URL+"/file")
	if err != nil {
		t.Fatal(err)
	}
	if modified == nil || *modified != "Sat, 01 Jun 2024 00:00:00 GMT" {
		t.Fatalf("last-modified = %#v", modified)
	}
}
