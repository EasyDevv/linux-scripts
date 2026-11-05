package main

// nodes.go: the resident NodeDump server, `dump [--text]` and `rest --nodes`.
//
// NodeDump.java runs from app_process (no app installed) and writes the accessibility tree into a
// file, so after the first request a dump is one adb round trip, and it never waits for an idle
// screen (a clock, a video, a spinner). The server starts with the first request and exits after
// nodesIdleSec without one, or when its directory is gone, so a dead PC leaves nothing behind.
//
// A phone where the server could not be brought up is remembered for an hour
// (nodedump-off-<serial> in the cache dir) and served by uiautomator meanwhile: the two cannot run
// at the same time, because UiAutomation holds one connection and the server has it.

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	// nodesDir is the phone-side directory: pid, log, req, out.
	nodesDir = "/data/local/tmp/droid-nodes"
	// nodesIdleS is how long the server waits for the next request before it ends.
	nodesIdleS = 120
	// nodeDumpOffAge is how long a phone that failed stays on uiautomator.
	nodeDumpOffAge = time.Hour
	// nodesPoll: 250 × 20 ms = 5 s for one dump, long enough for the server to start on a cold phone.
	nodesPoll = 250
)

// serveScript is one request to the resident server in one adb round trip. It pushes nothing: when
// the dex is not the embedded one it only answers NODES_PUSH and the caller pushes. Otherwise it
// starts the server if its pid is not alive, drops the previous answer, touches DIR/req and waits up
// to 5 s for DIR/out, which it then cats. NODES_TIMEOUT plus the tail of DIR/log means no answer.
func serveScript() string {
	d, x := nodesDir, nodesRemote
	size := strconv.Itoa(len(nodedumpDex))
	return beat +
		`[ "$(stat -c %s ` + x + ` 2>/dev/null)" = "` + size + `" ] || { echo NODES_PUSH; exit 0; }; ` +
		`if ! { [ -f ` + d + `/pid ] && kill -0 $(cat ` + d + `/pid) 2>/dev/null; }; then mkdir -p ` + d + `; ` +
		`nohup app_process -cp /system/framework/uiautomator.jar:` + x + ` /system/bin NodeDump serve ` +
		d + ` ` + strconv.Itoa(nodesIdleS) + ` >` + d + `/log 2>&1 & echo $! > ` + d + `/pid; fi; ` +
		`rm -f ` + d + `/out; touch ` + d + `/req; i=0; ` +
		`while [ ! -f ` + d + `/out ] && [ $i -lt ` + strconv.Itoa(nodesPoll) + ` ]; do sleep 0.02; i=$((i+1)); done; ` +
		`if [ -f ` + d + `/out ]; then cat ` + d + `/out; else echo NODES_TIMEOUT; tail -n 3 ` + d + `/log; fi`
}

// stopNodesScript kills the server by its pid file and removes the directory; the rm is what ends a
// server whose pid file is already gone.
func stopNodesScript() string {
	d := nodesDir
	return beat + `[ -f ` + d + `/pid ] && kill $(cat ` + d + `/pid) 2>/dev/null; rm -rf ` + d + `; true`
}

// servedNodes asks the resident server for the tree. Three attempts: the first pushes the dex when
// its size differs, a timeout means the server died or hung and is stopped before the retry. A
// DeviceError is an adb failure (exit 3), a notMet is the server answering "no window" (this read
// only), anything else means the server could not be brought up at all.
func (d Device) servedNodes() (string, error) {
	for attempt := 0; attempt < 3; attempt++ {
		out, err := d.Shell(25*time.Second, serveScript())
		var de DeviceError
		if errors.As(err, &de) {
			return "", err
		}
		raw := strings.TrimSpace(out)
		switch {
		case strings.HasPrefix(raw, "<?xml"):
			return raw, nil
		case strings.Contains(raw, "NODES_PUSH"), strings.Contains(raw, "DROID_PUSH"):
			// the dex is old or missing: push it and ask again
			if perr := d.ensureFile(nodedumpDex, nodesRemote); perr != nil {
				return "", perr
			}
		case strings.Contains(raw, "NODES_TIMEOUT"):
			d.stopNodeServer()
		case strings.HasPrefix(raw, "ERROR:"):
			return "", notMet{"empty screen: " + firstLine(raw)}
		case raw == "":
			return "", errors.New("NodeDump: the serve script said nothing")
		default:
			return "", fmt.Errorf("NodeDump: %s", firstLine(raw))
		}
	}
	return "", errors.New("NodeDump: no answer after 3 tries")
}

// stopNodeServer ends the server and removes its directory.
func (d Device) stopNodeServer() error {
	_, err := d.Shell(10*time.Second, stopNodesScript())
	return err
}

// stopNodes stops the resident server (`rest --nodes`).
func stopNodes(d Device) error { return d.stopNodeServer() }

