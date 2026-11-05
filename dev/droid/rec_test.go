package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// recHost is a fake Runner: it logs every adb call and answers from a script, like droid_test.go's
// fake, so the rec/shot/sheet and media commands can be tested without a device.
type recHost struct {
	log   []string
	reply func(cmd string) (string, error)
}

func (h *recHost) run(_ time.Duration, args ...string) (string, error) {
	j := strings.Join(args, " ")
	h.log = append(h.log, j)
	if h.reply == nil {
		return "", nil
	}
	return h.reply(j)
}

// script is the shell script of the call at index i, without the adb prefix.
func (h *recHost) script(t *testing.T, i int) string {
	t.Helper()
	if i >= len(h.log) {
		t.Fatalf("call %d missing; log %q", i, h.log)
	}
	const prefix = "-s T shell "
	if !strings.HasPrefix(h.log[i], prefix) {
		t.Fatalf("call %d is not a shell script: %q", i, h.log[i])
	}
	return strings.TrimPrefix(h.log[i], prefix)
}

func (h *recHost) indexOf(t *testing.T, sub string) int {
	t.Helper()
	for i, l := range h.log {
		if strings.Contains(l, sub) {
			return i
		}
	}
	t.Fatalf("no call with %q; log %q", sub, h.log)
	return -1
}

// cmdOpts parses argv the way main does: the first word is the command, the rest are its flags.
func cmdOpts(t *testing.T, args ...string) (string, opts) {
	t.Helper()
	cmd, o, err := command(args)
	if err != nil {
		t.Fatalf("parse %q: %v", args, err)
	}
	return cmd, o
}

func TestRecStartScriptCarriesSegmentSizeAndBitrate(t *testing.T) {
	h := &recHost{reply: func(string) (string, error) { return "started 4242\n", nil }}
	cmd, o := cmdOpts(t, "rec", "start", "--segment", "90", "--size", "720x1280", "--bitrate", "4000000", "--serial", "T")
	if err := run(cmd, o, h.run); err != nil {
		t.Fatal(err)
	}
	if len(h.log) != 1 {
		t.Fatalf("start must be one round trip: %q", h.log)
	}
	s := h.script(t, 0)
	if !strings.HasPrefix(s, beat) {
		t.Fatal("start must touch the awake heartbeat")
	}
	for _, want := range []string{
		"screenrecord --time-limit 90",
		"--size 720x1280",
		"--bitrate 4000000",
		recDir + "/seg-$n.mp4",
		"nohup sh -c",
		"[ ! -f " + recStopFile + " ]",
		recTimes,
		"date +%s%N",
		"printf %03d $i",
		"kill -0",
		"pidof screenrecord",
		"echo \"started $(cat $D/pid)\"",
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("start script lacks %q:\n%s", want, s)
		}
	}
	if strings.Count(s, "nohup") != 1 || !strings.Contains(s, ">/dev/null 2>&1 &") {
		t.Fatalf("the loop must be detached once:\n%s", s)
	}
	if !strings.Contains(s, "i=0; while") { // segment numbers start at seg-000.mp4
		t.Fatalf("segments must start at 000:\n%s", s)
	}
}

func TestRecStartDefaultsAndNoOptionalFlags(t *testing.T) {
	h := &recHost{reply: func(string) (string, error) { return "started 7\n", nil }}
	cmd, o := cmdOpts(t, "rec", "start", "--serial", "T")
	if err := run(cmd, o, h.run); err != nil {
		t.Fatal(err)
	}
	s := h.script(t, 0)
	if !strings.Contains(s, "screenrecord --time-limit 180") {
		t.Fatalf("default segment is 180 s:\n%s", s)
	}
	if strings.Contains(s, "--size") || strings.Contains(s, "--bitrate") {
		t.Fatalf("unset flags must not reach screenrecord:\n%s", s)
	}
}

