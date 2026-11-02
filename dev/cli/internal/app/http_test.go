package app

import (
	"strings"
	"testing"
)

func httpReleaseTool() Tool {
	tool := emptyTool(MethodRelease)
	repo := "benbjohnson/litestream"
	tool.Repo = &repo
	return tool
}

func blockedReason(t *testing.T, err error) string {
	t.Helper()
	blocked, ok := err.(*HostBlocked)
	if !ok || blocked == nil {
		t.Fatalf("got %T %v, want *HostBlocked", err, err)
	}
	return blocked.Reason
}

func TestAllowsHTTPSHostFromTheTool(t *testing.T) {
	policy := ForTool(ptrTool(httpReleaseTool()))
	for _, raw := range []string{
		"https://github.com/benbjohnson/litestream",
		"https://api.github.com/repos/benbjohnson/litestream",
		"https://objects.githubusercontent.com/a",
		"https://release-assets.githubusercontent.com/a",
		"https://github-releases.githubusercontent.com/a",
	} {
		if err := policy.CheckURL(raw); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
	}
}

func TestRejectsHTTP(t *testing.T) {
	policy := ForTool(ptrTool(httpReleaseTool()))
	err := policy.CheckURL("http://github.com/benbjohnson/litestream")
	if got := blockedReason(t, err); got != "scheme is not https" {
		t.Fatalf("reason = %q", got)
	}
}

