package main

import (
	"strings"
	"testing"
	"time"
)

const dumpA = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">` +
	`<node index="0" text="" class="android.widget.FrameLayout" package="com.x" content-desc="" clickable="false" bounds="[0,0][1080,2400]">` +
	`<node index="0" text="내 물건 팔기" class="android.widget.TextView" package="com.x" content-desc="" clickable="true" bounds="[659,1760][876,1822]"/>` +
	`<node index="1" text="" class="android.view.View" package="com.x" content-desc="작성 완료" clickable="true" bounds="[45,2129][1035,2275]"/>` +
	`<node index="2" text="" class="android.widget.CheckBox" package="com.x" content-desc="" checkable="true" checked="false" bounds="[0,795][356,1151]"/>` +
	`<node index="3" text="" class="android.view.View" package="com.x" content-desc="" bounds="[0,0][10,10]"/>` +
	`<node index="4" text="제목" class="android.widget.EditText" package="com.x" content-desc="" focused="true" bounds="[51,629][990,691]"/>` +
	`</node></hierarchy>UI hierchary dumped to: /dev/tty`

func TestParseAndLines(t *testing.T) {
	nodes, err := ParseDump(dumpA)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 6 {
		t.Fatalf("nodes %d", len(nodes))
	}
	shown := Shown(nodes, false)
	if len(shown) != 4 {
		t.Fatalf("shown %d: %v", len(shown), shown)
	}
	got := []string{}
	for _, n := range shown {
		got = append(got, Line(n))
	}
	want := []string{
		"내 물건 팔기  (767,1791)  TextView  clk",
		"작성 완료  (540,2202)  View  clk",
		"·  (178,973)  CheckBox  unchecked",
		"제목  (520,660)  EditText  focus",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("lines:\n%s", strings.Join(got, "\n"))
	}
	if f, ok := Focused(nodes); !ok || f.Text != "제목" {
		t.Fatalf("focused %v %v", f, ok)
	}
	if _, err := ParseDump("ERROR: could not get idle state."); err == nil {
		t.Fatal("a dump without a hierarchy must fail")
	}
}

func TestFindPrefersExact(t *testing.T) {
	nodes, _ := ParseDump(dumpA)
	hits := Find(nodes, "물건", false)
	if len(hits) != 1 || hits[0].Text != "내 물건 팔기" {
		t.Fatalf("substring %v", hits)
	}
	if len(Find(nodes, "물건", true)) != 0 {
		t.Fatal("exact must not match a substring")
	}
	if h := Find(nodes, "작성 완료", true); len(h) != 1 || h[0].CY() != 2202 {
		t.Fatalf("desc %v", h)
	}
}

func TestPickSerial(t *testing.T) {
	ds := ParseDevices("List of devices attached\nemulator-5554 device product:x model:sdk_gphone64 device:emu\n192.0.2.9:5555 offline transport_id:1\n")
	if s, err := PickSerial("", "", ds); err != nil || s != "emulator-5554" {
		t.Fatalf("one ready: %q %v", s, err)
	}
	two := append(ds, Dev{Serial: "PHONE1", State: "device", Model: "SM-X000"})
	if _, err := PickSerial("", "", two); err == nil || !strings.Contains(err.Error(), "several devices") || !strings.Contains(err.Error(), "SM-X000") {
		t.Fatalf("several: %v", err)
	}
	if s, _ := PickSerial("", "PHONE1", two); s != "PHONE1" {
		t.Fatal("ANDROID_SERIAL wins")
	}
	if _, err := PickSerial("", "", ds[1:]); err == nil || !strings.Contains(err.Error(), "offline") {
		t.Fatalf("offline only: %v", err)
	}
}

func TestParseState(t *testing.T) {
	out := "  mWakefulness=Dozing\n    isKeyguardShowing=true\n  mCurrentFocus=Window{1863f7e u0 NotificationShade}\n" +
		"    topResumedActivity=ActivityRecord{254449033 u0 com.towneers.www/.main.MainActivity t10976}\n    mInputShown=false\nboot=1\n"
	s := ParseState(out)
	if s.Wake != "dozing" || !s.Locked || s.Keyboard || !s.Booted || s.Top != "com.towneers.www/.main.MainActivity" || s.Focus != "NotificationShade" {
		t.Fatalf("%+v", s)
	}
	line := s.Line("PHONE1")
	if !strings.Contains(line, "LOCKED") || !strings.Contains(line, "window NotificationShade") {
		t.Fatal(line)
	}
}

