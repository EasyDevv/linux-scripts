package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// phoneFake answers the serve script the way a phone with NodeDump would: it knows the size of the
// dex it has, counts requests, and can be told to time out or answer ERROR:.
type phoneFake struct {
	dex     int      // size of the dex on the phone
	answers []string // one answer per request; the last one repeats
	pushes  int
	reqs    int
	fail    bool // the server never answers: NODES_TIMEOUT every time
	stops   int
	uiauto  int
	log     []string
}

var (
	dexSizeRe = regexp.MustCompile(`= "(\d+)"`)
	killRe    = regexp.MustCompile(`kill \$\(cat ` + nodesDir + `/pid\)`)
)

func (p *phoneFake) run(_ time.Duration, args ...string) (string, error) {
	j := strings.Join(args, " ")
	p.log = append(p.log, j)
	want := ""
	if m := dexSizeRe.FindStringSubmatch(j); m != nil {
		want = m[1]
	}
	switch {
	case strings.Contains(j, "NodeDump serve"):
		if want != strconv.Itoa(p.dex) {
			return "NODES_PUSH\n", nil
		}
		p.reqs++
		if p.fail {
			return "NODES_TIMEOUT\njava.lang.IllegalStateException\n", nil
		}
		a := dumpA
		if len(p.answers) > 0 {
			a = p.answers[0]
			if len(p.answers) > 1 {
				p.answers = p.answers[1:]
			}
		}
		return a, nil
	case strings.Contains(j, "kill $(cat "):
		p.stops++
		return "", nil
	case strings.Contains(j, "stat -c %s"):
		return strconv.Itoa(p.dex), nil
	case strings.Contains(j, " push "):
		p.pushes++
		p.dex = len(nodedumpDex)
		return "1 file pushed, 0 skipped\n", nil
	case strings.Contains(j, "uiautomator dump"):
		p.uiauto++
		return dumpA, nil
	}
	return "", nil
}

// phone is a Device on a fake phone with an isolated cache dir and both NodeDump switches off.
func phone(t *testing.T, p *phoneFake) Device {
	t.Helper()
	t.Setenv("DROID_CACHE", t.TempDir())
	t.Setenv("DROID_NODEDUMP", "")
	t.Setenv("NODE_DUMP", "")
	return Device{Serial: "PHONE0000", run: p.run}
}

func capture(t *testing.T, f func() error) (string, error) {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	ferr := f()
	w.Close()
	os.Stdout = old
	b, _ := io.ReadAll(r)
	r.Close()
	return string(b), ferr
}

func TestDumpServesAfterPushingTheDex(t *testing.T) {
	p := &phoneFake{}
	d := phone(t, p)
	nodes, err := d.Dump()
	if err != nil || len(nodes) != 6 {
		t.Fatalf("nodes %d err %v", len(nodes), err)
	}
	if p.pushes != 1 || p.reqs != 1 || p.uiauto != 0 {
		t.Fatalf("pushes %d reqs %d uiautomator %d\n%s", p.pushes, p.reqs, p.uiauto, strings.Join(p.log, "\n"))
	}
	if !strings.HasPrefix(serveScript(), beat) || !strings.HasPrefix(stopNodesScript(), beat) {
		t.Fatal("every serve script must touch the awake heartbeat")
	}
	if !strings.Contains(serveScript(), nodesDir+" "+strconv.Itoa(nodesIdleS)) {
		t.Fatal("the server must get the dir and the idle seconds")
	}
}

func TestDexSizeChangePushesAgain(t *testing.T) {
	p := &phoneFake{dex: len(nodedumpDex) + 1}
	d := phone(t, p)
	if _, err := d.Dump(); err != nil {
		t.Fatal(err)
	}
	if p.pushes != 1 || p.reqs != 1 {
		t.Fatalf("pushes %d reqs %d\n%s", p.pushes, p.reqs, strings.Join(p.log, "\n"))
	}
}

func TestTimeoutStopsTheServerAndRetries(t *testing.T) {
	p := &phoneFake{dex: len(nodedumpDex), answers: []string{"NODES_TIMEOUT\njava.lang.IllegalStateException\n", dumpA}}
	d := phone(t, p)
	nodes, err := d.Dump()
	if err != nil || len(nodes) == 0 {
		t.Fatalf("nodes %d err %v", len(nodes), err)
	}
	if p.reqs != 2 || p.stops != 1 || p.uiauto != 0 {
		t.Fatalf("reqs %d stops %d uiautomator %d\n%s", p.reqs, p.stops, p.uiauto, strings.Join(p.log, "\n"))
	}
	if !killRe.MatchString(strings.Join(p.log, "\n")) {
		t.Fatalf("the hung server was not killed:\n%s", strings.Join(p.log, "\n"))
	}
}

