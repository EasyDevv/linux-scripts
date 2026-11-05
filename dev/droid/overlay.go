package main

// overlay.go: hide and restore the overlays that dim or cover the screen during a capture.
//
// A dimmer paints either an app overlay window (the SYSTEM_ALERT_WINDOW appop) or an accessibility
// overlay (an enabled accessibility service that draws on top). screencap and screenrecord record
// both, so a capture session hides them first (`overlay hide`) and puts them back afterwards
// (`overlay restore`): the appop goes to `ignore` and the service leaves
// `enabled_accessibility_services`. The port of dimmer.ts keeps the PC file out of it: what to put
// back lives on the phone, so a crash or another PC can still restore it.
//
// Phone-side state, /data/local/tmp/droid-overlay/saved (plain text, one record per line, written
// before any setting changes, removed by restore):
//
//	a11y <the exact enabled_accessibility_services value before hide>
//	svc <accessibility component removed from that list>     one line per removed service
//	appop <package> <its SYSTEM_ALERT_WINDOW mode>           one line per lowered appop
//
// The a11y line comes first and only when a service was removed, so it is followed by at least one
// svc line. A file that already exists is merged, never overwritten: the first originals win, so a
// second hide (or a hide after a crash) still restores what was there before the first one.

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	overlayDir   = "/data/local/tmp/droid-overlay"
	overlaySaved = overlayDir + "/saved"
	overlayTmp   = overlaySaved + ".tmp"
	overlayA11y  = "enabled_accessibility_services"
	overlayAppop = "SYSTEM_ALERT_WINDOW"
	overlayMark  = "DROID_DONE" // the last line of every overlay script: its absence is the failure
	overlayEOF   = "DROID_EOF"  // heredoc tag for the saved file: no quoting of the values
)

// knownDimmers paint only when the screen is dark (an auto-brightness dimmer), so a bright screen
// shows no window to detect; their accessibility services are dropped anyway.
var knownDimmers = []string{"dev.rewhex.screendimmer"}

// appopModes are the modes `appops set` takes, so a corrupt saved file cannot run the phone shell
// with an arbitrary word.
var appopModes = map[string]bool{"allow": true, "ignore": true, "deny": true, "default": true, "foreground": true}

func overlayCmd(d Device, o opts) error {
	if len(o.pos) == 0 {
		return errors.New("overlay hide [--pkg a,b] | overlay restore")
	}
	if len(o.pos) > 1 {
		return fmt.Errorf("overlay %s: unexpected %q", o.pos[0], o.pos[1])
	}
	switch o.pos[0] {
	case "hide":
		return overlayHide(d, o)
	case "restore":
		return overlayRestore(d, o)
	}
	return fmt.Errorf("overlay %q: use hide or restore", o.pos[0])
}

// overlayPkgOK: a package name that can go into a phone shell script without quoting tricks.
var overlayPkgOK = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9._]*$`)

// overlayQuote single-quotes a value for the phone shell.
func overlayQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// overlayPkgOf is the package part of an accessibility component (`pkg/.Service`).
func overlayPkgOf(component string) string {
	pkg, _, _ := strings.Cut(component, "/")
	return pkg
}

func overlayHas(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// overlayAppopRow is one package whose SYSTEM_ALERT_WINDOW appop hide lowered.
type overlayAppopRow struct{ Pkg, Mode string }

// overlayState is the content of /data/local/tmp/droid-overlay/saved.
type overlayState struct {
	A11y     string   // the setting value before hide, restored verbatim
	Services []string // accessibility components hide removed
	Appops   []overlayAppopRow
}

func (s overlayState) empty() bool { return len(s.Services) == 0 && len(s.Appops) == 0 }

func (s overlayState) appop(pkg string) (string, bool) {
	for _, a := range s.Appops {
		if a.Pkg == pkg {
			return a.Mode, true
		}
	}
	return "", false
}

// String writes the saved file format (see the top of this file), deterministic and idempotent so
// a second hide can compare it with what the phone already holds.
func (s overlayState) String() string {
	var b strings.Builder
	if len(s.Services) > 0 {
		b.WriteString("a11y " + s.A11y + "\n")
		for _, c := range s.Services {
			b.WriteString("svc " + c + "\n")
		}
	}
	for _, a := range s.Appops {
		b.WriteString("appop " + a.Pkg + " " + a.Mode + "\n")
	}
	return b.String()
}

// ParseOverlaySaved reads the saved file; unknown or malformed lines are dropped, so a torn or
// hand-edited file restores what it can instead of failing.
func ParseOverlaySaved(text string) overlayState {
	var s overlayState
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if line == "" || line == overlayMark {
			continue
		}
		key, rest, _ := strings.Cut(line, " ")
		switch key {
		case "a11y":
			s.A11y = rest
		case "svc":
			if strings.Contains(rest, "/") && !strings.ContainsAny(rest, " \t") && !overlayHas(s.Services, rest) {
				s.Services = append(s.Services, rest)
			}
		case "appop":
			f := strings.Fields(line)
			if len(f) == 3 && overlayPkgOK.MatchString(f[1]) && appopModes[f[2]] {
				if _, ok := s.appop(f[1]); !ok {
					s.Appops = append(s.Appops, overlayAppopRow{f[1], f[2]})
				}
			}
		}
	}
	return s
}

var (
	overlayWindowRe = regexp.MustCompile(`^\s*Window #\d+ `)
	overlayTyRe     = regexp.MustCompile(`ty=(2038|2032|APPLICATION_OVERLAY|ACCESSIBILITY_OVERLAY)\b`)
	overlayOwnerRe  = regexp.MustCompile(`mOwnerPackage=(\S+)`)
	overlayPkgRe    = regexp.MustCompile(`\bpackage=(\S+)`)
	overlayNameRe   = regexp.MustCompile(`Window\{[0-9a-f]+ u\d+ ([^/}\s]+)/`)
)

