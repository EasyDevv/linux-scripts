package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

// fakeOverlay is an in-memory phone: it answers the overlay read scripts with the same line format
// the real ones print, and applies the writes it is given, so a test can check both the commands and
// the state they leave behind. Package names are placeholders.
type fakeOverlay struct {
	a11y   string            // the enabled_accessibility_services value
	appops map[string]string // package -> SYSTEM_ALERT_WINDOW mode
	saved  string            // /data/local/tmp/droid-overlay/saved; "" means there is no file
	window string            // `dumpsys window windows`
	log    []string
}

var (
	overlayGetRe   = regexp.MustCompile(`appops get (\S+) ` + overlayAppop)
	overlaySetRe   = regexp.MustCompile(`appops set (\S+) ` + overlayAppop + ` (\w+)`)
	overlayA11yRe  = regexp.MustCompile(`settings put secure ` + overlayA11y + ` '([^']*)'`)
	overlayDumpWin = `WINDOW MANAGER WINDOWS (dumpsys window windows)
  Window #0 Window{4f8e1c9 u0 NotificationShade}:
    mOwnerUid=1000 showForAllUsers=true package=com.android.systemui appop=NONE
    mAttrs=WM.LayoutParams{(0,0)(fillxfill) sim=#120 ty=2040 fl=#81810118 fmt=-3}
  Window #2 Window{7bd4e11 u0 com.example.chat/com.example.chat.MainActivity}:
    mOwnerUid=10200 showForAllUsers=false package=com.example.chat appop=NONE
    mAttrs=WM.LayoutParams{(0,0)(fillxfill) sim=#20 ty=1 fl=#81810118 fmt=-1}
  Window #3 Window{a1b2c3d u0 com.example.dimmer/com.example.dimmer.Overlay}:
    mOwnerUid=10321 showForAllUsers=false package=com.example.dimmer appop=SYSTEM_ALERT_WINDOW
    mAttrs=WM.LayoutParams{(0,0)(fillxfill) sim=#20 ty=2032 fl=#81810118 fmt=-3}
  Window #4 Window{bb22cc1 u0 com.samsung.android.example/com.samsung.android.example.AOD}:
    mOwnerUid=10044 showForAllUsers=true package=com.samsung.android.example appop=SYSTEM_ALERT_WINDOW
    mAttrs=WM.LayoutParams{(0,0)(fillxfill) sim=#20 ty=2038 fl=#81810118 fmt=-3}
  Window #5 Window{cc33dd2 u0 SurfaceView}:
    mOwnerUid=10456 mOwnerPackage=com.example.window appop=SYSTEM_ALERT_WINDOW
    mAttrs=WM.LayoutParams{(0,0)(fillxfill) sim=#20 ty=2036 fl=#81810118 fmt=-3}
`
)

func (f *fakeOverlay) run(_ time.Duration, args ...string) (string, error) {
	script := strings.Join(args, " ")
	f.log = append(f.log, script)
	switch {
	case strings.Contains(script, "dumpsys window windows"):
		return f.window, nil
	case strings.Contains(script, "A11Y="):
		return f.report(script), nil
	case strings.Contains(script, "cat "+overlaySaved):
		if f.saved == "" {
			return overlayMark + "\n", nil
		}
		return f.saved + overlayMark + "\n", nil
	}
	return f.apply(script), nil
}

// report answers the state read: A11Y=, one APPOPS line per package the script asks about, then the
// saved file with the SAVED prefix.
func (f *fakeOverlay) report(script string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "A11Y=%s\n", f.a11y)
	for _, m := range overlayGetRe.FindAllStringSubmatch(script, -1) {
		mode := f.appops[m[1]]
		if mode == "" {
			mode = "default"
		}
		fmt.Fprintf(&b, "APPOPS %s %s\n", m[1], mode)
	}
	if f.saved != "" {
		for _, line := range strings.Split(strings.TrimSuffix(f.saved, "\n"), "\n") {
			b.WriteString("SAVED " + line + "\n")
		}
	}
	b.WriteString(overlayMark + "\n")
	return b.String()
}

