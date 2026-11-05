// droid drives an Android device over adb in one call per step: each action waits until the
// screen settles and prints what is on it, so a session needs no `sleep`, no separate dump and no
// hand-parsed bounds. Exit 0 done, 1 usage, 2 the screen did not have what was asked (not found,
// timed out, text not typed), 3 the device or adb failed (the message says what to do).
package main

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

//go:embed java/clipset.dex
var clipsetDex []byte

//go:embed java/nodedump.dex
var nodedumpDex []byte

const usage = `droid <command> [--serial S] [--delay 700ms] [--settle 4s] [--shot f.png] [--all] [--quiet]

  version [--json]                the contract number callers check
  connect [--pair IP:PORT CODE]   find the device (mdns), connect, say why not
  awake [--idle 10m]              keep the screen on while droid calls keep coming; restores itself
  rest                            restore the screen timeout now
  state                           screen, lock, top activity, keyboard in one line
  look                            the screen: top activity, then one line per labeled node
  tap "<text>" [--exact] [--nth N] [--scroll] [--max 8]
  tap X Y                         tap, wait for the screen to settle, print it
  key BACK|HOME|ENTER|<code>      a key event, then the settled screen
  swipe up|down|left|right | X1 Y1 X2 Y2 [ms]
  type "<text>" [--replace] [--enter]   any text (Korean too) into the focused field, via the clipboard
  wait --text T [--gone] | --activity A  [--timeout 15s]
  media push <dir> <files...>     e.g. Pictures/Test: push, index for pickers, count
  media rm <dir>                  delete the dir and its media rows

After an action droid waits --delay, then dumps once (~2 s); --settle 4s dumps until two agree.
A node line is: label  (x,y to tap)  Class  flags. Exit 2: not on screen; 3: device/adb problem.`

type opts struct {
	pos    []string
	val    map[string]string
	flag   map[string]bool
	settle time.Duration
	delay  time.Duration
}

var valued = map[string]bool{"serial": true, "settle": true, "delay": true, "shot": true, "nth": true, "max": true, "text": true, "activity": true, "timeout": true, "pair": true, "idle": true,
	"model": true, "port": true, "code": true, "wait": true, "every": true, "segment": true, "dir": true, "pkg": true, "size": true, "bitrate": true}

func parse(args []string) (opts, error) {
	o := opts{val: map[string]string{}, flag: map[string]bool{}, delay: 700 * time.Millisecond}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" { // the rest is positional, untouched (adb passthrough)
			o.pos = append(o.pos, args[i:]...)
			break
		}
		if !strings.HasPrefix(a, "--") {
			o.pos = append(o.pos, a)
			continue
		}
		k := strings.TrimPrefix(a, "--")
		if eq := strings.IndexByte(k, '='); eq >= 0 {
			o.val[k[:eq]] = k[eq+1:]
			continue
		}
		if valued[k] {
			if i+1 >= len(args) {
				return o, fmt.Errorf("--%s needs a value", k)
			}
			o.val[k] = args[i+1]
			i++
			if k == "pair" && i+1 < len(args) && !strings.HasPrefix(args[i+1], "--") {
				o.val["code"] = args[i+1]
				i++
			}
			continue
		}
		o.flag[k] = true
	}
	if s := o.val["settle"]; s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			return o, fmt.Errorf("--settle %q: %v", s, err)
		}
		o.settle = d
	}
	if s := o.val["delay"]; s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			return o, fmt.Errorf("--delay %q: %v", s, err)
		}
		o.delay = d
	}
	return o, nil
}

// command takes the first positional word as the command, so flags may come before it
// (`droid --serial S state`) as well as after.
func command(args []string) (string, opts, error) {
	if len(args) > 0 && args[0] == "dump" { // dump --text is a switch, wait --text T takes a value
		args = append([]string(nil), args...)
		for i, a := range args {
			if a == "--text" {
				args[i] = "--text=1"
			}
		}
	}
	o, err := parse(args)
	if err != nil {
		return "", o, err
	}
	if len(o.pos) == 0 {
		return "", o, errors.New("no command; run `droid help`")
	}
	cmd := o.pos[0]
	o.pos = o.pos[1:]
	return cmd, o, nil
}