// systemOverlayPkgs draw windows of their own; they are never dimmers.
var (
	systemOverlayPkgs = []string{"android", "com.android.systemui", "com.android.settings"}
	systemOverlayPre  = []string{
		"com.android.", "com.google.android.", "com.samsung.android.", "com.samsung.",
		"com.sec.android.", "com.sec.", "com.qualcomm.",
	}
)

func isSystemOverlayPkg(pkg string) bool {
	pkg = strings.TrimSpace(pkg)
	if pkg == "" || overlayHas(systemOverlayPkgs, pkg) {
		return true
	}
	for _, prefix := range systemOverlayPre {
		if strings.HasPrefix(pkg, prefix) {
			return true
		}
	}
	return false
}

// ParseOverlayPackages is dimmer.ts parseOverlayPackages: the owners of the app and accessibility
// overlay windows in `dumpsys window windows`, without the system windows.
func ParseOverlayPackages(blob string) []string {
	found := []string{}
	seen := map[string]bool{}
	flush := func(block []string) {
		text := strings.Join(block, "\n")
		if !overlayWindowRe.MatchString(text) {
			return // the header and anything before the first window
		}
		if !overlayTyRe.MatchString(text) && !strings.Contains(text, overlayAppop) && !strings.Contains(text, "mOwnerPackage=") {
			return // an ordinary window: not an overlay
		}
		pkg := ""
		if m := overlayOwnerRe.FindStringSubmatch(text); m != nil {
			pkg = m[1]
		} else if m := overlayPkgRe.FindStringSubmatch(text); m != nil {
			pkg = m[1]
		} else if m := overlayNameRe.FindStringSubmatch(text); m != nil {
			pkg = m[1]
		}
		pkg = strings.TrimSpace(pkg)
		if pkg == "" || !overlayPkgOK.MatchString(pkg) || isSystemOverlayPkg(pkg) || seen[pkg] {
			return // a package name that could not go into a shell script is not one
		}
		seen[pkg] = true
		found = append(found, pkg)
	}
	var block []string
	for _, line := range strings.Split(blob, "\n") {
		if overlayWindowRe.MatchString(line) {
			flush(block)
			block = nil
		}
		block = append(block, line)
	}
	flush(block)
	sort.Strings(found)
	return found
}

// ParseAppopMode reads `appops get PKG SYSTEM_ALERT_WINDOW`: `SYSTEM_ALERT_WINDOW: allow` → allow,
// nothing set ("No operations.") → default.
func ParseAppopMode(text string) string {
	if m := regexp.MustCompile(overlayAppop + `:\s*([a-z-]+)`).FindStringSubmatch(text); m != nil {
		return m[1]
	}
	return "default"
}

// parseA11yList reads `enabled_accessibility_services`: `a/b.C:d/e.F` → the two components.
func parseA11yList(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" || value == "null" {
		return nil
	}
	var list []string
	for _, part := range strings.Split(value, ":") {
		if part = strings.TrimSpace(part); strings.Contains(part, "/") {
			list = append(list, part)
		}
	}
	return list
}