func TestRejectsArbitraryHost(t *testing.T) {
	policy := ForTool(ptrTool(httpReleaseTool()))
	err := policy.CheckURL("https://example.com/litestream")
	if got := blockedReason(t, err); got != "host is not allowed" {
		t.Fatalf("reason = %q", got)
	}
	if !strings.Contains(err.Error(), "https://example.com/litestream") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestRejectsExplicitPort(t *testing.T) {
	policy := ForTool(ptrTool(httpReleaseTool()))
	err := policy.CheckURL("https://github.com:443/benbjohnson/litestream")
	if got := blockedReason(t, err); got != "port is not allowed" {
		t.Fatalf("reason = %q", got)
	}
}

func TestMatchesHostCaseInsensitively(t *testing.T) {
	policy := ForTool(ptrTool(httpReleaseTool()))
	if err := policy.CheckURL("https://GitHub.COM/benbjohnson/litestream"); err != nil {
		t.Fatal(err)
	}
	if err := policy.CheckURL("HTTPS://api.github.com/repos/x"); err != nil {
		t.Fatal(err)
	}
}

func TestRejectsLookalikeSuffixHost(t *testing.T) {
	policy := ForTool(ptrTool(httpReleaseTool()))
	err := policy.CheckURL("https://github.com.evil.com/repo")
	if got := blockedReason(t, err); got != "host is not allowed" {
		t.Fatalf("reason = %q", got)
	}
}

func TestRejectsUserinfoEvenWhenItLooksLikeTheHost(t *testing.T) {
	policy := ForTool(ptrTool(httpReleaseTool()))
	err := policy.CheckURL("https://github.com@evil.com/")
	if got := blockedReason(t, err); got != "userinfo is not allowed" {
		t.Fatalf("reason = %q", got)
	}
	sneaky := policy.CheckURL("https://token@github.com/benbjohnson/litestream")
	if got := blockedReason(t, sneaky); got != "userinfo is not allowed" {
		t.Fatalf("reason = %q", got)
	}
}

func TestVendorWithoutRepoAllowsOnlyURLHosts(t *testing.T) {
	tool := emptyTool(MethodVendor)
	rawURL := "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
	sigURL := "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip.sig"
	tool.URL = &rawURL
	tool.SigURL = &sigURL
	policy := ForTool(&tool)
	if len(policy.Allowed) != 1 || policy.Allowed[0] != "awscli.amazonaws.com" {
		t.Fatalf("allowed = %#v", policy.Allowed)
	}
	if err := policy.CheckURL("https://AWSCLI.AMAZONAWS.COM/awscli-exe-linux-x86_64.zip"); err != nil {
		t.Fatal(err)
	}
	if err := policy.CheckURL("https://github.com/aws/aws-cli"); err == nil {
		t.Fatal("github.com was allowed")
	}
	if err := policy.CheckURL("https://api.github.com/repos/aws/aws-cli"); err == nil {
		t.Fatal("api.github.com was allowed")
	}
	for _, host := range policy.Allowed {
		if strings.Contains(host, "github") {
			t.Fatalf("github host in allow-list: %s", host)
		}
	}
}

func TestMethodFixedHostsAndDistinctSigHost(t *testing.T) {
	goTool := emptyTool(MethodGo)
	goPolicy := ForTool(&goTool)
	if err := goPolicy.CheckURL("https://proxy.golang.org/mod/@v/v1.info"); err != nil {
		t.Fatal(err)
	}
	if err := goPolicy.CheckURL("https://sum.golang.org/lookup/mod"); err != nil {
		t.Fatal(err)
	}
	if err := goPolicy.CheckURL("https://github.com/x"); err == nil {
		t.Fatal("github.com allowed for go")
	}

	cargo := ForTool(ptrTool(emptyTool(MethodCargo)))
	if err := cargo.CheckURL("https://crates.io/api/v1/crates/serde"); err != nil {
		t.Fatal(err)
	}
	if err := cargo.CheckURL("https://static.crates.io/crates/serde/serde-1.0.0.crate"); err != nil {
		t.Fatal(err)
	}
	if err := cargo.CheckURL("https://index.crates.io/se/rd/serde"); err != nil {
		t.Fatal(err)
	}

	bun := ForTool(ptrTool(emptyTool(MethodBun)))
	if err := bun.CheckURL("https://registry.npmjs.org/cf"); err != nil {
		t.Fatal(err)
	}

	vendor := emptyTool(MethodVendor)
	rawURL := "https://dl.google.com/dl/a.tar.gz"
	sigURL := "https://example.com/a.tar.gz.sig"
	vendor.URL = &rawURL
	vendor.SigURL = &sigURL
	policy := ForTool(&vendor)
	if err := policy.CheckURL("https://dl.google.com/dl/a.tar.gz"); err != nil {
		t.Fatal(err)
	}
	if err := policy.CheckURL("https://example.com/a.tar.gz.sig"); err != nil {
		t.Fatal(err)
	}
	if err := policy.CheckURL("https://github.com/"); err == nil {
		t.Fatal("github.com allowed for vendor")
	}
}

func ptrTool(tool Tool) *Tool { return &tool }

func TestLocalhostTestExceptionIsExactPort(t *testing.T) {
	policy := AllowLocalhostForTests(9)
	if err := policy.CheckURL("http://127.0.0.1:9/file"); err != nil {
		t.Fatal(err)
	}
	if err := policy.CheckURL("http://127.0.0.1:10/file"); err == nil {
		t.Fatal("wrong port allowed")
	}
	if err := policy.CheckURL("http://localhost:9/file"); err == nil {
		t.Fatal("localhost allowed")
	}
	if err := policy.CheckURL("https://github.com/"); err == nil {
		t.Fatal("github.com allowed")
	}
	if got := blockedReason(t, policy.CheckURL("not a url")); got != "invalid url" {
		t.Fatalf("reason = %q", got)
	}
	// net/url accepts this; the url crate does not.
	if got := blockedReason(t, policy.CheckURL("https://github.com:99999/a")); got != "invalid url" {
		t.Fatalf("overflow port reason = %q", got)
	}
}

func TestInvalidTokenIsNotCopiedIntoTheError(t *testing.T) {
	marker := "cli-test-token-do-not-leak"
	t.Setenv("GITHUB_TOKEN", "bad\n"+marker)
	err := mustAuthErr(t, "https://api.github.com/repos/a/b")
	text := err.Error()
	if strings.Contains(text, marker) {
		t.Fatal("token leaked into error")
	}
	if !strings.Contains(text, "GITHUB_TOKEN") {
		t.Fatalf("error = %q", text)
	}
	value, err := authorizationFor("https://github.com/a")
	if err != nil {
		t.Fatal(err)
	}
	if value != "" {
		t.Fatal("authorization set for non-api host")
	}
}

func mustAuthErr(t *testing.T, raw string) error {
	t.Helper()
	value, err := authorizationFor(raw)
	if err == nil {
		t.Fatalf("authorizationFor(%s) = %q, want error", raw, value)
	}
	return err
}