func main() {
	if len(os.Args) < 2 || os.Args[1] == "-h" || os.Args[1] == "--help" || os.Args[1] == "help" {
		fmt.Println(usage)
		return
	}
	cmd, o, err := command(os.Args[1:])
	jsonMode = o.flag["json"]
	if err != nil {
		fail(1, err.Error())
	}
	err = run(cmd, o, execAdb)
	var de DeviceError
	var nf notMet
	switch {
	case err == nil:
	case errors.As(err, &de):
		fail(3, de.Msg)
	case errors.As(err, &nf):
		fail(2, nf.Msg)
	default:
		fail(1, err.Error())
	}
}

// jsonMode: --json was given, so a failure also prints {"ok":false,"exit":N,"error":"…"} on stdout.
var jsonMode bool

func fail(code int, msg string) {
	if jsonMode {
		b, _ := json.Marshal(map[string]any{"ok": false, "exit": code, "error": msg})
		fmt.Println(string(b))
	}
	fmt.Fprintln(os.Stderr, "✗ "+msg)
	os.Exit(code)
}

// notMet: the device works but the screen did not have what was asked: exit 2.
type notMet struct{ Msg string }

func (e notMet) Error() string { return e.Msg }

// emit prints a result: with --json one object ({"ok":true} plus fields), else the human line
// (nothing when it is empty).
func emit(o opts, human string, fields map[string]any) {
	if o.flag["json"] {
		m := map[string]any{"ok": true}
		for k, v := range fields {
			m[k] = v
		}
		b, _ := json.Marshal(m)
		fmt.Println(string(b))
		return
	}
	if human != "" {
		fmt.Println(human)
	}
}

// contract: bumped when a command's flags or --json fields change in a way callers must know.
const contract = 2

func run(cmd string, o opts, r Runner) error {
	if cmd == "version" {
		if o.flag["json"] {
			fmt.Printf("{\"contract\":%d}\n", contract)
		} else {
			fmt.Printf("droid contract %d\n", contract)
		}
		return nil
	}
	switch cmd {
	case "connect":
		return connect(o, r)
	case "serial":
		return serialCmd(o, r)
	case "pair":
		return pairCmd(o, r)
	case "adb":
		return adbCmd(o, r)
	}
	d, err := device(o, r)
	if err != nil {
		return err
	}
	switch cmd {
	case "state":
		s, err := d.State()
		if err != nil {
			return err
		}
		fmt.Println(s.Line(d.Serial))
		return nil
	case "look":
		return show(d, o, nil, "")
	case "tap":
		return tap(d, o)
	case "key":
		if len(o.pos) != 1 {
			return errors.New("key needs one key: BACK, HOME, ENTER or a keycode")
		}
		k := strings.ToUpper(o.pos[0])
		if _, err := strconv.Atoi(k); err != nil && !strings.HasPrefix(k, "KEYCODE_") {
			k = "KEYCODE_" + k
		}
		if _, err := d.Shell(10*time.Second, "input keyevent "+k); err != nil {
			return err
		}
		return settleShow(d, o, "key "+k)
	case "swipe":
		return swipe(d, o)
	case "type":
		return typeText(d, o)
	case "wait":
		return wait(d, o)
	case "media":
		return media(d, o)
	case "awake":
		return awake(d, o)
	case "rest":
		if o.flag["nodes"] || o.flag["all"] {
			if err := stopNodes(d); err != nil {
				return err
			}
			if !o.flag["all"] {
				emit(o, "nodes stopped", nil)
				return nil
			}
		}
		return rest(d, o)
	case "lock":
		return lockCmd(d, o)
	case "dump":
		return dumpCmd(d, o)
	case "overlay":
		return overlayCmd(d, o)
	case "rec":
		return recCmd(d, o)
	case "shot":
		return shotCmd(d, o)
	case "sheet":
		return sheetCmd(d, o)
	}
	return fmt.Errorf("unknown command %q\n%s", cmd, usage)
}