func TestRecStartRefusesWhileARecordingRuns(t *testing.T) {
	for _, out := range []string{"running 123\n", "busy\n"} {
		h := &recHost{reply: func(string) (string, error) { return out, nil }}
		cmd, o := cmdOpts(t, "rec", "start", "--serial", "T")
		err := run(cmd, o, h.run)
		var nm notMet
		if !errors.As(err, &nm) {
			t.Fatalf("%q: want exit 2, got %v", out, err)
		}
		if !strings.Contains(nm.Msg, "already running") {
			t.Fatalf("msg: %s", nm.Msg)
		}
		if len(h.log) != 1 {
			t.Fatalf("a refusal must not start a second loop: %q", h.log)
		}
	}
}

func TestRecStartRejectsBadFlags(t *testing.T) {
	for _, args := range [][]string{
		{"rec", "start", "--segment", "0"},
		{"rec", "start", "--segment", "181"},
		{"rec", "start", "--segment", "long"},
		{"rec", "start", "--size", "720"},
		{"rec", "start", "--bitrate", "fast"},
	} {
		h := &recHost{}
		cmd, o, err := command(append(args, "--serial", "T"))
		if err != nil {
			continue // rejected at parse time is fine too
		}
		err = run(cmd, o, h.run)
		var nm notMet
		if err == nil || errors.As(err, &nm) {
			t.Fatalf("%q must be a usage error, got %v", args, err)
		}
		if len(h.log) != 0 {
			t.Fatalf("%q reached the device: %q", args, h.log)
		}
	}
}

const recTimesText = "S 000 1793152231366281683\nE 000 1793152233366281683\n" +
	"S 001 1793152411420000000\nE 001 1793152413420000000\n" +
	"S 002 1793154600000000000\n"

func recStopHost(t *testing.T, pulls map[string]bool) *recHost {
	t.Helper()
	polls := 0
	return &recHost{reply: func(j string) (string, error) {
		switch {
		case strings.Contains(j, "pkill -INT screenrecord"):
			return "stopped\n", nil
		case strings.Contains(j, "pidof screenrecord"):
			polls++
			if polls < 3 { // still closing the mp4 for two polls
				return "4321\n", nil
			}
			return "", nil
		case strings.Contains(j, "cat "+recTimes):
			return recTimesText, nil
		case strings.Contains(j, " pull "):
			for name, ok := range pulls {
				if strings.Contains(j, name) {
					if !ok {
						return "adb: error: failed to stat remote object", errors.New("exit status 1")
					}
					return "1 file pulled, 0 skipped.\n", nil
				}
			}
			t.Fatalf("unexpected pull: %s", j)
		case strings.Contains(j, "rm -f "+recDir):
			return "cleaned\n", nil
		}
		return "", nil
	}}
}