// overlayTargets: --pkg a,b, else the overlay owners on the screen (dimmerPackages without its
// environment variable: --pkg is this CLI's way to name one).
func overlayTargets(d Device, flag string) ([]string, error) {
	flag = strings.TrimSpace(flag)
	if flag != "" {
		var pkgs []string
		for _, p := range strings.Split(flag, ",") {
			if p = strings.TrimSpace(p); p == "" {
				continue
			}
			if !overlayPkgOK.MatchString(p) {
				return nil, fmt.Errorf("--pkg %q: a package name looks like com.example.app", p)
			}
			if !overlayHas(pkgs, p) {
				pkgs = append(pkgs, p)
			}
		}
		sort.Strings(pkgs)
		return pkgs, nil
	}
	out, err := d.Shell(15*time.Second, beat+"dumpsys window windows")
	if err != nil {
		return nil, err
	}
	return ParseOverlayPackages(out), nil
}

// overlayCurrent is what one read of the phone says: the accessibility setting, the appop modes of
// the packages in question, and the saved file if there is one.
type overlayCurrent struct {
	a11y      string
	enabled   []string
	appops    map[string]string
	saved     overlayState
	savedText string
}

func overlayReadScript(pkgs []string) string {
	var b strings.Builder
	b.WriteString(beat + "D=" + overlayDir + "; ")
	b.WriteString(`echo "A11Y=$(settings get secure ` + overlayA11y + `)"; `)
	for _, p := range pkgs {
		// The mode is extracted on the phone, so the answer is one word and the read is one call.
		fmt.Fprintf(&b, `m=$(appops get %s %s 2>/dev/null | sed -n 's/.*%s: \([a-z-]*\).*/\1/p' | head -1); `+
			`echo "APPOPS %s ${m:-default}"; `, p, overlayAppop, overlayAppop, p)
	}
	b.WriteString("sed -n 's/^/SAVED /p' " + overlaySaved + " 2>/dev/null; echo " + overlayMark)
	return b.String()
}

func overlayRead(d Device, pkgs []string) (overlayCurrent, error) {
	out, err := d.Shell(20*time.Second, overlayReadScript(pkgs))
	if err != nil {
		return overlayCurrent{}, err
	}
	cur := overlayCurrent{appops: map[string]string{}}
	var saved strings.Builder
	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimRight(raw, "\r")
		switch {
		case strings.HasPrefix(line, "A11Y="):
			cur.a11y = strings.TrimSpace(strings.TrimPrefix(line, "A11Y="))
		case strings.HasPrefix(line, "APPOPS "):
			if f := strings.Fields(line); len(f) == 3 && appopModes[f[2]] {
				cur.appops[f[1]] = f[2]
			}
		case strings.HasPrefix(line, "SAVED "):
			saved.WriteString(strings.TrimPrefix(line, "SAVED ") + "\n")
		}
	}
	cur.savedText = saved.String()
	cur.saved = ParseOverlaySaved(cur.savedText)
	cur.enabled = parseA11yList(cur.a11y)
	return cur, nil
}

// overlayShellError: a failed overlay script is a device problem (exit 3), not a usage error.
func overlayShellError(what, out string, err error) error {
	var de DeviceError
	if errors.As(err, &de) {
		return err
	}
	msg := firstLine(out)
	if msg == "" {
		msg = err.Error()
	}
	return devErr("%s failed: %s", what, msg)
}