func device(o opts, r Runner) (Device, error) {
	return pickDevice(o, r)
}

// plainDevice: --serial, then $ANDROID_SERIAL, then the only ready device. connect.go's
// pickDevice adds --model on top of it.
func plainDevice(o opts, r Runner) (Device, error) {
	if s := o.val["serial"]; s != "" {
		return Device{s, r}, nil
	}
	if s := os.Getenv("ANDROID_SERIAL"); s != "" {
		return Device{s, r}, nil
	}
	out, err := r(10*time.Second, "devices", "-l")
	if err != nil && out == "" {
		return Device{}, devErr("adb did not run: %v", err)
	}
	s, err := PickSerial("", "", ParseDevices(out))
	return Device{s, r}, err
}

// settle waits `delay`, dumps, and with a budget keeps dumping until two in a row are equal (or the
// budget is spent). Without one, the single dump counts as settled: transitions are instant with
// animations off, and a screen that loads slowly is `wait --text`'s job.
func settle(d Device, delay, budget time.Duration) ([]Node, bool, error) {
	time.Sleep(delay)
	if budget <= 0 {
		nodes, err := d.Dump()
		return nodes, err == nil, err
	}
	deadline := time.Now().Add(budget)
	var prev string
	for {
		nodes, err := d.Dump()
		if err != nil {
			return nil, false, err
		}
		sig := Signature(nodes)
		if sig == prev {
			return nodes, true, nil
		}
		if time.Now().After(deadline) {
			return nodes, false, nil
		}
		prev = sig
		time.Sleep(300 * time.Millisecond)
	}
}

func settleShow(d Device, o opts, did string) error {
	if o.flag["no-look"] {
		emit(o, "", map[string]any{"did": did})
		return nil
	}
	t0 := time.Now()
	nodes, stable, err := settle(d, o.delay, o.settle)
	var ni NoIdle
	if errors.As(err, &ni) {
		return noIdleShow(d, o, did)
	}
	if err != nil {
		return err
	}
	note := fmt.Sprintf("%s · %.1fs", did, time.Since(t0).Seconds())
	if !stable {
		note = fmt.Sprintf("%s · still changing after %s", did, o.settle)
	}
	return show(d, o, nodes, note)
}

// noIdleShow reports an action that ran on a screen with no node list: the top activity and a
// screenshot to look at instead, exit 0, since the action itself went through.
func noIdleShow(d Device, o opts, did string) error {
	st, err := d.State()
	if err != nil {
		return err
	}
	p := o.val["shot"]
	if p == "" {
		p = fmt.Sprintf("%s/droid-%d.png", os.TempDir(), time.Now().UnixMilli())
	}
	if err := shot(d, p); err != nil {
		return err
	}
	if did != "" {
		did += " · "
	}
	fmt.Printf("%stop %s · no node list: %s; look at the shot: %s\n", did, orQ(st.Top), NoIdle{}.Error(), p)
	return nil
}

// show prints the header (top activity, lock, counts) and the node lines.
func show(d Device, o opts, nodes []Node, note string) error {
	var err error
	if nodes == nil {
		if nodes, err = d.Dump(); err != nil {
			var ni NoIdle
			if errors.As(err, &ni) {
				return noIdleShow(d, o, note)
			}
			return err
		}
	}
	st, err := d.State()
	if err != nil {
		return err
	}
	shown := Shown(nodes, o.flag["all"])
	head := fmt.Sprintf("top %s · %d nodes, %d shown", orQ(st.Top), len(nodes), len(shown))
	if st.Locked {
		head += " · LOCKED"
	}
	if st.Keyboard {
		head += " · keyboard shown"
	}
	if note != "" {
		head = note + " · " + head
	}
	fmt.Println(head)
	if p := o.val["shot"]; p != "" {
		if err := shot(d, p); err != nil {
			return err
		}
		fmt.Println("shot " + p)
	}
	if o.flag["quiet"] {
		return nil
	}
	for _, n := range shown {
		fmt.Println("  " + Line(n))
	}
	return nil
}

