package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// placeholders only: model SM-X000, serial PHONE0000, documentation IPs 192.0.2.x.

// scripted answers adb calls from a function and logs every argv, in the style of fake in
// droid_test.go.
type scripted struct {
	calls []string
	fn    func(call string) (string, error)
}

func (s *scripted) run(_ time.Duration, args ...string) (string, error) {
	call := strings.Join(args, " ")
	s.calls = append(s.calls, call)
	return s.fn(call)
}

func (s *scripted) count(call string) int {
	n := 0
	for _, c := range s.calls {
		if c == call {
			n++
		}
	}
	return n
}

func (s *scripted) countContaining(sub string) int {
	n := 0
	for _, c := range s.calls {
		if strings.Contains(c, sub) {
			n++
		}
	}
	return n
}

func (s *scripted) joined() string { return strings.Join(s.calls, "\n") }

// setVar replaces one test seam and restores it when the test ends.
func setVar[T any](t *testing.T, p *T, v T) {
	t.Helper()
	old := *p
	*p = v
	t.Cleanup(func() { *p = old })
}

// fakeTime is a clock that only moves when the code sleeps.
func fakeTime() (func() time.Time, func(time.Duration)) {
	cur := time.Unix(1_700_000_000, 0)
	return func() time.Time { return cur }, func(d time.Duration) { cur = cur.Add(d) }
}

// testCache points $DROID_CACHE at a temp dir and keeps a service environment out of the test.
func testCache(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("DROID_CACHE", dir)
	t.Setenv("INVOCATION_ID", "")
	return dir
}

func writeEndpoint(t *testing.T, dir, serial string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "endpoint"), []byte(serial+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readEndpoint(t *testing.T, dir string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "endpoint"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func captureOut(t *testing.T, fn func() error) (string, error) {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	ch := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(r)
		ch <- string(b)
	}()
	ferr := fn()
	w.Close()
	os.Stdout = old
	return <-ch, ferr
}

func jsonOut(t *testing.T, out string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &m); err != nil {
		t.Fatalf("not one JSON object: %q (%v)", out, err)
	}
	return m
}

func TestParseEndpoint(t *testing.T) {
	cases := []struct {
		in, lastIP, want string
		ok               bool
	}{
		{"41349", "192.0.2.9", "192.0.2.9:41349", true},
		{" 41349 ", "192.0.2.9", "192.0.2.9:41349", true},
		{"192.0.2.9:41349", "192.0.2.10", "192.0.2.9:41349", true},
		{"41349", "", "", false},
		{"0", "192.0.2.9", "", false},
		{"65536", "192.0.2.9", "", false},
		{"", "192.0.2.9", "", false},
		{"abc", "192.0.2.9", "", false},
		{"41349x", "192.0.2.9", "", false},
		{"+41349", "192.0.2.9", "", false},
	}
	for _, c := range cases {
		got, ok := parseEndpoint(c.in, c.lastIP)
		if got != c.want || ok != c.ok {
			t.Fatalf("parseEndpoint(%q, %q) = %q, %v; want %q, %v", c.in, c.lastIP, got, ok, c.want, c.ok)
		}
	}
}

func TestScanPortsDialsWithAShortTimeout(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]bool{}
	var timeout time.Duration
	got := scanPortsWith("192.0.2.9", 40000, 40003, func(hostPort string, d time.Duration) bool {
		mu.Lock()
		defer mu.Unlock()
		seen[hostPort] = true
		timeout = d
		return hostPort == "192.0.2.9:40001" || hostPort == "192.0.2.9:40003"
	})
	if len(seen) != 4 || timeout != 300*time.Millisecond {
		t.Fatalf("probed %d ports with timeout %s", len(seen), timeout)
	}
	if len(got) != 2 || got[0] != 40001 || got[1] != 40003 {
		t.Fatalf("open ports %v", got)
	}
	if scanPortsWith("192.0.2.9", 10, 9, func(string, time.Duration) bool { return true }) != nil {
		t.Fatal("an empty range has no ports")
	}
}

