package app

import (
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

func pluginTool(t *testing.T, body string) Tool {
	t.Helper()
	manifest, err := LoadStr("[defaults]\ncooldown_days = 7\n\n" + body)
	if err != nil {
		t.Fatal(err)
	}
	return manifest.Tools[0]
}

func TestReleasePluginUsesTheRealTagShape(t *testing.T) {
	tool := pluginTool(t, "[[tool]]\nname=\"litestream\"\nmethod=\"release\"\nrepo=\"benbjohnson/litestream\"\nversion=\"0.5.17\"\nasset=\"litestream-{version}-linux-x86_64.tar.gz\"\nchecksum=\"checksums.txt\"\nbin=\"litestream\"\n")
	text, err := pluginRender(&tool, "0.5.17", strPtr("v0.5.17"))
	if err != nil {
		t.Fatal(err)
	}
	parsed := mustPluginTOML(t, text)
	if got := tomlString(t, parsed, "install", "download-url"); got != "https://github.com/benbjohnson/litestream/releases/download/v{version}/{download_file}" {
		t.Fatalf("download-url = %q", got)
	}
	versions := tomlArray(t, parsed, "resolve", "versions")
	if len(versions) != 1 || versions[0] != "0.5.17" {
		t.Fatalf("versions = %#v", versions)
	}
	if got := tomlString(t, parsed, "platform", "linux", "checksum-file"); got != "checksums.txt" {
		t.Fatalf("checksum-file = %q", got)
	}
	if !tomlBool(t, parsed, "install", "exes", "litestream", "primary") {
		t.Fatal("primary is not true")
	}
	plain, err := pluginRender(&tool, "0.5.17", strPtr("0.5.17"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plain, "/download/{version}/{download_file}") {
		t.Fatalf("plain tag = %s", plain)
	}
}

func TestTagWithoutTheVersionIsRejected(t *testing.T) {
	tool := pluginTool(t, "[[tool]]\nname=\"x\"\nmethod=\"release\"\nrepo=\"o/r\"\nversion=\"1.0.0\"\nasset=\"a\"\nchecksum=\"c\"\nbin=\"x\"\n")
	if _, err := pluginRender(&tool, "1.0.0", strPtr("latest")); err == nil {
		t.Fatal("latest tag was accepted")
	}
	if _, err := pluginRender(&tool, "1.0.0", nil); err == nil {
		t.Fatal("missing tag was accepted")
	}
}

func TestVendorPluginKeepsTheFileNameAndExePath(t *testing.T) {
	tool := pluginTool(t, "[[tool]]\nname=\"aws\"\nmethod=\"vendor\"\nurl=\"https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip\"\nversion=\"2.39.3\"\nbin=\"aws/dist/aws\"\nexe=\"aws\"\n")
	text, err := pluginRender(&tool, "2.39.3", nil)
	if err != nil {
		t.Fatal(err)
	}
	parsed := mustPluginTOML(t, text)
	if got := tomlString(t, parsed, "install", "download-url"); got != "https://awscli.amazonaws.com/{download_file}" {
		t.Fatalf("download-url = %q", got)
	}
	if got := tomlString(t, parsed, "platform", "linux", "download-file"); got != "awscli-exe-linux-x86_64.zip" {
		t.Fatalf("download-file = %q", got)
	}
	if got := tomlString(t, parsed, "platform", "linux", "exe-path"); got != "aws/dist/aws" {
		t.Fatalf("exe-path = %q", got)
	}
}

func TestProtolockHashHandlesPlainAndGpgRecords(t *testing.T) {
	hash := "cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d"
	text := "[[tools.lite]]\nos=\"linux\"\nspec=\"1\"\nversion=\"1.0.0\"\nchecksum=\"sha256:" + hash + "\"\n\n[[tools.aws]]\nversion=\"2\"\nchecksum=\"gpg:ABCD:sha256:" + hash + "\"\n\n[[tools.nohash]]\nversion=\"3\"\n"
	if got, ok := protolockSha256(text, "lite", "1.0.0"); !ok || got != hash {
		t.Fatalf("lite = %q %v", got, ok)
	}
	if got, ok := protolockSha256(text, "aws", "2"); !ok || got != hash {
		t.Fatalf("aws = %q %v", got, ok)
	}
	if _, ok := protolockSha256(text, "lite", "9"); ok {
		t.Fatal("missing version returned a hash")
	}
	if _, ok := protolockSha256(text, "nohash", "3"); ok {
		t.Fatal("missing checksum returned a hash")
	}
	if _, ok := protolockSha256("not toml [[", "lite", "1"); ok {
		t.Fatal("invalid toml returned a hash")
	}
}

func mustPluginTOML(t *testing.T, text string) map[string]any {
	t.Helper()
	var parsed map[string]any
	if err := toml.Unmarshal([]byte(text), &parsed); err != nil {
		t.Fatalf("parse plugin: %v\n%s", err, text)
	}
	return parsed
}

func tomlString(t *testing.T, root map[string]any, path ...string) string {
	t.Helper()
	value := tomlWalk(t, root, path...)
	text, ok := value.(string)
	if !ok {
		t.Fatalf("%s = %#v", strings.Join(path, "."), value)
	}
	return text
}

func tomlBool(t *testing.T, root map[string]any, path ...string) bool {
	t.Helper()
	value := tomlWalk(t, root, path...)
	flag, ok := value.(bool)
	if !ok {
		t.Fatalf("%s = %#v", strings.Join(path, "."), value)
	}
	return flag
}

func tomlArray(t *testing.T, root map[string]any, path ...string) []string {
	t.Helper()
	value := tomlWalk(t, root, path...)
	switch items := value.(type) {
	case []any:
		out := make([]string, len(items))
		for i, item := range items {
			text, ok := item.(string)
			if !ok {
				t.Fatalf("%s[%d] = %#v", strings.Join(path, "."), i, item)
			}
			out[i] = text
		}
		return out
	default:
		t.Fatalf("%s = %#v", strings.Join(path, "."), value)
		return nil
	}
}

func tomlWalk(t *testing.T, root map[string]any, path ...string) any {
	t.Helper()
	var current any = root
	for _, key := range path {
		obj, ok := current.(map[string]any)
		if !ok {
			t.Fatalf("walk %s: %#v", strings.Join(path, "."), current)
		}
		current, ok = obj[key]
		if !ok {
			t.Fatalf("missing %s", strings.Join(path, "."))
		}
	}
	return current
}
