package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Runner runs one adb command and returns its combined output; tests swap it.
type Runner func(timeout time.Duration, args ...string) (string, error)

func execAdb(timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "adb", args...).CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return string(out), fmt.Errorf("adb %s did not answer in %s", strings.Join(args, " "), timeout)
	}
	return string(out), err
}

// DeviceError is a problem with the device or adb, not with what is on screen: exit 3.
type DeviceError struct{ Msg string }

func (e DeviceError) Error() string { return e.Msg }

func devErr(format string, a ...any) error { return DeviceError{fmt.Sprintf(format, a...)} }

type Dev struct {
	Serial, State, Model string
}

// ParseDevices reads `adb devices -l`.
func ParseDevices(out string) []Dev {
	var ds []Dev
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 || strings.HasPrefix(line, "List of") || strings.HasPrefix(line, "*") {
			continue
		}
		d := Dev{Serial: f[0], State: f[1]}
		for _, x := range f[2:] {
			if strings.HasPrefix(x, "model:") {
				d.Model = strings.TrimPrefix(x, "model:")
			}
		}
		ds = append(ds, d)
	}
	return ds
}

// PickSerial: the flag or ANDROID_SERIAL, else the one ready device. Anything else is a DeviceError
// that names the devices and what to do.
func PickSerial(flag, env string, ds []Dev) (string, error) {
	if flag != "" {
		return flag, nil
	}
	if env != "" {
		return env, nil
	}
	var ready, other []string
	for _, d := range ds {
		desc := d.Serial
		if d.Model != "" {
			desc += " (" + d.Model + ")"
		}
		if d.State == "device" {
			ready = append(ready, desc)
		} else {
			other = append(other, desc+" "+d.State)
		}
	}
	switch {
	case len(ready) == 1:
		return strings.Fields(ready[0])[0], nil
	case len(ready) > 1:
		return "", devErr("several devices: %s; pass --serial S or set ANDROID_SERIAL", strings.Join(ready, ", "))
	case len(other) > 0:
		return "", devErr("no ready device (%s); run `droid connect`", strings.Join(other, ", "))
	default:
		return "", devErr("no device: run `droid connect` (phone) or start an emulator")
	}
}

type Device struct {
	Serial string
	run    Runner
}

func (d Device) Shell(timeout time.Duration, script string) (string, error) {
	out, err := d.run(timeout, "-s", d.Serial, "shell", script)
	if err != nil {
		if c := adbCause(out); c != "" {
			return out, devErr("%s: %s", d.Serial, c)
		}
	}
	return out, err
}

// adbCause names a transport failure in adb's output, or "".
func adbCause(out string) string {
	switch {
	case strings.Contains(out, "device offline"):
		return "device offline; run `droid connect`"
	case strings.Contains(out, "unauthorized"):
		return "unauthorized: accept the USB debugging prompt on the device"
	case strings.Contains(out, "not found") && strings.Contains(out, "device"):
		return "device not found; run `droid connect`"
	case strings.Contains(out, "no devices"):
		return "no device; run `droid connect`"
	}
	return ""
}

const nodesRemote = "/data/local/tmp/droid-nodes.dex"

// nodeDump is the raw XML from the resident NodeDump server (nodes.go): the dex is pushed when its
// size differs, the server started when it is not alive, and one adb round trip then yields a dump.
// It does not wait for an idle screen, so it works on a clock, a video or a spinner where
// uiautomator gives up after ~10 s.
func (d Device) nodeDump() (string, error) { return d.servedNodes() }

// ensureFile pushes an embedded file to the device unless one of the same size is already there.
func (d Device) ensureFile(data []byte, remote string) error {
	size, _ := d.Shell(10*time.Second, "stat -c %s "+remote+" 2>/dev/null")
	if strings.TrimSpace(size) == strconv.Itoa(len(data)) {
		return nil
	}
	tmp, err := os.CreateTemp("", "droid-*"+filepath.Ext(remote))
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	tmp.Write(data)
	tmp.Close()
	if out, err := d.run(30*time.Second, "-s", d.Serial, "push", tmp.Name(), remote); err != nil {
		return devErr("push %s: %s", remote, firstLine(out))
	}
	return nil
}

// Dump is the node list: the resident NodeDump server first (nodes.go), uiautomator after it. A
// phone where the server could not be brought up stays on uiautomator for an hour.
func (d Device) Dump() ([]Node, error) {
	raw, err := d.screenXML()
	if err != nil {
		var nm notMet
		if errors.As(err, &nm) {
			// the server is up but the window is gone for a moment: no list this time, not a failure
			return nil, NoIdle{}
		}
		return nil, err
	}
	return ParseDump(raw)
}

// NoIdle: uiautomator gave up waiting for the screen to stop changing (a clock, a video, a
// spinner). The device works; only the node list is unavailable, so a screenshot stands in.
type NoIdle struct{}

func (NoIdle) Error() string {
	return "the screen never goes idle (something keeps changing), so uiautomator gives no node list"
}

// State is the device as one line can say it.
type State struct {
	Wake, Top, Focus string
	Locked, Keyboard bool
	Booted           bool
	// KeyboardTop is the soft keyboard's top edge in device px, 0 when unknown or hidden.
	KeyboardTop int
	// TimeoutMs is screen_off_timeout; Awake is true while `droid awake` holds it.
	TimeoutMs int
	Awake     bool
}