func TestSerialFindsThePhoneByMdns(t *testing.T) {
	dir := testCache(t)
	devices := "List of devices attached\nemulator-5554 device model:sdk_gphone64\n"
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services":
			return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-connect._tcp\t192.0.2.7:42053\n", nil
		case call == "devices -l":
			return devices, nil
		case call == "connect 192.0.2.7:42053":
			devices += "192.0.2.7:42053 device model:SM_X000\n"
			return "connected to 192.0.2.7:42053\n", nil
		case strings.HasPrefix(call, "-s emulator-5554 "):
			return "sdk_gphone64\n", nil
		case call == "-s 192.0.2.7:42053 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	o, err := parse([]string{"serial", "--model", "SM-X000", "--json"})
	if err != nil {
		t.Fatal(err)
	}
	out, err := captureOut(t, func() error { return run("serial", o, s.run) })
	if err != nil {
		t.Fatal(err)
	}
	m := jsonOut(t, out)
	if m["ok"] != true || m["serial"] != "192.0.2.7:42053" {
		t.Fatalf("json %v", m)
	}
	if got := readEndpoint(t, dir); got != "192.0.2.7:42053" {
		t.Fatalf("cache %q", got)
	}
}

func TestSerialReportsAModelMismatch(t *testing.T) {
	testCache(t)
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services":
			return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-connect._tcp\t192.0.2.7:42053\n", nil
		case call == "devices -l":
			return "List of devices attached\n", nil
		default:
			return "SM-Y000\n", nil
		}
	}}
	o, _ := parse([]string{"serial", "--model", "SM-X000"})
	err := run("serial", o, s.run)
	var de DeviceError
	if !errors.As(err, &de) || !strings.Contains(de.Msg, "SM-X000") {
		t.Fatalf("want DeviceError naming the model, got %v", err)
	}
	if strings.Contains(s.joined(), "kill-server") {
		t.Fatal("a mismatch must not restart the adb server")
	}
}

func TestPrefersTheIPPortSerialOfTheSamePhone(t *testing.T) {
	testCache(t)
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services":
			return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-connect._tcp\t192.0.2.7:42053\n", nil
		case call == "devices -l":
			return "List of devices attached\n192.0.2.7:42053 device model:SM_X000\n" +
				"adb-PHONE0000-x._adb-tls-connect._tcp device model:SM_X000\n", nil
		case strings.HasSuffix(call, "shell getprop ro.product.model"):
			return "SM-X000\n", nil
		case strings.HasSuffix(call, "shell getprop ro.serialno"):
			return "PHONE0000\n", nil
		}
		return "", nil
	}}
	got, err := newFinder(s.run, "SM-X000").pick()
	if err != nil {
		t.Fatal(err)
	}
	if got != "192.0.2.7:42053" {
		t.Fatalf("picked %q, want the IP:PORT serial; calls:\n%s", got, s.joined())
	}
	if strings.Contains(s.joined(), "connect ") {
		t.Fatalf("reconnected an attached phone:\n%s", s.joined())
	}
}

func TestOfflineTransportDoesNotBlockAReconnect(t *testing.T) {
	testCache(t)
	devices := "List of devices attached\n192.0.2.7:42053 offline model:SM_X000\n"
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services":
			return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-connect._tcp\t192.0.2.7:42053\n", nil
		case call == "devices -l":
			return devices, nil
		case call == "connect 192.0.2.7:42053":
			devices = "List of devices attached\n192.0.2.7:42053 device model:SM_X000\n"
			return "connected to 192.0.2.7:42053\n", nil
		case call == "-s 192.0.2.7:42053 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	got, err := newFinder(s.run, "SM-X000").pick()
	if err != nil || got != "192.0.2.7:42053" {
		t.Fatalf("picked %q, %v; calls:\n%s", got, err, s.joined())
	}
	if s.count("connect 192.0.2.7:42053") != 1 {
		t.Fatalf("an offline transport must be connected again:\n%s", s.joined())
	}
}