// apply runs the writes of a hide or restore script.
func (f *fakeOverlay) apply(script string) string {
	if i := strings.Index(script, "<<'"+overlayEOF+"'\n"); i >= 0 {
		body := script[i+len("<<'"+overlayEOF+"'\n"):]
		if j := strings.Index(body, overlayEOF+"\n"); j >= 0 {
			f.saved = body[:j]
		}
	}
	for _, m := range overlaySetRe.FindAllStringSubmatch(script, -1) {
		f.appops[m[1]] = m[2]
	}
	if m := overlayA11yRe.FindStringSubmatch(script); m != nil {
		f.a11y = m[1]
	}
	if strings.Contains(script, "rm -rf "+overlayDir) {
		f.saved = ""
	}
	return overlayMark + "\n"
}

// overlayOpts builds the options for `droid [--serial T] overlay ARGS`.
func overlayOpts(t *testing.T, args ...string) opts {
	t.Helper()
	cmd, o, err := command(append([]string{"--serial", "T", "--json", "overlay"}, args...))
	if err != nil || cmd != "overlay" {
		t.Fatalf("parse %q: cmd %q, err %v", args, cmd, err)
	}
	return o
}

// captureStdout runs fn with stdout captured, so the --json object can be checked.
func captureStdout(t *testing.T, fn func() error) (string, error) {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	done := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(r)
		done <- string(b)
	}()
	ferr := fn()
	w.Close()
	os.Stdout = old
	return <-done, ferr
}

func overlayJSON(t *testing.T, out string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &m); err != nil {
		t.Fatalf("not one JSON object: %q (%v)", out, err)
	}
	return m
}

func overlayList(v any) []string {
	rows, _ := v.([]any)
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		s, _ := r.(string)
		out = append(out, s)
	}
	return out
}

const (
	overlayDimmerSvc = "com.example.dimmer/.OverlayService"
	overlayKeepSvc   = "com.example.keep/.Reader"
	overlayWinPkg    = "com.example.window"
)

// phoneWithDimmer is a phone showing a dimmer window, an accessibility-overlay dimmer and a second
// accessibility service that must survive.
func phoneWithDimmer() *fakeOverlay {
	return &fakeOverlay{
		a11y:   overlayKeepSvc + ":" + overlayDimmerSvc,
		appops: map[string]string{overlayWinPkg: "allow"},
		window: overlayDumpWin,
	}
}

func TestParseOverlayPackages(t *testing.T) {
	if got := ParseOverlayPackages(overlayDumpWin); strings.Join(got, ",") != "com.example.dimmer,"+overlayWinPkg {
		t.Fatalf("packages: %v", got)
	}
	// ty=2032 (ACCESSIBILITY_OVERLAY) and mOwnerPackage= count; a plain app window and a system
	// window do not.
	if got := ParseOverlayPackages("WINDOW MANAGER WINDOWS\n  Window #0 Window{1 u0 NotificationShade}:"); len(got) != 0 {
		t.Fatalf("no overlay must give none: %v", got)
	}
	if !isSystemOverlayPkg("com.android.systemui") || !isSystemOverlayPkg("android") || isSystemOverlayPkg("com.example.a") {
		t.Fatal("system package filter")
	}
	if m := ParseAppopMode("SYSTEM_ALERT_WINDOW: allow; time=+1h2m3s\n"); m != "allow" {
		t.Fatalf("mode %q", m)
	}
	if m := ParseAppopMode("No operations.\n"); m != "default" {
		t.Fatalf("mode %q", m)
	}
}