const stateScript = beat + `dumpsys power 2>/dev/null | grep -m1 'mWakefulness='; ` +
	`dumpsys window 2>/dev/null | grep -E 'isKeyguardShowing=|mDreamingLockscreen=|mCurrentFocus='; ` +
	`dumpsys activity activities 2>/dev/null | grep -m1 -E 'topResumedActivity|ResumedActivity'; ` +
	`dumpsys input_method 2>/dev/null | grep -m1 'mInputShown='; ` +
	`dumpsys window 2>/dev/null | grep -m1 'type=ime frame='; ` +
	`echo boot=$(getprop sys.boot_completed); echo timeout=$(settings get system screen_off_timeout); ` +
	`[ -f ` + awakeDir + `/saved ] && echo awake=1`

var (
	wakeRe    = regexp.MustCompile(`mWakefulness=(\w+)`)
	actRe     = regexp.MustCompile(`ActivityRecord\{\S+ u\d+ (\S+?)(?: t\d+)?\}`)
	focusRe   = regexp.MustCompile(`mCurrentFocus=Window\{\S+ u\d+ ([^}]+)\}`)
	timeoutRe = regexp.MustCompile(`timeout=(\d+)`)
	imeRe     = regexp.MustCompile(`type=ime frame=\[\d+,(\d+)\]\[\d+,\d+\].*?visible=(true|false)`)
)

func ParseState(out string) State {
	var s State
	if m := wakeRe.FindStringSubmatch(out); m != nil {
		s.Wake = strings.ToLower(m[1])
	}
	s.Locked = strings.Contains(out, "isKeyguardShowing=true") || strings.Contains(out, "mDreamingLockscreen=true")
	s.Keyboard = strings.Contains(out, "mInputShown=true")
	if m := imeRe.FindStringSubmatch(out); m != nil && m[2] == "true" {
		s.Keyboard = true
		s.KeyboardTop, _ = strconv.Atoi(m[1])
	}
	s.Booted = strings.Contains(out, "boot=1")
	if m := timeoutRe.FindStringSubmatch(out); m != nil {
		s.TimeoutMs, _ = strconv.Atoi(m[1])
	}
	s.Awake = strings.Contains(out, "awake=1")
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "ResumedActivity") {
			if m := actRe.FindStringSubmatch(line); m != nil {
				s.Top = m[1]
				break
			}
		}
	}
	if m := focusRe.FindStringSubmatch(out); m != nil {
		s.Focus = strings.TrimSpace(m[1])
	}
	return s
}

func (s State) Line(serial string) string {
	lock := "unlocked"
	if s.Locked {
		lock = "LOCKED (unlock it on the device; PIN is never typed — `phone wait` waits for it)"
	}
	kb := "keyboard hidden"
	if s.Keyboard {
		kb = "keyboard shown"
	}
	top := s.Top
	if top == "" {
		top = "?"
	}
	line := fmt.Sprintf("%s · screen %s · %s · top %s · %s", serial, orQ(s.Wake), lock, top, kb)
	if pkg := strings.SplitN(s.Top, "/", 2)[0]; s.Focus != "" && (pkg == "" || !strings.HasPrefix(s.Focus, pkg+"/")) {
		line += " · window " + s.Focus
	}
	if !s.Awake && s.TimeoutMs > 0 && s.TimeoutMs < 10*60*1000 && !strings.HasPrefix(serial, "emulator-") {
		line += fmt.Sprintf(" · sleeps after %ds idle: run `droid awake` before a long job", s.TimeoutMs/1000)
	}
	if !s.Booted {
		line += " · NOT BOOTED (wait for sys.boot_completed=1)"
	}
	return line
}

func orQ(s string) string {
	if s == "" {
		return "?"
	}
	return s
}

func (d Device) State() (State, error) {
	out, err := d.Shell(15*time.Second, stateScript)
	var de DeviceError
	if errors.As(err, &de) {
		return State{}, err
	}
	return ParseState(out), nil
}

// Endpoint is one mdns service line.
type Endpoint struct{ Name, Kind, HostPort string }

func ParseMdns(out string) []Endpoint {
	var es []Endpoint
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 3 || !strings.HasPrefix(f[1], "_adb-tls-") {
			continue
		}
		es = append(es, Endpoint{Name: f[0], Kind: strings.TrimSuffix(strings.TrimPrefix(f[1], "_adb-tls-"), "._tcp"), HostPort: f[2]})
	}
	return es
}

// ConnectCause turns a failed `adb connect` into the reason and the next step.
func ConnectCause(out string, tcpOpen bool) string {
	switch {
	case strings.Contains(out, "unauthorized"):
		return "unauthorized: accept the debugging prompt on the phone, then rerun `droid connect`"
	case tcpOpen:
		return "the phone answers but refuses this PC: the pairing is gone. On the phone open 무선 디버깅 › 페어링 코드로 기기 페어링, then run `droid connect --pair IP:PORT CODE` with the numbers it shows"
	default:
		return "nothing listens there: 무선 디버깅 was turned off or the phone left the Wi-Fi; turn it on again and rerun `droid connect`"
	}
}

func tcpOpen(hostPort string) bool {
	c, err := net.DialTimeout("tcp", hostPort, 2*time.Second)
	if err != nil {
		return false
	}
	c.Close()
	return true
}