func TestConnectWithoutWaitFindsOnce(t *testing.T) {
	testCache(t)
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "devices -l":
			return "List of devices attached\n192.0.2.7:42053 device model:SM_X000\n", nil
		case call == "-s 192.0.2.7:42053 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"connect", "--model", "SM-X000", "--json"})
	out, err := captureOut(t, func() error { return run("connect", o, s.run) })
	if err != nil {
		t.Fatal(err)
	}
	m := jsonOut(t, out)
	if m["ok"] != true || m["serial"] != "192.0.2.7:42053" {
		t.Fatalf("json %v", m)
	}
	if _, ok := m["attempts"]; ok {
		t.Fatalf("a single find is not a wait: %v", m)
	}
}

func TestTwoPhonesWithOneModelAreNotGuessed(t *testing.T) {
	testCache(t)
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "devices -l":
			return "List of devices attached\n192.0.2.7:41000 device model:SM_X000\n192.0.2.8:41000 device model:SM_X000\n", nil
		case strings.HasSuffix(call, "shell getprop ro.product.model"):
			return "SM-X000\n", nil
		case strings.HasSuffix(call, "shell getprop ro.serialno"):
			return "PHONE" + call[3:12] + "\n", nil // different phone per serial
		}
		return "", nil
	}}
	o := opts{val: map[string]string{"model": "SM-X000"}, flag: map[string]bool{}}
	err := serialCmd(o, s.run)
	var de DeviceError
	if !errors.As(err, &de) || !strings.Contains(de.Msg, "--serial") || !strings.Contains(de.Msg, "SM-X000") {
		t.Fatalf("want a DeviceError naming both devices and --serial, got %v", err)
	}
}

func TestRecoverTriesTheCachedEndpointFirst(t *testing.T) {
	dir := testCache(t)
	writeEndpoint(t, dir, "192.0.2.10:41000")
	setVar(t, &waitScan, func(ip string, from, to int) []int {
		t.Errorf("scanned %s without trying the cached endpoint first", ip)
		return nil
	})
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services", call == "devices -l":
			return "List of devices attached\n", nil
		case call == "connect 192.0.2.10:41000":
			return "connected to 192.0.2.10:41000\n", nil
		case call == "-s 192.0.2.10:41000 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	got, err := newFinder(s.run, "SM-X000").find(true)
	if err != nil || got != "192.0.2.10:41000" {
		t.Fatalf("recovered %q, %v; calls:\n%s", got, err, s.joined())
	}
	if s.count("kill-server") != 0 || s.count("start-server") != 0 {
		t.Fatalf("restarted the server before trying the cached endpoint:\n%s", s.joined())
	}
	if got := readEndpoint(t, dir); got != "192.0.2.10:41000" {
		t.Fatalf("cache %q", got)
	}
}

func TestRecoverScansTheLastIPForANewPort(t *testing.T) {
	dir := testCache(t)
	writeEndpoint(t, dir, "192.0.2.10:40000")
	var scannedIP string
	var scannedFrom, scannedTo int
	setVar(t, &waitScan, func(ip string, from, to int) []int {
		scannedIP, scannedFrom, scannedTo = ip, from, to
		return []int{40001, 40002}
	})
	models := map[string]string{
		"192.0.2.10:40000": "SM-Y000", // the old port now belongs to another adb user
		"192.0.2.10:40001": "",
		"192.0.2.10:40002": "SM-X000",
	}
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services", call == "devices -l":
			return "List of devices attached\n", nil
		case strings.HasPrefix(call, "connect "), strings.HasPrefix(call, "disconnect "):
			return "ok\n", nil
		case strings.HasSuffix(call, "shell getprop ro.product.model"):
			serial := strings.Fields(call)[1]
			return models[serial] + "\n", nil
		}
		return "", nil
	}}
	got, err := newFinder(s.run, "SM-X000").find(true)
	if err != nil || got != "192.0.2.10:40002" {
		t.Fatalf("recovered %q, %v; calls:\n%s", got, err, s.joined())
	}
	if scannedIP != "192.0.2.10" || scannedFrom != 30000 || scannedTo != 49999 {
		t.Fatalf("scanned %s %d-%d", scannedIP, scannedFrom, scannedTo)
	}
	if s.count("disconnect 192.0.2.10:40001") != 1 {
		t.Fatalf("a wrong port must be disconnected:\n%s", s.joined())
	}
	if s.count("kill-server") != 0 {
		t.Fatalf("restarted the server before scanning:\n%s", s.joined())
	}
}

