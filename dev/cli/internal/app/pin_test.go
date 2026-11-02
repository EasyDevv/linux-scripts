package app

import "testing"

const pinSrc = "# 머리 주석\n[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"a\"\nmethod = \"vendor\"\n# 이 줄은 남아야 한다\nurl = \"https://example.com/a.zip\"\nbin = \"a\"\nstatus = \"pending\"\n\n[[tool]]\nname = \"b\"\nmethod = \"vendor\"\nurl = \"https://example.com/b.zip\"\nbin = \"b\"\nversion = \"1\"\n"

func TestPinsOneToolAndKeepsCommentsAndTheOtherTool(t *testing.T) {
	hash := stringsRepeat("a", 64)
	version := "2.0.0"
	out, err := applyPin(pinSrc, "a", hash, &version)
	if err != nil {
		t.Fatal(err)
	}
	if !stringsContains(out, "# 머리 주석") || !stringsContains(out, "# 이 줄은 남아야 한다") {
		t.Fatalf("comments dropped:\n%s", out)
	}
	if !stringsContains(out, "sha256 = \""+hash+"\"") || !stringsContains(out, "version = \"2.0.0\"") {
		t.Fatalf("pin missing:\n%s", out)
	}
	if stringsContains(out, "pending") {
		t.Fatalf("pending remained:\n%s", out)
	}
	want := "# 머리 주석\n[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"a\"\nmethod = \"vendor\"\n# 이 줄은 남아야 한다\nurl = \"https://example.com/a.zip\"\nbin = \"a\"\nsha256 = \"" + hash + "\"\nversion = \"2.0.0\"\n\n[[tool]]\nname = \"b\"\nmethod = \"vendor\"\nurl = \"https://example.com/b.zip\"\nbin = \"b\"\nversion = \"1\"\n"
	if out != want {
		t.Fatalf("toml_edit mismatch:\n%s", out)
	}
	parsed, err := LoadStr(out)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Tools[0].SHA256 == nil || *parsed.Tools[0].SHA256 != hash {
		t.Fatalf("tool a sha256 %#v", parsed.Tools[0].SHA256)
	}
	if parsed.Tools[1].SHA256 != nil {
		t.Fatalf("tool b sha256 %#v", parsed.Tools[1].SHA256)
	}
	tight := "[[tool]]\nname=\"a\"\nversion=\"1\"\nstatus=\"pending\"\n"
	replaced, err := applyPin(tight, "a", hash, &version)
	if err != nil {
		t.Fatal(err)
	}
	if !stringsContains(replaced, "version= \"2.0.0\"") {
		t.Fatalf("in-place spacing: %s", replaced)
	}
}

func TestRejectsBadHashAndUnknownTool(t *testing.T) {
	if _, err := applyPin(pinSrc, "a", "xyz", nil); err == nil {
		t.Fatal("bad hash")
	}
	if _, err := applyPin(pinSrc, "zzz", stringsRepeat("a", 64), nil); err == nil {
		t.Fatal("unknown tool")
	}
}

func stringsContains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && stringIndex(s, sub) >= 0)
}

func stringIndex(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func stringsRepeat(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}
