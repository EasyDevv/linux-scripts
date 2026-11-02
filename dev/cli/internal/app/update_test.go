package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type updateFetch struct {
	latest string
	when   string
	fail   bool
}

func (s updateFetch) GetText(url string) (string, error) {
	if s.fail {
		return "", fmt.Errorf("offline")
	}
	if strings.HasSuffix(url, "/releases/latest") {
		return fmt.Sprintf(`{"tag_name":"v%s"}`, s.latest), nil
	}
	if strings.Contains(url, "/releases/tags/") {
		return fmt.Sprintf(`{"tag_name":"v%s","published_at":"%s"}`, s.latest, s.when), nil
	}
	return "", fmt.Errorf("unexpected url %s", url)
}

func (s updateFetch) HeadLastModified(string) (*string, error) {
	if s.fail {
		return nil, fmt.Errorf("offline")
	}
	return nil, nil
}

func updateReleaseTool(t *testing.T) Tool {
	t.Helper()
	manifest, err := LoadStr("[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"lite\"\nmethod = \"release\"\nrepo = \"o/lite\"\nversion = \"1.0.0\"\nasset = \"a_{version}.tgz\"\nchecksum = \"c_{version}.txt\"\nbin = \"lite\"\n")
	if err != nil {
		t.Fatal(err)
	}
	return manifest.Tools[0]
}

func updateLockEntry(version string) LockEntry {
	return LockEntry{
		Method:  "release",
		Version: version,
		Level:   "checksum",
	}
}

func updateAt(daysAgo int) (time.Time, string) {
	now := time.Now().UTC()
	return now, formatRFC3339(now.Add(-time.Duration(daysAgo) * 24 * time.Hour))
}

func TestSameVersionIsLatest(t *testing.T) {
	now, when := updateAt(30)
	stub := updateFetch{latest: "1.0.0", when: when}
	tool := updateReleaseTool(t)
	entry := updateLockEntry("1.0.0")
	c := checkTool(&tool, &entry, stub, now, 7)
	if c.Status != "latest" {
		t.Fatalf("status %s detail %s", c.Status, c.Detail)
	}
}

func TestNewerOldEnoughIsAnUpdateAndTooNewWaits(t *testing.T) {
	now, when := updateAt(30)
	stub := updateFetch{latest: "1.1.0", when: when}
	tool := updateReleaseTool(t)
	entry := updateLockEntry("1.0.0")
	c := checkTool(&tool, &entry, stub, now, 7)
	if c.Status != "update" || c.Latest == nil || *c.Latest != "1.1.0" {
		t.Fatalf("candidate %#v", c)
	}

	now, when = updateAt(2)
	stub = updateFetch{latest: "1.1.0", when: when}
	c = checkTool(&tool, &entry, stub, now, 7)
	if c.Status != "cooldown" || !strings.Contains(c.Detail, "7일 필요") {
		t.Fatalf("candidate %#v", c)
	}
}

func TestLookupFailuresAreUnknownNotErrors(t *testing.T) {
	tool := updateReleaseTool(t)
	entry := updateLockEntry("1.0.0")
	c := checkTool(&tool, &entry, updateFetch{fail: true}, time.Now().UTC(), 7)
	if c.Status != "unknown" || !strings.Contains(c.Detail, "offline") {
		t.Fatalf("candidate %#v", c)
	}
}

func TestRollbackWithoutAPreviousVersionIsRefused(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "cli-update")
	paths := NewPaths(filepath.Join(dir, "home"), filepath.Join(dir, "state"), "proto")
	lock := LockFile{Version: 1, Tools: map[string]LockEntry{}}
	lock.Tools["lite"] = updateLockEntry("1.0.0")
	if err := lock.Save(paths.LockJSON()); err != nil {
		t.Fatal(err)
	}
	env := installEnv(&paths, installYes{}, true, false)
	tool := updateReleaseTool(t)
	_, err := rollbackTool(env, &tool)
	if err == nil || !strings.Contains(err.Error(), "이전 버전") {
		t.Fatalf("err %v", err)
	}
	_ = os.RemoveAll(dir)
}