// screenXML is the screen XML: the resident server first, uiautomator after it. A server that could
// not be brought up is stopped (uiautomator cannot connect while its UiAutomation is alive) and the
// phone is marked off for an hour. A notMet (no window for a moment) is this read only: the server
// stays up for the next one.
func (d Device) screenXML() (string, error) {
	if !nodeDumpOff(d.Serial) {
		raw, err := d.nodeDump()
		var de DeviceError
		var nm notMet
		switch {
		case err == nil:
			return raw, nil
		case errors.As(err, &de), errors.As(err, &nm):
			return "", err
		}
		d.stopNodeServer()
		markNodeDumpOff(d.Serial)
	}
	return d.uiautomatorXML()
}

// uiautomatorXML is `uiautomator dump` in one round trip (exec-out to /dev/tty, about 2 s), retried
// once unless it said "could not get idle state" (~10 s each).
func (d Device) uiautomatorXML() (string, error) {
	var last string
	for i := 0; i < 2; i++ {
		if i > 0 && strings.Contains(last, "idle state") {
			break // a screen that never idles will not idle on the second try either
		}
		out, err := d.run(15*time.Second, "-s", d.Serial, "exec-out", "uiautomator", "dump", "/dev/tty")
		if c := adbCause(out); c != "" {
			return "", devErr("%s: %s", d.Serial, c)
		}
		if i == 0 && strings.Contains(out, "Killed") {
			// a NodeDump server left running (NODE_DUMP=off set mid-run) holds the one UiAutomation
			d.stopNodeServer()
		}
		if _, perr := ParseDump(out); perr == nil {
			if i := strings.LastIndex(out, "</hierarchy>"); i >= 0 {
				out = out[:i+len("</hierarchy>")] // drop "UI hierchary dumped to: /dev/tty"
			}
			return out, nil
		} else if strings.TrimSpace(out) == "" && err != nil {
			last = firstLine(err.Error())
		} else {
			last = perr.Error()
		}
		time.Sleep(400 * time.Millisecond)
	}
	if strings.Contains(last, "idle state") {
		return "", NoIdle{}
	}
	return "", devErr("uiautomator dump failed twice: %s", last)
}

// dumpText: --text is a flag, but main.go's parser lists it as a valued flag for `wait --text T`, so
// take it either way.
func dumpText(o opts) bool { return o.flag["text"] || o.val["text"] != "" }

// dumpCmd prints the raw XML on stdout (the one command that does not go through emit), or with
// --text one Line per node, every node and not only the labeled ones.
func dumpCmd(d Device, o opts) error {
	raw, err := d.screenXML()
	if err != nil {
		return err
	}
	nodes, err := ParseDump(raw)
	if err != nil {
		return err
	}
	if !dumpText(o) {
		if !strings.HasSuffix(raw, "\n") {
			raw += "\n"
		}
		fmt.Print(raw)
		return nil
	}
	for _, n := range Shown(nodes, true) {
		fmt.Println(Line(n))
	}
	return nil
}

// nodeCacheDir is where droid keeps what it must remember between calls: $DROID_CACHE, else
// ~/.cache/droid.
func nodeCacheDir() string {
	if dir := os.Getenv("DROID_CACHE"); dir != "" {
		return dir
	}
	if home, err := os.UserCacheDir(); err == nil {
		return filepath.Join(home, "droid")
	}
	return ""
}

// nodeDumpOffPath is the marker for a phone NodeDump failed on, or "" when it cannot be kept.
func nodeDumpOffPath(serial string) string {
	dir := nodeCacheDir()
	if dir == "" || serial == "" {
		return ""
	}
	name := strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ' ', '\n', '\t':
			return '_'
		}
		return r
	}, serial)
	return filepath.Join(dir, "nodedump-off-"+name)
}

// nodeDumpEnvOff: DROID_NODEDUMP=off or NODE_DUMP=off forces uiautomator, for a phone that misbehaves.
func nodeDumpEnvOff() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("DROID_NODEDUMP")), "off") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_DUMP")), "off")
}

// nodeDumpOff is true while the phone is on uiautomator: forced by the environment, or marked in the
// last hour. An older mark is dropped, so NodeDump gets one more chance.
func nodeDumpOff(serial string) bool {
	if nodeDumpEnvOff() {
		return true
	}
	p := nodeDumpOffPath(serial)
	if p == "" {
		return false
	}
	st, err := os.Stat(p)
	if err != nil {
		return false
	}
	if time.Since(st.ModTime()) >= nodeDumpOffAge {
		os.Remove(p)
		return false
	}
	return true
}

// markNodeDumpOff remembers that this phone's server failed, so the next calls skip it.
func markNodeDumpOff(serial string) {
	p := nodeDumpOffPath(serial)
	if p == "" {
		return
	}
	os.MkdirAll(filepath.Dir(p), 0o755)
	os.WriteFile(p, []byte(time.Now().Format(time.RFC3339)+"\n"), 0o644)
}