func shot(d Device, path string) error {
	out, err := d.run(20*time.Second, "-s", d.Serial, "exec-out", "screencap", "-p")
	if err != nil || !strings.HasPrefix(out, "\x89PNG") {
		return devErr("screencap failed: %s", firstLine(out))
	}
	return os.WriteFile(path, []byte(out), 0o644)
}

func screenSize(d Device) (int, int, error) {
	out, err := d.Shell(10*time.Second, "wm size")
	if err != nil {
		return 0, 0, err
	}
	re := regexp.MustCompile(`(\d+)x(\d+)`)
	ms := re.FindAllStringSubmatch(out, -1)
	if len(ms) == 0 {
		return 0, 0, devErr("wm size: %s", firstLine(out))
	}
	m := ms[len(ms)-1] // Override size, when set, comes last
	w, _ := strconv.Atoi(m[1])
	h, _ := strconv.Atoi(m[2])
	return w, h, nil
}

// xy parses "X,Y", the raw form: input only, no settle and no screen print (as --no-look).
func xy(s string) (int, int, bool) {
	a, b, ok := strings.Cut(s, ",")
	if !ok {
		return 0, 0, false
	}
	x, ex := strconv.Atoi(a)
	y, ey := strconv.Atoi(b)
	return x, y, ex == nil && ey == nil
}

func tap(d Device, o opts) error {
	if len(o.pos) == 1 {
		if x, y, ok := xy(o.pos[0]); ok {
			if _, err := d.Shell(10*time.Second, fmt.Sprintf("input tap %d %d", x, y)); err != nil {
				return err
			}
			o.flag["no-look"] = true
			return settleShow(d, o, fmt.Sprintf("tap (%d,%d)", x, y))
		}
	}
	if len(o.pos) == 2 {
		x, ex := strconv.Atoi(o.pos[0])
		y, ey := strconv.Atoi(o.pos[1])
		if ex == nil && ey == nil {
			if _, err := d.Shell(10*time.Second, fmt.Sprintf("input tap %d %d", x, y)); err != nil {
				return err
			}
			return settleShow(d, o, fmt.Sprintf("tap (%d,%d)", x, y))
		}
	}
	if len(o.pos) != 1 {
		return errors.New(`tap needs "<text>" or X Y`)
	}
	q := o.pos[0]
	nth := 1
	if s := o.val["nth"]; s != "" {
		nth, _ = strconv.Atoi(s)
	}
	maxScroll := 8
	if s := o.val["max"]; s != "" {
		maxScroll, _ = strconv.Atoi(s)
	}
	nodes, err := d.Dump()
	if err != nil {
		return err
	}
	scrolls := 0
	for {
		hits := Find(nodes, q, o.flag["exact"])
		if len(hits) >= nth && nth >= 1 {
			n := hits[nth-1]
			if _, err := d.Shell(10*time.Second, fmt.Sprintf("input tap %d %d", n.CX(), n.CY())); err != nil {
				return err
			}
			did := fmt.Sprintf("tap %q (%d,%d)", n.Label(), n.CX(), n.CY())
			if len(hits) > 1 {
				did += fmt.Sprintf(" [%d of %d matches; --nth to pick]", nth, len(hits))
			}
			if scrolls > 0 {
				did += fmt.Sprintf(" after %d scrolls", scrolls)
			}
			return settleShow(d, o, did)
		}
		if !o.flag["scroll"] || scrolls >= maxScroll {
			break
		}
		x, y1, y2, err := scrollLine(d, nodes)
		if err != nil {
			return err
		}
		before := Signature(nodes)
		if _, err := d.Shell(10*time.Second, fmt.Sprintf("input swipe %d %d %d %d 400", x, y1, x, y2)); err != nil {
			return err
		}
		scrolls++
		time.Sleep(500 * time.Millisecond)
		if nodes, err = d.Dump(); err != nil {
			return err
		}
		if Signature(nodes) == before {
			return notMet{fmt.Sprintf("not found: %q; the list ended after %d scrolls. On screen: %s", q, scrolls, Labels(nodes, 25))}
		}
	}
	return notMet{fmt.Sprintf("not found: %q (%d scrolls). On screen: %s", q, scrolls, Labels(nodes, 25))}
}