func TestMdnsAndConnectCause(t *testing.T) {
	es := ParseMdns("List of discovered mdns services\nadb-PHONE0000-abcdef\t_adb-tls-connect._tcp\t192.0.2.7:42053\nadb-PHONE\t_adb-tls-pairing._tcp\t192.0.2.7:37000\n")
	if len(es) != 2 || es[0].Kind != "connect" || es[0].HostPort != "192.0.2.7:42053" || es[1].Kind != "pairing" {
		t.Fatalf("%+v", es)
	}
	if c := ConnectCause("failed to connect to 192.0.2.7:42053", true); !strings.Contains(c, "pairing is gone") {
		t.Fatal(c)
	}
	if c := ConnectCause("failed to connect", false); !strings.Contains(c, "nothing listens") {
		t.Fatal(c)
	}
}

// fake answers adb calls from a script: each dump call returns the next dump, and every call is logged.
type fake struct {
	dumps []string
	log   []string
}

func (f *fake) run(_ time.Duration, args ...string) (string, error) {
	j := strings.Join(args, " ")
	f.log = append(f.log, j)
	switch {
	case strings.Contains(j, "uiautomator dump"):
		d := f.dumps[0]
		if len(f.dumps) > 1 {
			f.dumps = f.dumps[1:]
		}
		return d, nil
	case strings.Contains(j, "wm size"):
		return "Physical size: 1080x2400\n", nil
	case strings.Contains(j, "dumpsys power"):
		return "mWakefulness=Awake\nisKeyguardShowing=false\ntopResumedActivity=ActivityRecord{1 u0 com.x/.Main t1}\nboot=1\n", nil
	}
	return "", nil
}

func TestTapTextScrollsUntilFound(t *testing.T) {
	list := strings.Replace(dumpA, "내 물건 팔기", "다른 글", 1)
	f := &fake{dumps: []string{list, dumpA, dumpA}}
	o, _ := parse([]string{"KarrotUpload-unused"})
	o.pos = []string{"내 물건 팔기"}
	o.flag["scroll"] = true
	o.settle = 0
	o.val["serial"] = "T"
	if err := run("tap", o, f.run); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(f.log, "\n")
	if !strings.Contains(joined, "input swipe 540 1920 540 480 400") || !strings.Contains(joined, "input tap 767 1791") {
		t.Fatalf("calls:\n%s", joined)
	}
}

func TestScrollStaysInTheListAndAboveTheKeyboard(t *testing.T) {
	list := strings.Replace(dumpA, `content-desc="" clickable="false" bounds="[0,0][1080,2400]"`, `content-desc="" clickable="false" bounds="[0,0][1080,2400]"><node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" bounds="[0,300][1080,2100]"/`, 1)
	nodes, err := ParseDump(list)
	if err != nil {
		t.Fatal(err)
	}
	f := &fake{dumps: []string{list}}
	x, y1, y2, _ := scrollLine(Device{"T", f.run}, nodes)
	if x != 540 || y1 != 1740 || y2 != 660 {
		t.Fatalf("list: %d %d %d", x, y1, y2)
	}
	kb := func(_ time.Duration, args ...string) (string, error) {
		if strings.Contains(strings.Join(args, " "), "dumpsys power") {
			return "        InsetsSource id=3 type=ime frame=[0,1517][1080,2400] visibleFrame=[0,1517][1080,2400] visible=true flags=\nboot=1\n", nil
		}
		return f.run(0, args...)
	}
	_, y1, y2, _ = scrollLine(Device{"T", kb}, nodes)
	if y1 != 300+(1469-300)*8/10 || y2 != 300+(1469-300)*2/10 {
		t.Fatalf("keyboard: %d %d", y1, y2)
	}
}

func TestTapTextReportsTheScreenWhenMissing(t *testing.T) {
	f := &fake{dumps: []string{dumpA}}
	o, _ := parse([]string{"없는 글", "--scroll", "--serial", "T"})
	err := run("tap", o, f.run)
	nm, ok := err.(notMet)
	if !ok || !strings.Contains(nm.Msg, "list ended after 1 scrolls") || !strings.Contains(nm.Msg, "작성 완료") {
		t.Fatalf("%v", err)
	}
}

func TestFlagsBeforeTheCommand(t *testing.T) {
	cmd, o, err := command([]string{"--serial", "S1", "tap", "보안", "--scroll"})
	if err != nil || cmd != "tap" || o.val["serial"] != "S1" || len(o.pos) != 1 || o.pos[0] != "보안" || !o.flag["scroll"] {
		t.Fatalf("%q %+v %v", cmd, o, err)
	}
	if _, _, err := command([]string{"--quiet"}); err == nil {
		t.Fatal("flags alone must be a usage error")
	}
}

func TestParseFlags(t *testing.T) {
	o, err := parse([]string{"--pair", "192.0.2.2:37000", "123456", "--settle", "2s", "--quiet"})
	if err != nil || o.val["pair"] != "192.0.2.2:37000" || o.val["code"] != "123456" || o.settle != 2*time.Second || !o.flag["quiet"] {
		t.Fatalf("%+v %v", o, err)
	}
}