func TestRecStopStopsWaitsPullsAndWritesTimes(t *testing.T) {
	dir := t.TempDir()
	h := recStopHost(t, map[string]bool{
		recRemoteSeg(0): true,
		recRemoteSeg(1): false, // a segment that will not come back
		recRemoteSeg(2): true,
	})
	cmd, o := cmdOpts(t, "rec", "stop", "--dir", dir, "--serial", "T")
	err := run(cmd, o, h.run)
	var de DeviceError
	if !errors.As(err, &de) || !strings.Contains(de.Msg, "seg-001.mp4") {
		t.Fatalf("a lost segment must be exit 3: %v", err)
	}
	stopAt := h.indexOf(t, "pkill -INT screenrecord")
	if !strings.Contains(h.script(t, stopAt), "touch $D/stop") {
		t.Fatalf("the stop file must precede SIGINT: %s", h.script(t, stopAt))
	}
	poll := h.indexOf(t, "pidof screenrecord")
	pulls := strings.Join(h.log, "\n")
	for _, want := range []string{recRemoteSeg(0), recRemoteSeg(1), recRemoteSeg(2)} {
		if !strings.Contains(pulls, want) {
			t.Fatalf("pull %s missing:\n%s", want, pulls)
		}
	}
	if !strings.Contains(pulls, filepath.Join(dir, "seg-000.mp4")) || !strings.Contains(pulls, filepath.Join(dir, "seg-002.mp4")) {
		t.Fatalf("segments must land in --dir:\n%s", pulls)
	}
	if pullsIdx := h.indexOf(t, " pull "); stopAt > pullsIdx || poll > pullsIdx {
		t.Fatalf("pull before stop/wait: %q", h.log)
	}
	clean := h.indexOf(t, "rm -f "+recDir+"/seg-*.mp4")
	if clean < h.indexOf(t, " pull ") {
		t.Fatalf("remote cleanup before the pulls: %q", h.log)
	}
	if !strings.Contains(h.script(t, clean), recStopFile) {
		t.Fatalf("a finished recording drops the stop file: %s", h.script(t, clean))
	}
	raw, err := os.ReadFile(filepath.Join(dir, "times.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Segments []recSeg `json:"segments"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("%v: %s", err, raw)
	}
	if len(doc.Segments) != 2 || doc.Segments[0].File != "seg-000.mp4" || doc.Segments[0].StartMs != 1793152231366 ||
		doc.Segments[1].File != "seg-002.mp4" || doc.Segments[1].StartMs != 1793154600000 {
		t.Fatalf("times.json: %s", raw)
	}
}

func TestRecStopSucceedsWhenEverySegmentComesBack(t *testing.T) {
	dir := t.TempDir()
	h := recStopHost(t, map[string]bool{
		recRemoteSeg(0): true,
		recRemoteSeg(1): true,
		recRemoteSeg(2): true,
	})
	cmd, o := cmdOpts(t, "rec", "stop", "--dir", dir, "--serial", "T")
	if err := run(cmd, o, h.run); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "times.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Segments []recSeg `json:"segments"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || len(doc.Segments) != 3 {
		t.Fatalf("%v: %s", err, raw)
	}
	if doc.Segments[2].StartMs != 1793154600000 {
		t.Fatalf("startMs must be epoch ms: %s", raw)
	}
}

func TestRecStopKeepsTheStopFileWhenScreenrecordWillNotDie(t *testing.T) {
	old := recPollEvery
	recPollEvery = 0
	defer func() { recPollEvery = old }()
	dir := t.TempDir()
	h := &recHost{reply: func(j string) (string, error) {
		switch {
		case strings.Contains(j, "pidof screenrecord"):
			return "4321\n", nil // never goes away
		case strings.Contains(j, "cat "+recTimes):
			return recTimesText, nil
		case strings.Contains(j, " pull "):
			return "1 file pulled\n", nil
		}
		return "", nil
	}}
	cmd, o := cmdOpts(t, "rec", "stop", "--dir", dir, "--serial", "T")
	err := run(cmd, o, h.run)
	var de DeviceError
	if !errors.As(err, &de) || !strings.Contains(de.Msg, "still running") {
		t.Fatalf("want exit 3, got %v", err)
	}
	clean := h.indexOf(t, "rm -f "+recDir+"/seg-*.mp4")
	if strings.Contains(h.script(t, clean), recStopFile) {
		t.Fatalf("the stop file must stay while a segment records: %s", h.script(t, clean))
	}
}

func TestRecStopWithoutSegmentsIsExitTwo(t *testing.T) {
	dir := t.TempDir()
	h := &recHost{}
	cmd, o := cmdOpts(t, "rec", "stop", "--dir", dir, "--serial", "T")
	err := run(cmd, o, h.run)
	var nm notMet
	if !errors.As(err, &nm) || !strings.Contains(nm.Msg, "nothing recorded") {
		t.Fatalf("got %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "times.json")); err != nil {
		t.Fatal("times.json is written even for an empty recording")
	}
}

func TestRecStopNeedsDir(t *testing.T) {
	h := &recHost{}
	cmd, o := cmdOpts(t, "rec", "stop", "--serial", "T")
	if err := run(cmd, o, h.run); err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Fatalf("got %v", err)
	}
}