func TestRecoverRestartsTheServerAndRetries(t *testing.T) {
	testCache(t)
	now, sleep := fakeTime()
	setVar(t, &waitNow, now)
	sleeps := 0
	setVar(t, &waitSleep, func(d time.Duration) {
		sleeps++
		sleep(d)
	})
	restarted := false
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "kill-server":
			restarted = false
			return "", nil
		case call == "start-server":
			restarted = true
			return "", nil
		case call == "mdns services":
			if restarted {
				return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-connect._tcp\t192.0.2.7:42053\n", nil
			}
			return "List of discovered mdns services\n", nil
		case call == "devices -l":
			return "List of devices attached\n", nil
		case call == "connect 192.0.2.7:42053":
			return "connected to 192.0.2.7:42053\n", nil
		case call == "-s 192.0.2.7:42053 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	got, err := newFinder(s.run, "SM-X000").find(true)
	if err != nil || got != "192.0.2.7:42053" {
		t.Fatalf("recovered %q, %v; calls:\n%s", got, err, s.joined())
	}
	if s.count("kill-server") != 1 || s.count("start-server") != 1 || sleeps != 1 {
		t.Fatalf("kill %d start %d sleeps %d:\n%s", s.count("kill-server"), s.count("start-server"), sleeps, s.joined())
	}
}

