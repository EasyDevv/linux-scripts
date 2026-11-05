package main

// rec.go: segment recording (rec start/stop), screenshots (shot) and contact sheets (sheet).
//
// rec keeps the phone recording while droid is not attached: `rec start` launches a shell loop on
// the phone (nohup, detached) that runs screenrecord in --segment-second pieces and appends each
// piece's start time (`date +%s%N`) to a times file. `rec stop` drops a stop file, SIGINTs
// screenrecord so the mp4 is closed, waits until nothing records, pulls the segments into --dir and
// writes times.json. The loop and the times file are the port of recorder.ts loopScript/parseTimes.
//
// sheet needs no device: ffprobe reads the duration on the PC, sheetPlan turns it into an ffmpeg
// tile filter (phone.py sheet_plan) and ffmpeg writes one image.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Phone-side state for rec, under /data/local/tmp like the other droid dirs.
const (
	recDir        = "/data/local/tmp/droid-rec"
	recTimes      = recDir + "/times"
	recStopFile   = recDir + "/stop"
	recPidFile    = recDir + "/pid"
	recSegPrefix  = "seg-"
	recDefaultSeg = 180
	recMaxSeg     = 180 // screenrecord's own --time-limit limit
	recPollTries  = 40  // 8 s, as recorder.ts waits for screenrecord to go
)

// recPollEvery is the pause between `pidof screenrecord` checks; a test shrinks it.
var recPollEvery = 200 * time.Millisecond

// recSeg is one pulled segment: the file name inside --dir and its phone-side start in epoch ms.
type recSeg struct {
	File    string `json:"file"`
	StartMs int64  `json:"startMs"`
}

// shellQuote single-quotes s for a phone shell script, so spaces and quotes in a file name survive.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func recSegName(i int) string { return fmt.Sprintf("%s%03d.mp4", recSegPrefix, i) }

func recRemoteSeg(i int) string { return recDir + "/" + recSegName(i) }

var timesRe = regexp.MustCompile(`(?m)^([SE]) +(\d+) +(\d+)\s*$`)

// ParseTimes reads the phone's times file (`S <n> <ns>` / `E <n> <ns>`) into one row per segment
// that started, sorted by segment number, with the start in epoch ms.
func ParseTimes(text string) []recSeg {
	type row struct{ start int64 }
	rows := map[int]row{}
	for _, m := range timesRe.FindAllStringSubmatch(text, -1) {
		if m[1] != "S" {
			continue // the end is not needed to place a segment
		}
		i, _ := strconv.Atoi(m[2])
		ns, err := strconv.ParseInt(m[3], 10, 64)
		if err != nil {
			continue
		}
		rows[i] = row{start: ns / 1_000_000}
	}
	idx := make([]int, 0, len(rows))
	for i := range rows {
		idx = append(idx, i)
	}
	for a := 1; a < len(idx); a++ { // few segments: insertion sort keeps it dependency-free
		for b := a; b > 0 && idx[b] < idx[b-1]; b-- {
			idx[b], idx[b-1] = idx[b-1], idx[b]
		}
	}
	segs := make([]recSeg, 0, len(idx))
	for _, i := range idx {
		segs = append(segs, recSeg{File: recSegName(i), StartMs: rows[i].start})
	}
	return segs
}

// recStartScript checks that nothing records already, then launches the segment loop detached:
// one `nohup sh -c` on the phone, so droid returns without holding the adb session open.
func recStartScript(segment int, size string, bitrate int) string {
	rec := fmt.Sprintf("screenrecord --time-limit %d", segment)
	if size != "" {
		rec += " --size " + size
	}
	if bitrate > 0 {
		rec += " --bitrate " + strconv.Itoa(bitrate)
	}
	rec += " " + recDir + "/seg-$n.mp4"
	// The stop file is checked before every piece, so stop never leaves a segment running.
	loop := fmt.Sprintf(`i=0; while [ ! -f %s ]; do n=$(printf %%03d $i); `+
		`echo "S $n $(date +%%s%%N)" >> %s; %s; echo "E $n $(date +%%s%%N)" >> %s; i=$((i+1)); done`,
		recStopFile, recTimes, rec, recTimes)
	return beat + fmt.Sprintf(`D=%s; mkdir -p $D; `+
		`if [ -f $D/pid ] && kill -0 $(cat $D/pid) 2>/dev/null; then echo "running $(cat $D/pid)"; exit 0; fi; `+
		`if pidof screenrecord >/dev/null 2>&1; then echo busy; exit 0; fi; `+
		`rm -f $D/stop $D/times $D/pid $D/seg-*.mp4; `+
		`nohup sh -c '%s' >/dev/null 2>&1 & echo $! > $D/pid; echo "started $(cat $D/pid)"`, recDir, loop)
}