// scrollLine is a finger-up swipe inside the largest scrollable node (the whole screen when none
// is), kept above the soft keyboard, which the dump does not show and a swipe would type on.
func scrollLine(d Device, nodes []Node) (x, y1, y2 int, err error) {
	w, h, err := screenSize(d)
	if err != nil {
		return 0, 0, 0, err
	}
	top, bottom, x := 0, h, w/2
	area := 0
	for _, n := range nodes {
		if a := (n.X2 - n.X1) * (n.Y2 - n.Y1); n.Scrollable && a > area {
			area, top, bottom, x = a, n.Y1, n.Y2, n.CX()
		}
	}
	if st, err := d.State(); err == nil && st.Keyboard {
		limit := h * 45 / 100
		if st.KeyboardTop > 0 {
			limit = st.KeyboardTop - h/50
		}
		if bottom > limit {
			bottom = limit
		}
	}
	span := bottom - top
	return x, top + span*8/10, top + span*2/10, nil
}

func swipe(d Device, o opts) error {
	var x1, y1, x2, y2, ms int
	ms = 350
	if len(o.pos) >= 2 && len(o.pos) <= 3 {
		if a, b, ok := xy(o.pos[0]); ok {
			c, e, ok2 := xy(o.pos[1])
			if !ok2 {
				return errors.New("swipe X1,Y1 X2,Y2 [ms]")
			}
			if len(o.pos) == 3 {
				n, err := strconv.Atoi(o.pos[2])
				if err != nil {
					return fmt.Errorf("swipe: %q is not a number of ms", o.pos[2])
				}
				ms = n
			}
			if _, err := d.Shell(10*time.Second, fmt.Sprintf("input swipe %d %d %d %d %d", a, b, c, e, ms)); err != nil {
				return err
			}
			o.flag["no-look"] = true
			return settleShow(d, o, fmt.Sprintf("swipe (%d,%d)→(%d,%d)", a, b, c, e))
		}
	}
	switch len(o.pos) {
	case 1:
		w, h, err := screenSize(d)
		if err != nil {
			return err
		}
		cy := h / 2
		switch o.pos[0] {
		case "up", "down": // finger up: the content scrolls toward its end; kept above the keyboard
			x, a, b, err := scrollLine(d, nil)
			if err != nil {
				return err
			}
			x1, y1, x2, y2 = x, a, x, b
			if o.pos[0] == "down" {
				y1, y2 = b, a
			}
		case "left":
			x1, y1, x2, y2 = w*8/10, cy, w*2/10, cy
		case "right":
			x1, y1, x2, y2 = w*2/10, cy, w*8/10, cy
		default:
			return errors.New("swipe up|down|left|right or X1 Y1 X2 Y2 [ms]")
		}
	case 4, 5:
		v := make([]int, len(o.pos))
		for i, p := range o.pos {
			n, err := strconv.Atoi(p)
			if err != nil {
				return fmt.Errorf("swipe: %q is not a number", p)
			}
			v[i] = n
		}
		x1, y1, x2, y2 = v[0], v[1], v[2], v[3]
		if len(v) == 5 {
			ms = v[4]
		}
	default:
		return errors.New("swipe up|down|left|right or X1 Y1 X2 Y2 [ms]")
	}
	if _, err := d.Shell(10*time.Second, fmt.Sprintf("input swipe %d %d %d %d %d", x1, y1, x2, y2, ms)); err != nil {
		return err
	}
	return settleShow(d, o, fmt.Sprintf("swipe (%d,%d)→(%d,%d)", x1, y1, x2, y2))
}