func TestConnectReattachesThePhoneBesideAnEmulator(t *testing.T) {
	connected := false
	var log []string
	r := func(_ time.Duration, args ...string) (string, error) {
		j := strings.Join(args, " ")
		log = append(log, j)
		switch {
		case j == "devices -l":
			out := "List of devices attached\nemulator-5554 device model:sdk\n"
			if connected {
				out += "adb-PHONE-x._adb-tls-connect._tcp device model:SM_X\n"
			}
			return out, nil
		case j == "mdns services":
			return "List of discovered mdns services\nadb-PHONE-x\t_adb-tls-connect._tcp\t192.0.2.7:37055\n", nil
		case j == "connect 192.0.2.7:37055":
			connected = true
			return "connected to 192.0.2.7:37055\n", nil
		case strings.HasSuffix(j, "get-state"):
			return "device\n", nil
		}
		return "", nil
	}
	if err := connect(opts{val: map[string]string{}}, r); err != nil || !connected {
		t.Fatalf("err %v, connected %v, log %q", err, connected, log)
	}
	// Already attached: no second connect.
	log = nil
	connect(opts{val: map[string]string{}}, r)
	for _, l := range log {
		if strings.HasPrefix(l, "connect ") {
			t.Fatalf("reconnected an attached phone: %q", log)
		}
	}
}

func TestDumpUsesNodeDumpBeforeUiautomator(t *testing.T) {
	var log []string
	pushed := false
	r := func(_ time.Duration, args ...string) (string, error) {
		j := strings.Join(args, " ")
		log = append(log, j)
		switch {
		case strings.Contains(j, "NodeDump") && !pushed:
			return "DROID_PUSH\n", nil
		case strings.Contains(j, "NodeDump"):
			return dumpA, nil
		case strings.Contains(j, " push "):
			pushed = true
			return "1 file pushed\n", nil
		}
		return "", nil
	}
	nodes, err := Device{Serial: "S1", run: r}.Dump()
	if err != nil || len(nodes) == 0 || !pushed {
		t.Fatalf("nodes %d err %v pushed %v log %q", len(nodes), err, pushed, log)
	}
	for _, l := range log {
		if strings.Contains(l, "uiautomator dump") {
			t.Fatalf("fell back to uiautomator: %q", log)
		}
	}
}

func TestStateWarnsBeforeTheScreenSleeps(t *testing.T) {
	s := ParseState("mWakefulness=Awake\nboot=1\ntimeout=60000\n")
	if !strings.Contains(s.Line("PHONE1"), "droid awake") {
		t.Fatalf("no awake hint: %s", s.Line("PHONE1"))
	}
	if strings.Contains(s.Line("emulator-5554"), "droid awake") {
		t.Fatal("an emulator needs no awake hint")
	}
	held := ParseState("mWakefulness=Awake\nboot=1\ntimeout=60000\nawake=1\n")
	if strings.Contains(held.Line("PHONE1"), "droid awake") {
		t.Fatal("hint while awake holds the screen")
	}
}

func TestAwakeScriptSavesOnceAndRestores(t *testing.T) {
	s := awakeScript(90 * time.Second)
	for _, want := range []string{"if [ ! -f $D/saved ]", "echo 90 > $D/idle", "screen_off_timeout 2147483647", "stay_on_while_plugged_in 7", "nohup sh -c", "set -- $(cat $D/saved)"} {
		if !strings.Contains(s, want) {
			t.Fatalf("awake script lacks %q", want)
		}
	}
	if !strings.HasPrefix(stateScript, beat) {
		t.Fatal("state must touch the heartbeat")
	}
}

func TestVersionNeedsNoDevice(t *testing.T) {
	cmd, o, err := command([]string{"version", "--json"})
	if err != nil || cmd != "version" || !o.flag["json"] {
		t.Fatalf("parse: %q %v %v", cmd, o.flag, err)
	}
	// a nil Runner proves version never reaches adb
	if err := run(cmd, o, nil); err != nil {
		t.Fatal(err)
	}
}

func TestParsePassthroughAndDumpText(t *testing.T) {
	cmd, o, err := command([]string{"adb", "--serial", "PHONE0000", "--", "shell", "--help", "--json"})
	if err != nil || cmd != "adb" || o.val["serial"] != "PHONE0000" || o.flag["json"] {
		t.Fatalf("adb: %q %v %v %v", cmd, o.val, o.flag, err)
	}
	if want := []string{"--", "shell", "--help", "--json"}; strings.Join(o.pos, " ") != strings.Join(want, " ") {
		t.Fatalf("pos %q", o.pos)
	}
	if _, o, err := command([]string{"dump", "--text"}); err != nil || o.val["text"] == "" {
		t.Fatalf("dump --text: %v %v", o.val, err)
	}
	if _, o, err := command([]string{"wait", "--text", "완료"}); err != nil || o.val["text"] != "완료" {
		t.Fatalf("wait --text: %v %v", o.val, err)
	}
}