func TestWaitRestartsTheServerOnlyEveryFifthAttempt(t *testing.T) {
	testCache(t)
	now, sleep := fakeTime()
	setVar(t, &waitNow, now)
	setVar(t, &waitSleep, sleep)
	s := &scripted{fn: func(call string) (string, error) {
		switch call {
		case "mdns services", "devices -l", "kill-server", "start-server":
			return "List of devices attached\n", nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"connect", "--model", "SM-X000", "--wait", "6m", "--every", "1m"})
	err := run("connect", o, s.run)
	var de DeviceError
	if !errors.As(err, &de) {
		t.Fatalf("a wait that runs out is a DeviceError (exit 3), got %v", err)
	}
	if s.count("kill-server") != 2 || s.count("start-server") != 2 {
		t.Fatalf("6 attempts must restart the server twice (k%%5==0), not every time: kill %d start %d",
			s.count("kill-server"), s.count("start-server"))
	}
}

func TestWaitFindsThePhoneWhenItAppears(t *testing.T) {
	dir := testCache(t)
	now, sleep := fakeTime()
	setVar(t, &waitNow, now)
	setVar(t, &waitSleep, sleep)
	start := now()
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services":
			if now().Sub(start) >= 2*time.Minute {
				return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-connect._tcp\t192.0.2.7:42053\n", nil
			}
			return "List of discovered mdns services\n", nil
		case call == "devices -l":
			return "List of devices attached\n", nil
		case call == "connect 192.0.2.7:42053":
			return "connected to 192.0.2.7:42053\n", nil
		case call == "-s 192.0.2.7:42053 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"connect", "--model", "SM-X000", "--wait", "5m", "--every", "1m", "--json"})
	out, err := captureOut(t, func() error { return run("connect", o, s.run) })
	if err != nil {
		t.Fatal(err)
	}
	m := jsonOut(t, out)
	if m["ok"] != true || m["serial"] != "192.0.2.7:42053" || m["attempts"] != float64(3) {
		t.Fatalf("json %v", m)
	}
	if got := readEndpoint(t, dir); got != "192.0.2.7:42053" {
		t.Fatalf("cache %q", got)
	}
}

func TestPortAloneUsesTheCachedIP(t *testing.T) {
	dir := testCache(t)
	writeEndpoint(t, dir, "192.0.2.11:40000")
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "connect 192.0.2.11:41349":
			return "connected to 192.0.2.11:41349\n", nil
		case call == "-s 192.0.2.11:41349 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"connect", "--model", "SM-X000", "--port", "41349", "--json"})
	out, err := captureOut(t, func() error { return run("connect", o, s.run) })
	if err != nil {
		t.Fatal(err)
	}
	m := jsonOut(t, out)
	if m["ok"] != true || m["serial"] != "192.0.2.11:41349" {
		t.Fatalf("json %v", m)
	}
	if got := readEndpoint(t, dir); got != "192.0.2.11:41349" {
		t.Fatalf("cache %q", got)
	}
	if s.count("connect 192.0.2.11:41349") != 1 {
		t.Fatalf("calls:\n%s", s.joined())
	}
}

func TestPortWithoutACachedIPAsksForOne(t *testing.T) {
	testCache(t)
	s := &scripted{fn: func(call string) (string, error) { return "", nil }}
	o, _ := parse([]string{"connect", "--model", "SM-X000", "--port", "41349"})
	if err := run("connect", o, s.run); err == nil || !strings.Contains(err.Error(), "IP:PORT") {
		t.Fatalf("a port alone needs the cached IP: %v", err)
	}
	if len(s.calls) != 0 {
		t.Fatalf("asked adb before it had an endpoint: %v", s.calls)
	}
}

func TestPortMismatchDisconnectsAndFails(t *testing.T) {
	dir := testCache(t)
	writeEndpoint(t, dir, "192.0.2.11:40000")
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "connect 192.0.2.11:41349":
			return "failed to connect to '192.0.2.11:41349': Connection refused\n", nil
		case strings.HasSuffix(call, "shell getprop ro.product.model"):
			return "SM-Y000\n", nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"connect", "--model", "SM-X000", "--port", "41349"})
	err := run("connect", o, s.run)
	var de DeviceError
	if !errors.As(err, &de) || !strings.Contains(de.Msg, "192.0.2.11:41349") || !strings.Contains(de.Msg, "SM-X000") {
		t.Fatalf("want a DeviceError naming the endpoint and model, got %v", err)
	}
	if s.count("disconnect 192.0.2.11:41349") != 1 {
		t.Fatalf("a wrong device must be disconnected:\n%s", s.joined())
	}
	if got := readEndpoint(t, dir); got != "192.0.2.11:40000" {
		t.Fatalf("a failed connect overwrote the cache: %q", got)
	}
}

func TestPairNeedsASixDigitCode(t *testing.T) {
	testCache(t)
	s := &scripted{fn: func(call string) (string, error) { return "", nil }}
	for _, code := range []string{"12345", "1234567", "12345a", ""} {
		o, _ := parse([]string{"pair", "--code", code, "--model", "SM-X000"})
		err := run("pair", o, s.run)
		var de DeviceError
		if err == nil || errors.As(err, &de) {
			t.Fatalf("code %q: want a usage error, got %v", code, err)
		}
	}
	if len(s.calls) != 0 {
		t.Fatalf("reached adb with a bad code: %v", s.calls)
	}
}

func TestPairUsesThePairingEndpointThenFindsThePhone(t *testing.T) {
	dir := testCache(t)
	paired := false
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "mdns services":
			if paired {
				return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-connect._tcp\t192.0.2.12:42053\n", nil
			}
			return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-pairing._tcp\t192.0.2.12:37000\n", nil
		case call == "pair 192.0.2.12:37000 123456":
			paired = true
			return "Successfully paired to 192.0.2.12:37000\n", nil
		case call == "devices -l":
			return "List of devices attached\n", nil
		case call == "connect 192.0.2.12:42053":
			return "connected to 192.0.2.12:42053\n", nil
		case call == "-s 192.0.2.12:42053 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"pair", "--code", "123456", "--model", "SM-X000", "--json"})
	out, err := captureOut(t, func() error { return run("pair", o, s.run) })
	if err != nil {
		t.Fatal(err)
	}
	m := jsonOut(t, out)
	if m["ok"] != true || m["serial"] != "192.0.2.12:42053" {
		t.Fatalf("json %v", m)
	}
	if got := readEndpoint(t, dir); got != "192.0.2.12:42053" {
		t.Fatalf("cache %q", got)
	}
	if s.count("pair 192.0.2.12:37000 123456") != 1 {
		t.Fatalf("calls:\n%s", s.joined())
	}
}