func overlayHide(d Device, o opts) error {
	pkgs, err := overlayTargets(d, o.val["pkg"])
	if err != nil {
		return err
	}
	cur, err := overlayRead(d, pkgs)
	if err != nil {
		return err
	}

	targets := map[string]bool{}
	for _, p := range knownDimmers {
		targets[p] = true
	}
	for _, p := range pkgs {
		targets[p] = true
	}
	var removed, keep []string
	for _, c := range cur.enabled {
		if targets[overlayPkgOf(c)] {
			removed = append(removed, c)
		} else {
			keep = append(keep, c)
		}
	}

	// Merge into what is already saved: rows the phone has are the first originals and stay.
	saved := cur.saved
	if len(removed) > 0 && len(saved.Services) == 0 {
		saved.A11y = cur.a11y
	}
	for _, c := range removed {
		if !overlayHas(saved.Services, c) {
			saved.Services = append(saved.Services, c)
		}
	}
	handled := map[string]bool{}
	for _, c := range saved.Services {
		handled[overlayPkgOf(c)] = true
	}
	var lowered []string
	for _, p := range pkgs {
		if handled[p] {
			continue // its accessibility service is the overlay channel: that is what hide removed
		}
		lowered = append(lowered, p)
		if _, ok := saved.appop(p); !ok {
			mode := cur.appops[p]
			if mode == "" {
				mode = "default"
			}
			saved.Appops = append(saved.Appops, overlayAppopRow{p, mode})
		}
	}

	hidden := make([]string, 0, len(pkgs)+len(saved.Services))
	add := func(p string) {
		if p != "" && !overlayHas(hidden, p) {
			hidden = append(hidden, p)
		}
	}
	for _, p := range pkgs {
		add(p)
	}
	for _, c := range saved.Services {
		add(overlayPkgOf(c))
	}
	sort.Strings(hidden)

	fileChanged := strings.TrimSpace(saved.String()) != strings.TrimSpace(cur.savedText)
	if fileChanged || len(removed) > 0 || len(lowered) > 0 {
		if err := overlayApplyHide(d, saved, fileChanged, keep, removed, lowered); err != nil {
			return err
		}
	}

	human := fmt.Sprintf("%s: no dimmer overlay to hide", d.Serial)
	if len(hidden) > 0 {
		human = fmt.Sprintf("%s hid %s: %s; `droid overlay restore` puts them back", d.Serial,
			overlayCount(len(hidden), "dimmer overlay"), strings.Join(hidden, ", "))
	}
	if !fileChanged && len(hidden) > 0 && cur.savedText != "" {
		human += " (the originals saved by the first hide are kept)"
	}
	emit(o, human, map[string]any{"hidden": hidden})
	return nil
}

// overlayApplyHide is one shell round trip: save first (a crash right after a setting change must
// still be restorable), then the settings that hide.
func overlayApplyHide(d Device, saved overlayState, fileChanged bool, keep, removed, lowered []string) error {
	parts := []string{beat + "D=" + overlayDir}
	if fileChanged {
		parts = append(parts, "mkdir -p $D && cat > "+overlayTmp+" <<'"+overlayEOF+"'\n"+saved.String()+overlayEOF+"\nmv "+overlayTmp+" "+overlaySaved)
	}
	if len(removed) > 0 {
		parts = append(parts, "settings put secure "+overlayA11y+" "+overlayQuote(strings.Join(keep, ":")))
	}
	for _, p := range lowered {
		parts = append(parts, "appops set "+p+" "+overlayAppop+" ignore")
	}
	parts = append(parts, "echo "+overlayMark)
	out, err := d.Shell(30*time.Second, strings.Join(parts, " && "))
	if err != nil {
		return overlayShellError("overlay hide", out, err)
	}
	if !strings.Contains(out, overlayMark) {
		return devErr("overlay hide: %s", firstLine(out))
	}
	return nil
}

func overlayRestore(d Device, o opts) error {
	out, err := d.Shell(15*time.Second, beat+"cat "+overlaySaved+" 2>/dev/null; echo "+overlayMark)
	if err != nil {
		return overlayShellError("overlay restore", out, err)
	}
	saved := ParseOverlaySaved(out)

	var parts []string
	if len(saved.Services) > 0 {
		value := saved.A11y
		if value == "" || value == "null" {
			value = strings.Join(saved.Services, ":") // a saved file without its a11y line
		}
		parts = append(parts, "settings put secure "+overlayA11y+" "+overlayQuote(value))
	}
	for _, a := range saved.Appops {
		parts = append(parts, "appops set "+a.Pkg+" "+overlayAppop+" "+a.Mode)
	}
	parts = append(parts, "rm -rf "+overlayDir, "echo "+overlayMark)
	out, err = d.Shell(30*time.Second, beat+strings.Join(parts, " && "))
	if err != nil {
		return overlayShellError("overlay restore", out, err)
	}
	if !strings.Contains(out, overlayMark) {
		return devErr("overlay restore: %s", firstLine(out))
	}

	restored := len(saved.Services) + len(saved.Appops)
	human := fmt.Sprintf("%s: nothing was hidden (no saved file on the phone)", d.Serial)
	if restored > 0 {
		human = fmt.Sprintf("%s restored %s: %s and %s back, saved state removed", d.Serial,
			overlayCount(restored, "change"), overlayCount(len(saved.Services), "accessibility service"),
			overlayCount(len(saved.Appops), "appop"))
	}
	emit(o, human, map[string]any{"restored": restored})
	return nil
}

// overlayCount: "1 appop", "2 appops".
func overlayCount(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}