const dexRemote = "/data/local/tmp/droid-clipset.dex"

// typeText sets the clipboard through app_process (no app on the device) and pastes, since
// `input text` drops non-ASCII and mangles spaces and quotes. It then reads the focused field back.
func typeText(d Device, o opts) error {
	if len(o.pos) != 1 {
		return errors.New(`type needs one "<text>" argument`)
	}
	text := o.pos[0]
	if err := d.ensureFile(clipsetDex, dexRemote); err != nil {
		return err
	}
	b64 := base64.StdEncoding.EncodeToString([]byte(text))
	out, err := d.Shell(15*time.Second, "app_process -cp "+dexRemote+" /system/bin ClipSet "+b64)
	if err != nil || !strings.Contains(out, "ok") {
		return devErr("setting the clipboard failed: %s", firstLine(out))
	}
	script := "input keyevent 279"
	if o.flag["replace"] {
		script = "input keycombination 113 29; " + script
	}
	if o.flag["enter"] {
		script += "; input keyevent 66"
	}
	if _, err := d.Shell(10*time.Second, script); err != nil {
		return err
	}
	if o.flag["no-look"] { // the caller reads the field back itself
		emit(o, "", map[string]any{"did": fmt.Sprintf("typed %d chars", len([]rune(text)))})
		return nil
	}
	nodes, _, err := settle(d, o.delay, o.settle)
	if err != nil {
		return err
	}
	f, ok := Focused(nodes)
	probe := strings.Fields(text)
	want := text
	if len(probe) > 0 {
		want = probe[0]
	}
	if !ok || (!f.Password && !strings.Contains(f.Text, want)) {
		where := "no field has focus"
		if ok {
			where = fmt.Sprintf("the focused field reads %q", f.Text)
		}
		show(d, o, nodes, "type")
		return notMet{fmt.Sprintf("typed text is not in the focused field (%s): tap the field first, then type again", where)}
	}
	return show(d, o, nodes, fmt.Sprintf("typed %d chars into %q", len([]rune(text)), shortClass(f.Class)))
}