func TestPairGivesUpAfterEightTries(t *testing.T) {
	testCache(t)
	now, sleep := fakeTime()
	setVar(t, &waitNow, now)
	sleeps := 0
	setVar(t, &waitSleep, func(d time.Duration) {
		sleeps++
		sleep(d)
	})
	s := &scripted{fn: func(call string) (string, error) {
		switch call {
		case "mdns services":
			return "List of discovered mdns services\nadb-PHONE0000-x\t_adb-tls-pairing._tcp\t192.0.2.12:37000\n", nil
		case "pair 192.0.2.12:37000 123456":
			return "Successfully paired to 192.0.2.12:37000\n", nil
		case "devices -l":
			return "List of devices attached\n", nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"pair", "--code", "123456", "--model", "SM-X000"})
	err := run("pair", o, s.run)
	var de DeviceError
	if !errors.As(err, &de) || !strings.Contains(de.Msg, "8") {
		t.Fatalf("want a DeviceError after 8 tries, got %v", err)
	}
	if sleeps != 8 {
		t.Fatalf("slept %d times, want 8 one-second tries", sleeps)
	}
}

// lockedState is the slice of dumpsys power that ParseState needs.
func stateOut(locked bool) string {
	lock := "isKeyguardShowing=false"
	if locked {
		lock = "isKeyguardShowing=true"
	}
	return "mWakefulness=Awake\n" + lock + "\ntopResumedActivity=ActivityRecord{1 u0 com.x/.Main t1}\nboot=1\n"
}

func TestLockChecksOnceWithoutWait(t *testing.T) {
	s := &scripted{fn: func(call string) (string, error) {
		if strings.Contains(call, "dumpsys power") {
			return stateOut(true), nil
		}
		return "", nil
	}}
	o := opts{val: map[string]string{"serial": "PHONE0000"}, flag: map[string]bool{}}
	err := run("lock", o, s.run)
	var nm notMet
	if !errors.As(err, &nm) || !strings.Contains(nm.Msg, "locked") {
		t.Fatalf("want notMet (exit 2) for a locked phone, got %v", err)
	}
	if n := s.countContaining("dumpsys power"); n != 1 {
		t.Fatalf("checked %d times without --wait, want once", n)
	}
}

func TestLockPollsEveryTwoSeconds(t *testing.T) {
	now, sleep := fakeTime()
	setVar(t, &waitNow, now)
	setVar(t, &waitSleep, sleep)
	checks := 0
	s := &scripted{fn: func(call string) (string, error) {
		if strings.Contains(call, "dumpsys power") {
			checks++
			return stateOut(checks < 2), nil
		}
		return "", nil
	}}
	o, _ := parse([]string{"lock", "--wait", "4s", "--json"})
	o.val["serial"] = "PHONE0000"
	out, err := captureOut(t, func() error { return run("lock", o, s.run) })
	if err != nil {
		t.Fatal(err)
	}
	m := jsonOut(t, out)
	if m["ok"] != true || m["locked"] != false || m["waitedMs"] != float64(2000) {
		t.Fatalf("json %v", m)
	}
	if checks != 2 {
		t.Fatalf("checked %d times, want 2", checks)
	}
}

func TestLockStillLockedAfterTheWait(t *testing.T) {
	now, sleep := fakeTime()
	setVar(t, &waitNow, now)
	setVar(t, &waitSleep, sleep)
	s := &scripted{fn: func(call string) (string, error) {
		if strings.Contains(call, "dumpsys power") {
			return stateOut(true), nil
		}
		return "", nil
	}}
	o := opts{val: map[string]string{"serial": "PHONE0000", "wait": "2s"}, flag: map[string]bool{}}
	err := run("lock", o, s.run)
	var nm notMet
	if !errors.As(err, &nm) || !strings.Contains(nm.Msg, "still locked") {
		t.Fatalf("want notMet after the wait, got %v", err)
	}
	if n := s.countContaining("dumpsys power"); n != 2 {
		t.Fatalf("checked %d times in 2s, want 2", n)
	}
}

func TestAdbPassesArgumentsThrough(t *testing.T) {
	var got []string
	var gotTimeout time.Duration
	setVar(t, &adbPassthrough, func(timeout time.Duration, args ...string) (string, string, int) {
		gotTimeout, got = timeout, args
		return "out\n", "", 0
	})
	cmd, o, err := command([]string{"adb", "--serial", "PHONE0000", "--timeout", "5s", "--", "shell", "getprop"})
	if err != nil {
		t.Fatal(err)
	}
	out, err := captureOut(t, func() error { return run(cmd, o, nil) }) // a nil Runner proves --serial needs no pick
	if err != nil {
		t.Fatal(err)
	}
	if out != "out\n" {
		t.Fatalf("stdout %q", out)
	}
	if strings.Join(got, " ") != "-s PHONE0000 shell getprop" || gotTimeout != 5*time.Second {
		t.Fatalf("ran adb %v with timeout %s", got, gotTimeout)
	}
}

func TestAdbUsesTheModelSerial(t *testing.T) {
	testCache(t)
	var got []string
	setVar(t, &adbPassthrough, func(_ time.Duration, args ...string) (string, string, int) {
		got = args
		return "", "", 0
	})
	s := &scripted{fn: func(call string) (string, error) {
		switch {
		case call == "devices -l":
			return "List of devices attached\n192.0.2.7:42053 device model:SM_X000\n", nil
		case call == "-s 192.0.2.7:42053 shell getprop ro.product.model":
			return "SM-X000\n", nil
		}
		return "", nil
	}}
	cmd, o, err := command([]string{"adb", "--model", "SM-X000", "--", "devices"})
	if err != nil {
		t.Fatal(err)
	}
	if err := run(cmd, o, s.run); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, " ") != "-s 192.0.2.7:42053 devices" {
		t.Fatalf("ran adb %v", got)
	}
}