func TestServerErrorIsAnEmptyScreen(t *testing.T) {
	p := &phoneFake{dex: len(nodedumpDex), answers: []string{"ERROR: no active window"}}
	d := phone(t, p)
	out, err := capture(t, func() error { return dumpCmd(d, opts{flag: map[string]bool{}, val: map[string]string{}}) })
	var nm notMet
	if !errors.As(err, &nm) || !strings.Contains(nm.Msg, "empty screen") {
		t.Fatalf("err %v", err)
	}
	if out != "" || p.uiauto != 0 {
		t.Fatalf("printed %q, uiautomator %d", out, p.uiauto)
	}
	// Device.Dump (look, tap, wait) reads the same answer as "no list this time", not a failure.
	if _, err := d.Dump(); err == nil {
		t.Fatal("Dump must not invent nodes for an empty window")
	} else {
		var ni NoIdle
		if !errors.As(err, &ni) {
			t.Fatalf("Dump: %v", err)
		}
	}
}

func TestServerFailureFallsBackAndIsRemembered(t *testing.T) {
	cache := t.TempDir()
	p := &phoneFake{dex: len(nodedumpDex), fail: true}
	d := phone(t, p)
	t.Setenv("DROID_CACHE", cache)
	nodes, err := d.Dump()
	if err != nil || len(nodes) == 0 || p.uiauto != 1 {
		t.Fatalf("nodes %d err %v uiautomator %d\n%s", len(nodes), err, p.uiauto, strings.Join(p.log, "\n"))
	}
	off := filepath.Join(cache, "nodedump-off-PHONE0000")
	if _, err := os.Stat(off); err != nil {
		t.Fatalf("no off marker: %v\n%s", err, strings.Join(p.log, "\n"))
	}
	reqs := p.reqs
	if _, err := d.Dump(); err != nil || p.reqs != reqs || p.uiauto != 2 {
		t.Fatalf("the second call retried the server: reqs %d -> %d, uiautomator %d", reqs, p.reqs, p.uiauto)
	}
	// An old marker is dropped, so NodeDump gets one more chance.
	old := time.Now().Add(-2 * nodeDumpOffAge)
	if err := os.Chtimes(off, old, old); err != nil {
		t.Fatal(err)
	}
	p.fail = false
	p.answers = nil
	if _, err := d.Dump(); err != nil || p.reqs != reqs+1 {
		t.Fatalf("an expired marker still skipped the server: reqs %d -> %d err %v", reqs, p.reqs, err)
	}
}

func TestNodeDumpOffByEnvironment(t *testing.T) {
	for _, env := range []string{"NODE_DUMP", "DROID_NODEDUMP"} {
		p := &phoneFake{dex: len(nodedumpDex)}
		d := phone(t, p)
		t.Setenv(env, "off")
		nodes, err := d.Dump()
		if err != nil || len(nodes) == 0 || p.uiauto != 1 || p.reqs != 0 {
			t.Fatalf("%s=off: nodes %d err %v reqs %d uiautomator %d", env, len(nodes), err, p.reqs, p.uiauto)
		}
		if _, err := os.Stat(nodeDumpOffPath("PHONE0000")); err == nil {
			t.Fatalf("%s=off must not write the off marker", env)
		}
	}
}

func TestStopNodesKillsTheServerAndRemovesTheDir(t *testing.T) {
	p := &phoneFake{}
	d := phone(t, p)
	if err := stopNodes(d); err != nil {
		t.Fatal(err)
	}
	j := strings.Join(p.log, "\n")
	if !killRe.MatchString(j) || !strings.Contains(j, "rm -rf "+nodesDir) || p.stops != 1 {
		t.Fatalf("stop script:\n%s", j)
	}
}

func TestDumpPrintsTheXML(t *testing.T) {
	p := &phoneFake{dex: len(nodedumpDex)}
	d := phone(t, p)
	out, err := capture(t, func() error { return dumpCmd(d, opts{flag: map[string]bool{}, val: map[string]string{}}) })
	if err != nil || out != dumpA+"\n" {
		t.Fatalf("err %v, out:\n%s", err, out)
	}
}

func TestDumpTextPrintsEveryNode(t *testing.T) {
	p := &phoneFake{dex: len(nodedumpDex)}
	d := phone(t, p)
	out, err := capture(t, func() error {
		return dumpCmd(d, opts{flag: map[string]bool{"text": true}, val: map[string]string{}})
	})
	nodes, _ := ParseDump(dumpA)
	want := len(Shown(nodes, true))
	lines := strings.Split(strings.TrimSuffix(out, "\n"), "\n")
	if err != nil || len(lines) != want {
		t.Fatalf("err %v, %d lines want %d:\n%s", err, len(lines), want, out)
	}
	if !strings.Contains(out, "작성 완료") || !strings.Contains(out, "·  (5,5)  View") {
		t.Fatalf("unlabeled nodes must be printed too:\n%s", out)
	}
}