// recStopScript is the first half of stop: the stop file first (the loop must not open another
// segment), then SIGINT, which is what makes screenrecord finish the mp4.
var recStopScript = beat + "D=" + recDir + "; touch $D/stop; pkill -INT screenrecord 2>/dev/null; echo stopped"

var sizeRe = regexp.MustCompile(`^\d+x\d+$`)

func recCmd(d Device, o opts) error {
	if len(o.pos) == 0 {
		return errors.New("rec start [--segment 180] [--size WxH] [--bitrate N] | rec stop --dir D")
	}
	switch o.pos[0] {
	case "start":
		return recStart(d, o)
	case "stop":
		return recStop(d, o)
	}
	return fmt.Errorf("rec %q: use start or stop", o.pos[0])
}

func recStart(d Device, o opts) error {
	segment := recDefaultSeg
	if s := o.val["segment"]; s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > recMaxSeg {
			return fmt.Errorf("--segment %q: seconds, 1 to %d (screenrecord's limit)", s, recMaxSeg)
		}
		segment = n
	}
	size := o.val["size"]
	if size != "" && !sizeRe.MatchString(size) {
		return fmt.Errorf("--size %q: WxH, e.g. 720x1280", size)
	}
	bitrate := 0
	if s := o.val["bitrate"]; s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 {
			return fmt.Errorf("--bitrate %q: bits per second, a positive number", s)
		}
		bitrate = n
	}
	out, err := d.Shell(20*time.Second, recStartScript(segment, size, bitrate))
	if err != nil {
		return err
	}
	switch {
	case strings.Contains(out, "started"):
		emit(o, fmt.Sprintf("recording %ds segments on %s into %s; `droid rec stop --dir D` ends it", segment, d.Serial, recDir), nil)
		return nil
	case strings.Contains(out, "running"), strings.Contains(out, "busy"):
		return notMet{fmt.Sprintf("a recording is already running on %s; `droid rec stop --dir D` first", d.Serial)}
	}
	return devErr("rec start: %s", firstLine(out))
}

func recStop(d Device, o opts) error {
	dir := o.val["dir"]
	if dir == "" {
		return errors.New("rec stop needs --dir D: where the segments go")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if _, err := d.Shell(20*time.Second, recStopScript); err != nil {
		return err
	}
	recording := true
	for i := 0; i < recPollTries; i++ {
		out, err := d.Shell(10*time.Second, "pidof screenrecord")
		if err != nil || strings.TrimSpace(out) == "" {
			recording = false
			break
		}
		time.Sleep(recPollEvery)
	}
	out, err := d.Shell(15*time.Second, "cat "+recTimes+" 2>/dev/null; true")
	if err != nil {
		return err
	}
	rows := ParseTimes(out)
	segs := make([]recSeg, 0, len(rows))
	var failed []string
	for _, s := range rows {
		i, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(s.File, recSegPrefix), ".mp4"))
		local := filepath.Join(dir, s.File)
		pull, err := d.run(120*time.Second, "-s", d.Serial, "pull", recRemoteSeg(i), local)
		if err != nil {
			failed = append(failed, s.File+": "+firstLine(pull))
			continue
		}
		segs = append(segs, s)
	}
	// Drop the stop file only when nothing records any more; otherwise the loop must still see it.
	cleanup := "rm -f " + recDir + "/seg-*.mp4 " + recTimes + " " + recPidFile
	if !recording {
		cleanup += " " + recStopFile + "; rmdir " + recDir + " 2>/dev/null"
	}
	if _, err := d.Shell(20*time.Second, cleanup+"; echo cleaned"); err != nil {
		return err
	}
	if err := writeTimes(dir, segs); err != nil {
		return err
	}
	if len(rows) == 0 {
		return notMet{fmt.Sprintf("nothing recorded: %s has no segments (run `droid rec start` first)", recDir)}
	}
	if len(segs) == 0 {
		return devErr("pulled none of the %d segments: %s", len(rows), strings.Join(failed, "; "))
	}
	if len(failed) > 0 {
		return devErr("%d of %d segments did not come back (%s); the rest and times.json are in %s",
			len(failed), len(rows), strings.Join(failed, "; "), dir)
	}
	if recording {
		return devErr("screenrecord is still running on %s: the stop file is left so it stops when it can, and %s may be cut short",
			d.Serial, segs[len(segs)-1].File)
	}
	emit(o, fmt.Sprintf("%d segments into %s (times.json), %s…%s", len(segs), dir, segs[0].File, segs[len(segs)-1].File),
		map[string]any{"segments": segs})
	return nil
}