func TestParseOverlaySaved(t *testing.T) {
	text := "a11y " + overlayDimmerSvc + ":" + overlayKeepSvc + "\n" +
		"svc " + overlayDimmerSvc + "\n" +
		"appop " + overlayWinPkg + " allow\n" +
		"appop broken line here\n" +
		"appop com.example.bad rm -rf /\n"
	s := ParseOverlaySaved(text)
	if s.A11y != overlayDimmerSvc+":"+overlayKeepSvc || len(s.Services) != 1 || len(s.Appops) != 1 || s.Appops[0].Mode != "allow" {
		t.Fatalf("%+v", s)
	}
	if s.String() != "a11y "+overlayDimmerSvc+":"+overlayKeepSvc+"\nsvc "+overlayDimmerSvc+"\nappop "+overlayWinPkg+" allow\n" {
		t.Fatalf("round trip:\n%s", s.String())
	}
	if !ParseOverlaySaved("").empty() {
		t.Fatal("nothing saved must be empty")
	}
}

func TestOverlayHideSavesThenDisables(t *testing.T) {
	f := phoneWithDimmer()
	out, err := captureStdout(t, func() error { return run("overlay", overlayOpts(t, "hide"), f.run) })
	if err != nil {
		t.Fatal(err)
	}
	want := "a11y " + overlayKeepSvc + ":" + overlayDimmerSvc + "\n" +
		"svc " + overlayDimmerSvc + "\n" +
		"appop " + overlayWinPkg + " allow\n"
	if f.saved != want {
		t.Fatalf("saved file:\n%s\nwant:\n%s", f.saved, want)
	}
	if f.a11y != overlayKeepSvc {
		t.Fatalf("a11y after hide: %q", f.a11y)
	}
	if f.appops[overlayWinPkg] != "ignore" {
		t.Fatalf("appop after hide: %q", f.appops[overlayWinPkg])
	}
	last := f.log[len(f.log)-1]
	if strings.Index(last, "<<'"+overlayEOF+"'") > strings.Index(last, "appops set "+overlayWinPkg) {
		t.Fatalf("the values must be saved before the settings change:\n%s", last)
	}
	hidden := overlayList(overlayJSON(t, out)["hidden"])
	if strings.Join(hidden, ",") != "com.example.dimmer,"+overlayWinPkg {
		t.Fatalf("hidden: %v", hidden)
	}
}

func TestOverlayHideKeepsTheFirstSave(t *testing.T) {
	f := phoneWithDimmer()
	if _, err := captureStdout(t, func() error { return run("overlay", overlayOpts(t, "hide"), f.run) }); err != nil {
		t.Fatal(err)
	}
	first := f.saved
	// The dimmer is turned back on (or a second session runs after a crash): the same hide runs.
	f.a11y = overlayKeepSvc + ":" + overlayDimmerSvc
	f.appops[overlayWinPkg] = "allow"
	f.log = nil
	if _, err := captureStdout(t, func() error { return run("overlay", overlayOpts(t, "hide"), f.run) }); err != nil {
		t.Fatal(err)
	}
	if f.saved != first {
		t.Fatalf("the second hide overwrote the first save:\n%s\nwant:\n%s", f.saved, first)
	}
	if strings.Contains(f.log[len(f.log)-1], "<<'"+overlayEOF+"'") {
		t.Fatalf("the second hide rewrote an existing saved file:\n%s", f.log[len(f.log)-1])
	}
	if f.a11y != overlayKeepSvc || f.appops[overlayWinPkg] != "ignore" {
		t.Fatalf("hide again: a11y %q, appop %q", f.a11y, f.appops[overlayWinPkg])
	}
}

func TestOverlayRestorePutsItBackExactly(t *testing.T) {
	f := phoneWithDimmer()
	if _, err := captureStdout(t, func() error { return run("overlay", overlayOpts(t, "hide"), f.run) }); err != nil {
		t.Fatal(err)
	}
	f.log = nil
	out, err := captureStdout(t, func() error { return run("overlay", overlayOpts(t, "restore"), f.run) })
	if err != nil {
		t.Fatal(err)
	}
	if f.a11y != overlayKeepSvc+":"+overlayDimmerSvc {
		t.Fatalf("a11y after restore: %q", f.a11y)
	}
	if f.appops[overlayWinPkg] != "allow" {
		t.Fatalf("appop after restore: %q", f.appops[overlayWinPkg])
	}
	if f.saved != "" {
		t.Fatalf("the saved file must be gone: %q", f.saved)
	}
	joined := strings.Join(f.log, "\n")
	for _, want := range []string{
		"settings put secure " + overlayA11y + " '" + overlayKeepSvc + ":" + overlayDimmerSvc + "'",
		"appops set " + overlayWinPkg + " " + overlayAppop + " allow",
		"rm -rf " + overlayDir,
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("restore lacks %q:\n%s", want, joined)
		}
	}
	if n, _ := overlayJSON(t, out)["restored"].(float64); int(n) != 2 {
		t.Fatalf("restored: %v", overlayJSON(t, out)["restored"])
	}
}

