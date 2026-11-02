package app

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func wrapTool(body string) string {
	return "[defaults]\ncooldown_days = 7\n\n[[tool]]\n" + body + "\n"
}

func releaseTool(extra string) string {
	return wrapTool("name = \"litestream\"\nmethod = \"release\"\nrepo = \"benbjohnson/litestream\"\nversion = \"0.5.17\"\nasset = \"litestream-{version}-linux-x86_64.tar.gz\"\nchecksum = \"checksums.txt\"\nbin = \"litestream\"\n" + extra)
}

func seedToolsPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller")
	}
	// internal/app/manifest_test.go → module root tools.toml (Rust CARGO_MANIFEST_DIR/tools.toml).
	return filepath.Join(filepath.Dir(file), "..", "..", "tools.toml")
}

func TestParsesSeedFile(t *testing.T) {
	manifest, err := LoadPath(seedToolsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.CooldownDays != 7 {
		t.Fatalf("cooldown_days = %d", manifest.CooldownDays)
	}
	if len(manifest.Tools) != 11 {
		t.Fatalf("tools = %d, want 11", len(manifest.Tools))
	}
	if manifest.Tools[0].Name != "litestream" {
		t.Fatalf("tools[0] = %s", manifest.Tools[0].Name)
	}
	if manifest.Tools[0].Method != MethodRelease {
		t.Fatalf("litestream method = %v", manifest.Tools[0].Method)
	}
	if manifest.Tools[1].Name != "aws" {
		t.Fatalf("tools[1] = %s", manifest.Tools[1].Name)
	}
	if manifest.Tools[1].ExeName() != "aws" {
		t.Fatalf("aws exe = %s", manifest.Tools[1].ExeName())
	}
	if manifest.Tools[1].Status != StatusPending {
		t.Fatalf("aws status = %v", manifest.Tools[1].Status)
	}
	if manifest.Tools[1].Version != nil {
		t.Fatalf("aws version = %v, want none", *manifest.Tools[1].Version)
	}
	if manifest.Tools[1].SHA256 != nil {
		t.Fatalf("aws sha256 = %v, want none", *manifest.Tools[1].SHA256)
	}
	gcloud := findTool(t, manifest, "gcloud")
	if gcloud.ExeName() != "gcloud" {
		t.Fatalf("gcloud exe = %s", gcloud.ExeName())
	}
	if gcloud.Bin == nil || *gcloud.Bin != "google-cloud-sdk/bin/gcloud" {
		t.Fatalf("gcloud bin = %v", gcloud.Bin)
	}
	ant := findTool(t, manifest, "ant")
	if ant.Method != MethodRelease {
		t.Fatalf("ant method = %v", ant.Method)
	}
	if ant.Version == nil || *ant.Version != "2.4.0" {
		t.Fatalf("ant version = %v", ant.Version)
	}
	goat := findTool(t, manifest, "goat")
	if goat.Sig == nil || *goat.Sig != "goat_{version}_checksums.txt.sig" {
		t.Fatalf("goat sig = %v", goat.Sig)
	}
	if goat.GPGFingerprint == nil || len(*goat.GPGFingerprint) != 40 {
		t.Fatalf("goat fingerprint = %v", goat.GPGFingerprint)
	}
	if findTool(t, manifest, "litestream").ExeName() != "litestream" {
		t.Fatal("litestream exe_name")
	}
}

func findTool(t *testing.T, manifest Manifest, name string) Tool {
	t.Helper()
	for _, tool := range manifest.Tools {
		if tool.Name == name {
			return tool
		}
	}
	t.Fatalf("missing tool %s", name)
	return Tool{}
}

func TestRejectsDuplicateNames(t *testing.T) {
	text := releaseTool("") + "\n[[tool]]\nname = \"litestream\"\nmethod = \"vendor\"\nurl = \"https://example.com/a\"\nbin = \"litestream\"\nversion = \"1\"\n"
	err := mustLoadErr(t, text)
	if !strings.Contains(err, "duplicate name") {
		t.Fatalf("duplicate error = %q", err)
	}
}

func TestRejectsUnknownMethod(t *testing.T) {
	err := mustLoadErr(t, wrapTool("name = \"x\"\nmethod = \"npm\"\nversion = \"1\"\n"))
	if !strings.Contains(err, "unknown method") {
		t.Fatalf("unknown method error = %q", err)
	}
}

func TestReleaseRequiresRepoVersionAssetChecksumBin(t *testing.T) {
	cases := []struct {
		field string
		body  string
	}{
		{"repo", "name = \"x\"\nmethod = \"release\"\nversion = \"1\"\nasset = \"a\"\nchecksum = \"c\"\nbin = \"x\"\n"},
		{"version", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nasset = \"a\"\nchecksum = \"c\"\nbin = \"x\"\n"},
		{"asset", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nversion = \"1\"\nchecksum = \"c\"\nbin = \"x\"\n"},
		{"checksum", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nversion = \"1\"\nasset = \"a\"\nbin = \"x\"\n"},
		{"bin", "name = \"x\"\nmethod = \"release\"\nrepo = \"o/r\"\nversion = \"1\"\nasset = \"a\"\nchecksum = \"c\"\n"},
	}
	for _, tc := range cases {
		err := mustLoadErr(t, wrapTool(tc.body))
		if !strings.Contains(err, "missing "+tc.field) {
			t.Fatalf("%s: %s", tc.field, err)
		}
	}
}

func TestVendorRequiresUrlAndBin(t *testing.T) {
	missingURL := mustLoadErr(t, wrapTool("name = \"aws\"\nmethod = \"vendor\"\nbin = \"aws\"\nversion = \"1\"\n"))
	if !strings.Contains(missingURL, "missing url") {
		t.Fatalf("missing url: %s", missingURL)
	}
	missingBin := mustLoadErr(t, wrapTool("name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nversion = \"1\"\n"))
	if !strings.Contains(missingBin, "missing bin") {
		t.Fatalf("missing bin: %s", missingBin)
	}
}

func TestBunRequiresPackageAndVersion(t *testing.T) {
	missingPackage := mustLoadErr(t, wrapTool("name = \"cf\"\nmethod = \"bun\"\nversion = \"1\"\n"))
	if !strings.Contains(missingPackage, "missing package") {
		t.Fatalf("missing package: %s", missingPackage)
	}
	missingVersion := mustLoadErr(t, wrapTool("name = \"cf\"\nmethod = \"bun\"\npackage = \"cf\"\n"))
	if !strings.Contains(missingVersion, "missing version") {
		t.Fatalf("missing version: %s", missingVersion)
	}
}

func TestGoRequiresModuleAndVersion(t *testing.T) {
	missingModule := mustLoadErr(t, wrapTool("name = \"ant\"\nmethod = \"go\"\nversion = \"1\"\n"))
	if !strings.Contains(missingModule, "missing module") {
		t.Fatalf("missing module: %s", missingModule)
	}
	missingVersion := mustLoadErr(t, wrapTool("name = \"ant\"\nmethod = \"go\"\nmodule = \"github.com/example/ant\"\n"))
	if !strings.Contains(missingVersion, "missing version") {
		t.Fatalf("missing version: %s", missingVersion)
	}
}

func TestCargoRequiresPackageAndVersion(t *testing.T) {
	missingPackage := mustLoadErr(t, wrapTool("name = \"toy\"\nmethod = \"cargo\"\nversion = \"1\"\n"))
	if !strings.Contains(missingPackage, "missing package") {
		t.Fatalf("missing package: %s", missingPackage)
	}
	missingVersion := mustLoadErr(t, wrapTool("name = \"toy\"\nmethod = \"cargo\"\npackage = \"toy\"\n"))
	if !strings.Contains(missingVersion, "missing version") {
		t.Fatalf("missing version: %s", missingVersion)
	}
}

func TestNonPendingRequiresVersion(t *testing.T) {
	err := mustLoadErr(t, wrapTool("name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nbin = \"aws\"\n"))
	if !strings.Contains(err, "missing version") {
		t.Fatalf("missing version: %s", err)
	}
}

func TestPendingAllowsEmptyVersionAndSha256(t *testing.T) {
	manifest, err := LoadStr(wrapTool("name = \"ant\"\nmethod = \"go\"\nmodule = \"github.com/example/ant\"\nstatus = \"pending\"\nsha256 = \"\"\nversion = \"\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Tools[0].Status != StatusPending {
		t.Fatalf("status = %v", manifest.Tools[0].Status)
	}
	if manifest.Tools[0].Version != nil {
		t.Fatalf("version = %v, want none", *manifest.Tools[0].Version)
	}
	if manifest.Tools[0].SHA256 != nil {
		t.Fatalf("sha256 = %v, want none", *manifest.Tools[0].SHA256)
	}
}

func TestRejectsNonHttpsUrl(t *testing.T) {
	for _, body := range []string{
		"name = \"aws\"\nmethod = \"vendor\"\nurl = \"http://example.com/a.zip\"\nbin = \"aws\"\nversion = \"1\"\n",
		"name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nsig_url = \"http://example.com/a.zip.sig\"\nbin = \"aws\"\nversion = \"1\"\n",
		"name = \"aws\"\nmethod = \"vendor\"\nurl = \"file:///tmp/a.zip\"\nbin = \"aws\"\nversion = \"1\"\n",
	} {
		err := mustLoadErr(t, wrapTool(body))
		if !strings.Contains(err, "must be https") {
			t.Fatalf("https error = %q", err)
		}
	}
	ok, err := LoadStr(wrapTool("name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nsig_url = \"https://example.com/a.zip.sig\"\nbin = \"aws\"\nversion = \"1\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if ok.Tools[0].URL == nil || *ok.Tools[0].URL != "https://example.com/a.zip" {
		t.Fatalf("url = %v", ok.Tools[0].URL)
	}
}

func TestExeDefaultsToName(t *testing.T) {
	manifest, err := LoadStr(releaseTool(""))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Tools[0].ExeName() != "litestream" {
		t.Fatalf("default exe = %s", manifest.Tools[0].ExeName())
	}
	manifest, err = LoadStr(wrapTool("name = \"aws\"\nmethod = \"vendor\"\nurl = \"https://example.com/a.zip\"\nbin = \"aws/dist/aws\"\nexe = \"aws\"\nversion = \"1\"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Tools[0].ExeName() != "aws" {
		t.Fatalf("exe = %s", manifest.Tools[0].ExeName())
	}
}

func mustLoadErr(t *testing.T, text string) string {
	t.Helper()
	_, err := LoadStr(text)
	if err == nil {
		t.Fatal("LoadStr succeeded, want error")
	}
	return err.Error()
}