func wait(d Device, o opts) error {
	timeout := 15 * time.Second
	if s := o.val["timeout"]; s != "" {
		t, err := time.ParseDuration(s)
		if err != nil {
			return fmt.Errorf("--timeout %q: %v", s, err)
		}
		timeout = t
	}
	text, act := o.val["text"], o.val["activity"]
	if text == "" && act == "" {
		return errors.New("wait needs --text T or --activity A")
	}
	t0 := time.Now()
	if text == "" { // an activity needs no dump: poll the one-line state
		for {
			st, err := d.State()
			if err != nil {
				return err
			}
			if strings.Contains(st.Top, act) {
				fmt.Printf("waited %.1fs · %s\n", time.Since(t0).Seconds(), st.Line(d.Serial))
				return nil
			}
			if time.Since(t0) > timeout {
				return notMet{fmt.Sprintf("timed out after %s waiting for activity %s; %s", timeout, act, st.Line(d.Serial))}
			}
			time.Sleep(300 * time.Millisecond)
		}
	}
	var nodes []Node
	for {
		var err error
		if nodes, err = d.Dump(); err != nil {
			var ni NoIdle
			if !errors.As(err, &ni) {
				return err
			}
			nodes = nil // not idle yet: keep waiting
		}
		met := true
		if text != "" {
			found := len(Find(nodes, text, o.flag["exact"])) > 0
			met = nodes != nil && found != o.flag["gone"]
		}
		if act != "" && met {
			st, err := d.State()
			if err != nil {
				return err
			}
			met = strings.Contains(st.Top, act)
		}
		if met {
			return show(d, o, nodes, fmt.Sprintf("waited %.1fs", time.Since(t0).Seconds()))
		}
		if time.Since(t0) > timeout {
			st, _ := d.State()
			return notMet{fmt.Sprintf("timed out after %s waiting for %s; top %s; on screen: %s", timeout, condition(text, act, o.flag["gone"]), orQ(st.Top), Labels(nodes, 20))}
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func condition(text, act string, gone bool) string {
	var c []string
	if text != "" {
		if gone {
			c = append(c, fmt.Sprintf("%q to go", text))
		} else {
			c = append(c, fmt.Sprintf("%q", text))
		}
	}
	if act != "" {
		c = append(c, "activity "+act)
	}
	return strings.Join(c, " and ")
}

var rowRe = regexp.MustCompile(`(?m)^Row: `)

func media(d Device, o opts) error {
	if len(o.pos) < 2 || (o.pos[0] != "push" && o.pos[0] != "rm") {
		return errors.New("media push <dir> <files...> | media rm <dir>")
	}
	dir := strings.Trim(strings.TrimPrefix(o.pos[1], "/sdcard/"), "/")
	if dir == "" || strings.Contains(dir, "..") {
		return fmt.Errorf("media: %q is not a dir under /sdcard", o.pos[1])
	}
	where := fmt.Sprintf(`"relative_path='%s/'"`, dir)
	count := func() int {
		out, _ := d.Shell(15*time.Second, "content query --uri content://media/external/images/media --projection _id --where "+where)
		return len(rowRe.FindAllString(out, -1))
	}
	if o.pos[0] == "rm" {
		n := count()
		if _, err := d.Shell(20*time.Second, fmt.Sprintf("rm -rf %s; content delete --uri content://media/external/images/media --where %s", shellQuote("/sdcard/"+dir), where)); err != nil {
			return err
		}
		emit(o, fmt.Sprintf("removed /sdcard/%s and %d media rows; left %d", dir, n, count()), map[string]any{"count": n})
		return nil
	}
	files := o.pos[2:]
	if len(files) == 0 {
		return errors.New("media push <dir> <files...>")
	}
	remote := "/sdcard/" + dir
	if _, err := d.Shell(10*time.Second, "mkdir -p "+shellQuote(remote)); err != nil {
		return err
	}
	// Files of any number: each adb call carries a batch (argv has a limit) and the scan script is
	// built per batch, so it stays short too. Every remote path goes through shellQuote, so a name
	// with spaces, quotes or non-ASCII survives the trip into the phone's shell.
	const batch = 64
	for start := 0; start < len(files); start += batch {
		chunk := files[start:min(start+batch, len(files))]
		args := append([]string{"-s", d.Serial, "push"}, chunk...)
		args = append(args, remote+"/")
		if out, err := d.run(120*time.Second, args...); err != nil {
			return devErr("push: %s", firstLine(out))
		}
		scan := make([]string, 0, len(chunk))
		for _, f := range chunk {
			base := f[strings.LastIndexByte(f, '/')+1:]
			scan = append(scan, "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "+
				shellQuote("file://"+remote+"/"+base)+" >/dev/null")
		}
		if _, err := d.Shell(60*time.Second, strings.Join(scan, "; ")); err != nil {
			return err
		}
	}
	var n int
	for i := 0; i < 20; i++ {
		if n = count(); n >= len(files) {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	human := fmt.Sprintf("pushed %d files to /sdcard/%s; %d indexed for pickers", len(files), dir, n)
	if n < len(files) {
		return notMet{human + fmt.Sprintf(": only %d of %d are in the media index, so a picker will not show the rest", n, len(files))}
	}
	emit(o, human, map[string]any{"count": n})
	return nil
}