func TestAdbExitsWithItsStatus(t *testing.T) {
	setVar(t, &adbPassthrough, func(_ time.Duration, args ...string) (string, string, int) {
		return "", "error: device offline\n", 7
	})
	var code int
	setVar(t, &adbExit, func(c int) { code = c })
	o, _ := parse([]string{"adb", "--serial", "PHONE0000", "--", "shell", "true"})
	if err := run("adb", o, nil); err != nil {
		t.Fatal(err)
	}
	if code != 7 {
		t.Fatalf("exit %d, want adb's 7", code)
	}
}

func TestAdbNeedsArguments(t *testing.T) {
	called := false
	setVar(t, &adbPassthrough, func(_ time.Duration, args ...string) (string, string, int) {
		called = true
		return "", "", 0
	})
	cmd, o, err := command([]string{"adb", "--serial", "PHONE0000"})
	if err != nil {
		t.Fatal(err)
	}
	if err := run(cmd, o, nil); err == nil || called {
		t.Fatalf("want a usage error without arguments, got %v (called %v)", err, called)
	}
}

func TestAdbArgsArePassedAfterTheDashes(t *testing.T) {
	var got []string
	setVar(t, &adbPassthrough, func(_ time.Duration, args ...string) (string, string, int) {
		got = args
		return "", "", 0
	})
	cmd, o, err := command([]string{"adb", "--", "install", "-r", "/tmp/app.apk"})
	if err != nil {
		t.Fatal(err)
	}
	if err := run(cmd, o, nil); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, " ") != "install -r /tmp/app.apk" {
		t.Fatalf("ran adb %v", got)
	}
}
