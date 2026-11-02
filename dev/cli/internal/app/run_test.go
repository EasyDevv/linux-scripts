package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFindsExecutableOnPathOnly(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "aws")
	if err := os.WriteFile(exe, []byte("#!/bin/sh\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(exe, 0o755); err != nil {
		t.Fatal(err)
	}
	plain := filepath.Join(dir, "creem")
	if err := os.WriteFile(plain, []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := dir
	if !exeInPath("aws", &path) {
		t.Fatal("aws should be on PATH")
	}
	if exeInPath("creem", &path) {
		t.Fatal("non-executable creem")
	}
	if exeInPath("missing", &path) {
		t.Fatal("missing")
	}
	if exeInPath("aws/dist/aws", &path) {
		t.Fatal("slash in exe")
	}
}

func TestListJSONUsesManifestVersionOrNull(t *testing.T) {
	manifest, err := LoadPath(seedToolsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	rows := listRows(&manifest, nil)
	if len(rows) != 11 {
		t.Fatalf("rows = %d, want 11", len(rows))
	}
	if rows[0].Version == nil || *rows[0].Version != "0.5.17" {
		t.Fatalf("rows[0].version = %v", rows[0].Version)
	}
	if rows[0].Installed {
		t.Fatal("rows[0] installed")
	}
	var aws *listRow
	for i := range rows {
		if rows[i].Name == "aws" {
			aws = &rows[i]
			break
		}
	}
	if aws == nil {
		t.Fatal("aws missing")
	}
	if aws.Method != "vendor" {
		t.Fatalf("aws method = %s", aws.Method)
	}
	if aws.Version != nil {
		t.Fatalf("aws version = %v, want null", aws.Version)
	}
	text, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), `"version":null`) {
		t.Fatalf("json missing null version: %s", text)
	}
}

func TestFailuresKeepGoingAndReportTheHeaviestCode(t *testing.T) {
	var got failures
	got.record("a", os.ErrInvalid)
	got.record("b", blockedPrerelease("1.0.0-beta.1"))
	err := got.finish()
	if err == nil {
		t.Fatal("expected error")
	}
	if ExitCode(err) != ExitBlocked {
		t.Fatalf("code = %d, want %d (%v)", ExitCode(err), ExitBlocked, err)
	}
	if !strings.Contains(err.Error(), "2개") {
		t.Fatalf("%v", err)
	}
	if err := (failures{}).finish(); err != nil {
		t.Fatal(err)
	}
}

func TestPickerKeysMapToActions(t *testing.T) {
	assertAction(t, "i", CommandInstall, false, true)
	assertAction(t, "x", CommandRemove, false, true)
	assertAction(t, "c", CommandUpdate, true, true)
	assertAction(t, "u", CommandUpdate, false, true)
	assertAction(t, "\r", 0, false, false)
}

func assertAction(t *testing.T, key string, want Command, wantCheck, wantOK bool) {
	t.Helper()
	got, check, ok := actionForKey(key)
	if ok != wantOK || (wantOK && (got != want || check != wantCheck)) {
		t.Fatalf("actionForKey(%q) = %v %v %v, want %v %v %v", key, got, check, ok, want, wantCheck, wantOK)
	}
}

func TestPickerGroupsToolsByCategoryWithInstallState(t *testing.T) {
	manifest, err := LoadPath(seedToolsPath(t))
	if err != nil {
		t.Fatal(err)
	}
	installed := map[string]string{"creem": "0.9.0"}
	sections := pickerSections(manifest.Tools, installed)
	titles := make([]string, 0, len(sections))
	total := 0
	for _, section := range sections {
		title := section.title
		if i := strings.IndexByte(title, ' '); i >= 0 {
			title = title[:i]
		}
		titles = append(titles, title)
		total += len(section.choices)
	}
	want := []string{"cloud", "payment", "database", "ai", "social", "security"}
	if strings.Join(titles, ",") != strings.Join(want, ",") {
		t.Fatalf("titles = %v", titles)
	}
	if total != len(manifest.Tools) {
		t.Fatalf("choices = %d, tools = %d", total, len(manifest.Tools))
	}
	payment := sections[1]
	if payment.choices[0].label != "creem" || payment.choices[0].note != "설치됨 0.9.0" {
		t.Fatalf("payment[0] = %+v", payment.choices[0])
	}
	cloud := sections[0]
	found := false
	for _, choice := range cloud.choices {
		if choice.label == "aws" && strings.Contains(choice.note, "pending") {
			found = true
		}
	}
	if !found {
		t.Fatalf("aws pending missing in %+v", cloud.choices)
	}
}

func TestPickerActionsMapToInstallRemoveAndUpdateVariants(t *testing.T) {
	if len(actions) != 4 {
		t.Fatalf("actions = %d", len(actions))
	}
	want := []actionSpec{
		{"설치", CommandInstall, false},
		{"삭제", CommandRemove, false},
		{"업데이트 확인", CommandUpdate, true},
		{"업데이트", CommandUpdate, false},
	}
	for i, action := range want {
		if actions[i] != action {
			t.Fatalf("actions[%d] = %+v, want %+v", i, actions[i], action)
		}
	}
}

func TestInstallAndRemoveNeedANameAndAKnownTool(t *testing.T) {
	path := seedToolsPath(t)
	for _, command := range []Command{CommandInstall, CommandRemove} {
		err := dispatch(testOpts(command, nil), path)
		if err == nil || ExitCode(err) != ExitError || !strings.Contains(err.Error(), "사용법") {
			t.Fatalf("%v: %v", command, err)
		}
		err = dispatch(testOpts(command, []string{"no-such-tool"}), path)
		if err == nil || ExitCode(err) != ExitError || !strings.Contains(err.Error(), "tools.toml 에 없는 도구") {
			t.Fatalf("%v: %v", command, err)
		}
	}
}

func testOpts(command Command, names []string) Options {
	if names == nil {
		names = []string{}
	}
	return Options{
		Yes:     true,
		DryRun:  true,
		Names:   names,
		Command: command,
	}
}