func TestParseTimes(t *testing.T) {
	segs := ParseTimes(recTimesText + "garbage\nE 009 1793152231366281683\n")
	want := []recSeg{{File: "seg-000.mp4", StartMs: 1793152231366}, {File: "seg-001.mp4", StartMs: 1793152411420}, {File: "seg-002.mp4", StartMs: 1793154600000}}
	if len(segs) != len(want) {
		t.Fatalf("%v", segs)
	}
	for i := range want {
		if segs[i] != want[i] {
			t.Fatalf("%d: %v != %v", i, segs[i], want[i])
		}
	}
	if got := ParseTimes(""); len(got) != 0 {
		t.Fatalf("empty: %v", got)
	}
}

func TestSheetPlan(t *testing.T) {
	cases := []struct {
		duration, every float64
		frames          int
		step            float64
		tile            string
	}{
		{120, 2, 40, 3, "tile=5x8"},   // capped: the step widens instead of dropping the tail
		{5, 2, 2, 2, "tile=5x1"},      // a whole short video
		{0, 2, 40, 2, "tile=5x8"},     // no duration: a full sheet at the asked step
		{120, 0, 40, 3, "tile=5x8"},   // --every 0 means 2 s
		{3, 1, 3, 1, "tile=5x1"},      // one row of three
		{100, 10, 10, 10, "tile=5x2"}, // 10 frames in two rows
	}
	for _, c := range cases {
		vf, step, frames := sheetPlan(c.duration, c.every, sheetCols, sheetMaxFrames)
		if frames != c.frames || step != c.step || !strings.Contains(vf, c.tile) {
			t.Fatalf("%v/%v: vf %q step %v frames %d, want %d frames, step %v, %s", c.duration, c.every, vf, step, frames, c.frames, c.step, c.tile)
		}
		if !strings.HasPrefix(vf, "fps=1/") || !strings.Contains(vf, "scale=180:-1") {
			t.Fatalf("%v/%v: %q", c.duration, c.every, vf)
		}
		if strings.Contains(vf, "tap") {
			t.Fatal("a sheet plan never names a tap")
		}
	}
	vf, _, _ := sheetPlan(120, 2, sheetCols, sheetMaxFrames)
	if vf != "fps=1/3.000,scale=180:-1,tile=5x8" {
		t.Fatalf("vf: %q", vf)
	}
}

func TestSheetArgs(t *testing.T) {
	got := strings.Join(sheetArgs("/tmp/rec.mp4", "/tmp/rec-sheet.png", "fps=1/2.000,scale=180:-1,tile=5x1"), " ")
	want := "-y -loglevel error -i /tmp/rec.mp4 -vf fps=1/2.000,scale=180:-1,tile=5x1 -frames:v 1 /tmp/rec-sheet.png"
	if got != want {
		t.Fatalf("argv:\n%s\n%s", got, want)
	}
}

func TestSheetNeedsALocalVideo(t *testing.T) {
	_, o := cmdOpts(t, "sheet", filepath.Join(t.TempDir(), "missing.mp4"))
	if err := sheetCmd(Device{Serial: "T"}, o); err == nil || !strings.Contains(err.Error(), "no video") {
		t.Fatalf("got %v", err)
	}
	if err := sheetCmd(Device{Serial: "T"}, opts{pos: nil, val: map[string]string{}, flag: map[string]bool{}}); err == nil {
		t.Fatal("sheet without a video must be a usage error")
	}
}

func TestShotWritesThePng(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shot.png")
	h := &recHost{reply: func(j string) (string, error) {
		if strings.Contains(j, "exec-out screencap -p") {
			return "\x89PNG\r\n\x1a\nbody", nil
		}
		return "", nil
	}}
	cmd, o := cmdOpts(t, "shot", path, "--serial", "T")
	if err := run(cmd, o, h.run); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil || !strings.HasPrefix(string(raw), "\x89PNG") {
		t.Fatalf("%v %q", err, raw)
	}
	if len(h.log) != 1 {
		t.Fatalf("one screencap: %q", h.log)
	}
	bad := &recHost{reply: func(string) (string, error) { return "error: no devices", nil }}
	cmd, o = cmdOpts(t, "shot", filepath.Join(t.TempDir(), "x.png"), "--serial", "T")
	if err := run(cmd, o, bad.run); err == nil {
		t.Fatal("a screencap without a PNG must fail")
	}
	if err := shotCmd(Device{Serial: "T"}, opts{val: map[string]string{}, flag: map[string]bool{}}); err == nil {
		t.Fatal("shot without a file must be a usage error")
	}
}