// writeTimes writes D/times.json: the same segment list rec stop reports.
func writeTimes(dir string, segs []recSeg) error {
	b, err := json.Marshal(map[string]any{"segments": segs})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "times.json"), append(b, '\n'), 0o644)
}

func shotCmd(d Device, o opts) error {
	if len(o.pos) != 1 {
		return errors.New("shot needs one file: shot F")
	}
	path := o.pos[0]
	if err := shot(d, path); err != nil {
		return err
	}
	emit(o, path, map[string]any{"file": path})
	return nil
}

// Contact sheet geometry: 5 columns, at most 40 frames (phone.py sheet_plan defaults).
const (
	sheetCols      = 5
	sheetMaxFrames = 40
)

// sheetPlan is phone.py's sheet_plan: one frame every `every` seconds, tiled 5 wide, at most
// sheetMaxFrames frames (a long video is sampled wider instead of truncated). It chooses no tap.
func sheetPlan(duration, every float64, cols, maxFrames int) (vf string, step float64, frames int) {
	step = every
	if step <= 0 {
		step = 2
	}
	if duration <= 0 { // unknown duration: fill a full sheet at the requested step
		frames = maxFrames
	} else {
		frames = int(duration / step)
		if frames < 1 {
			frames = 1
		}
		if frames > maxFrames {
			step = duration / float64(maxFrames)
			frames = maxFrames
		}
	}
	rows := (frames + cols - 1) / cols
	if rows < 1 {
		rows = 1
	}
	vf = fmt.Sprintf("fps=1/%.3f,scale=180:-1,tile=%dx%d", step, cols, rows)
	return vf, step, frames
}

// sheetArgs is the ffmpeg command line: one tiled image, no audio.
func sheetArgs(video, out, vf string) []string {
	return []string{"-y", "-loglevel", "error", "-i", video, "-vf", vf, "-frames:v", "1", out}
}

// runHost runs a PC tool (ffmpeg, ffprobe), not adb.
func runHost(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return string(out), fmt.Errorf("%s did not answer in %s", name, timeout)
	}
	return string(out), err
}

func probeDuration(path string) float64 {
	out, err := runHost(60*time.Second, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path)
	if err != nil {
		return 0
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(out), 64)
	if err != nil {
		return 0
	}
	return d
}

func sheetCmd(_ Device, o opts) error {
	if len(o.pos) < 1 || len(o.pos) > 2 {
		return errors.New("sheet VIDEO OUT [--every 2]")
	}
	video := o.pos[0]
	out := strings.TrimSuffix(video, filepath.Ext(video)) + "-sheet.png"
	if len(o.pos) == 2 {
		out = o.pos[1]
	}
	if st, err := os.Stat(video); err != nil || st.IsDir() {
		return fmt.Errorf("sheet: no video at %s", video)
	}
	every := 2.0
	if s := o.val["every"]; s != "" {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return fmt.Errorf("--every %q: seconds between frames", s)
		}
		every = v
	}
	vf, _, frames := sheetPlan(probeDuration(video), every, sheetCols, sheetMaxFrames)
	if stdout, err := runHost(300*time.Second, "ffmpeg", sheetArgs(video, out, vf)...); err != nil {
		msg := firstLine(stdout)
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("ffmpeg: %s", msg)
	}
	emit(o, out, map[string]any{"file": out, "frames": frames})
	return nil
}
