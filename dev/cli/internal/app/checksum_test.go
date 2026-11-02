package app

import (
	"os"
	"path/filepath"
	"testing"
)

const (
	hashA     = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	hashB     = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	abcSHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
)

func TestParsesSha256sumLines(t *testing.T) {
	text := "\n# comment\r\n" + hashA + "  litestream.tar.gz\r\n" + hashB + " *goat.tar.gz\n   \n" + hashA + "    ./xurl.tar.gz\nnot-a-hash  skipped.tar.gz\n" + hashA + "  \nabc  short\n"
	rows := parseChecksums(text)
	want := [][2]string{
		{hashA, "litestream.tar.gz"},
		{hashB, "goat.tar.gz"},
		{hashA, "./xurl.tar.gz"},
	}
	if len(rows) != len(want) {
		t.Fatalf("rows %v", rows)
	}
	for i := range want {
		if rows[i] != want[i] {
			t.Fatalf("row %d: got %v want %v", i, rows[i], want[i])
		}
	}
	assertHash(t, text, "litestream.tar.gz", hashA)
	assertHash(t, text, "goat.tar.gz", hashB)
	assertHash(t, text, "xurl.tar.gz", hashA)
	assertHash(t, text, "./litestream.tar.gz", hashA)
	assertNoHash(t, text, "litestream")
	assertNoHash(t, text, "goat.tar")
	assertNoHash(t, text, "skipped.tar.gz")
}

func TestSingleHashFileIgnoresAssetName(t *testing.T) {
	text := "# pinned\r\n\r\n" + hashA + "\r\n"
	got, ok := parseSingleHash(text)
	if !ok || got != hashA {
		t.Fatalf("parseSingleHash %q %v", got, ok)
	}
	if rows := parseChecksums(text); len(rows) != 0 {
		t.Fatalf("checksum rows %v", rows)
	}
	assertHash(t, text, "anything.bin", hashA)
	if _, ok := parseSingleHash(hashA + "\n" + hashB + "\n"); ok {
		t.Fatal("two hashes should be none")
	}
	if _, ok := findHash(hashA+"  other.bin\n", "missing.bin"); ok {
		t.Fatal("missing name should be none")
	}
}

func TestVerifySha256MatchAndMismatch(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "payload")
	if err := os.WriteFile(path, []byte("abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := sha256File(path)
	if err != nil || got != abcSHA256 {
		t.Fatalf("sha256File %s %v", got, err)
	}
	if err := verifySha256(path, toUpperASCII(abcSHA256)); err != nil {
		t.Fatal(err)
	}
	err = verifySha256(path, hashA)
	mismatch, ok := err.(ChecksumMismatch)
	if !ok {
		t.Fatalf("error type %T %v", err, err)
	}
	if mismatch.Expected != hashA || mismatch.Actual != abcSHA256 {
		t.Fatalf("%+v", mismatch)
	}
}

func assertHash(t *testing.T, text, asset, want string) {
	t.Helper()
	got, ok := findHash(text, asset)
	if !ok || got != want {
		t.Fatalf("findHash %s: %q %v", asset, got, ok)
	}
}

func assertNoHash(t *testing.T, text, asset string) {
	t.Helper()
	if got, ok := findHash(text, asset); ok {
		t.Fatalf("findHash %s: %q", asset, got)
	}
}

func toUpperASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 'a' + 'A'
		}
	}
	return string(b)
}