func TestShellQuote(t *testing.T) {
	for _, c := range [][2]string{
		{"plain", "'plain'"},
		{"a b", "'a b'"},
		{"pic ' x.jpg", `'pic '\'' x.jpg'`},
		{"한글 이름.jpg", "'한글 이름.jpg'"},
	} {
		if got := shellQuote(c[0]); got != c[1] {
			t.Fatalf("%q: %q != %q", c[0], got, c[1])
		}
	}
}

func TestMediaPushBatchesAndQuotesNames(t *testing.T) {
	var files []string
	for i := 0; i < 70; i++ {
		files = append(files, fmt.Sprintf("/tmp/my pics/pic %d.jpg", i))
	}
	files = append(files, "/tmp/quote's pic.jpg")
	rows := strings.Repeat("Row: 0 _id=1\n", len(files))
	h := &recHost{reply: func(j string) (string, error) {
		switch {
		case strings.Contains(j, "content query"):
			return rows, nil
		case strings.Contains(j, " push "):
			return "ok\n", nil
		}
		return "", nil
	}}
	cmd, o := cmdOpts(t, append([]string{"media", "push", "Pictures/Test", "--serial", "T"}, files...)...)
	if err := run(cmd, o, h.run); err != nil {
		t.Fatal(err)
	}
	var pushes, scans int
	for _, l := range h.log {
		switch {
		case strings.Contains(l, " push "):
			pushes++
			if !strings.HasPrefix(l, "-s T push ") || !strings.HasSuffix(l, " /sdcard/Pictures/Test/") {
				t.Fatalf("push argv: %q", l)
			}
			if !strings.Contains(l, "/tmp/my pics/pic 69.jpg") && pushes == 2 {
				t.Fatalf("second batch lacks the last file: %q", l)
			}
		case strings.Contains(l, "am broadcast"):
			scans++
		}
	}
	if pushes != 2 || scans != 2 {
		t.Fatalf("pushes %d scans %d (a batch per adb call): %q", pushes, scans, h.log)
	}
	all := strings.Join(h.log, "\n")
	for _, want := range []string{
		"-d 'file:///sdcard/Pictures/Test/pic 0.jpg'",
		"-d 'file:///sdcard/Pictures/Test/pic 63.jpg'",
		"-d 'file:///sdcard/Pictures/Test/pic 69.jpg'",
		`-d 'file:///sdcard/Pictures/Test/quote'\''s pic.jpg'`,
	} {
		if !strings.Contains(all, want) {
			t.Fatalf("scan lacks %q:\n%s", want, all)
		}
	}
}

func TestMediaRmDeletesTheDirAndTheRows(t *testing.T) {
	h := &recHost{reply: func(j string) (string, error) {
		switch {
		case strings.Contains(j, "content query"):
			return "Row: 0 _id=1\nRow: 1 _id=2\n", nil
		case strings.Contains(j, "content delete"):
			return "Deleted 2 rows\n", nil
		}
		return "", nil
	}}
	cmd, o := cmdOpts(t, "media", "rm", "/sdcard/My Pics/Test", "--serial", "T")
	if err := run(cmd, o, h.run); err != nil {
		t.Fatal(err)
	}
	all := strings.Join(h.log, "\n")
	if !strings.Contains(all, "rm -rf '/sdcard/My Pics/Test'") {
		t.Fatalf("dir not removed: %s", all)
	}
	if !strings.Contains(all, "content delete") || !strings.Contains(all, `relative_path='My Pics/Test/'`) {
		t.Fatalf("rows not deleted: %s", all)
	}
}