func TestOverlayRestoreWithoutSave(t *testing.T) {
	f := &fakeOverlay{a11y: overlayKeepSvc, appops: map[string]string{}}
	out, err := captureStdout(t, func() error { return run("overlay", overlayOpts(t, "restore"), f.run) })
	if err != nil {
		t.Fatal(err)
	}
	if n, ok := overlayJSON(t, out)["restored"].(float64); !ok || n != 0 {
		t.Fatalf("restored: %v", out)
	}
	if f.a11y != overlayKeepSvc {
		t.Fatalf("a11y touched: %q", f.a11y)
	}
	for _, l := range f.log {
		if strings.Contains(l, "settings put") || strings.Contains(l, "appops set") {
			t.Fatalf("restore wrote settings with nothing saved: %q", l)
		}
	}
	if !strings.Contains(strings.Join(f.log, "\n"), "rm -rf "+overlayDir) {
		t.Fatal("restore must clear the phone-side dir")
	}
}

func TestOverlayHidePkgSkipsDetectionAndSavesDefault(t *testing.T) {
	f := &fakeOverlay{a11y: overlayKeepSvc, appops: map[string]string{}}
	out, err := captureStdout(t, func() error {
		return run("overlay", overlayOpts(t, "hide", "--pkg", overlayWinPkg), f.run)
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(f.log, "\n"), "dumpsys") {
		t.Fatalf("--pkg must not look for overlays:\n%s", strings.Join(f.log, "\n"))
	}
	if f.saved != "appop "+overlayWinPkg+" default\n" {
		t.Fatalf("saved: %q", f.saved)
	}
	if f.appops[overlayWinPkg] != "ignore" {
		t.Fatalf("appop: %q", f.appops[overlayWinPkg])
	}
	if got := overlayList(overlayJSON(t, out)["hidden"]); strings.Join(got, ",") != overlayWinPkg {
		t.Fatalf("hidden: %v", got)
	}
}

func TestOverlayHideWithoutDimmerHidesNothing(t *testing.T) {
	f := &fakeOverlay{a11y: overlayKeepSvc, appops: map[string]string{}, window: "WINDOW MANAGER WINDOWS\n"}
	out, err := captureStdout(t, func() error { return run("overlay", overlayOpts(t, "hide"), f.run) })
	if err != nil {
		t.Fatal(err)
	}
	if len(overlayList(overlayJSON(t, out)["hidden"])) != 0 {
		t.Fatalf("hidden: %v", out)
	}
	if f.saved != "" || f.a11y != overlayKeepSvc {
		t.Fatalf("changed the phone: saved %q, a11y %q", f.saved, f.a11y)
	}
}

func TestOverlayHideRejectsABadPackageName(t *testing.T) {
	f := phoneWithDimmer()
	err := run("overlay", overlayOpts(t, "hide", "--pkg", "com.example.a; rm -rf /"), f.run)
	if err == nil || strings.Contains(err.Error(), "not implemented") {
		t.Fatalf("bad --pkg accepted: %v", err)
	}
	if !strings.Contains(err.Error(), "--pkg") {
		t.Fatalf("unhelpful error: %v", err)
	}
	for _, l := range f.log {
		if strings.Contains(l, "rm -rf /") {
			t.Fatalf("the bad name reached the phone: %q", l)
		}
	}
}
