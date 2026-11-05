package main

// connect.go: which device a command talks to, and the commands that find, wire and wait for it.
// `--model M` asks each candidate for ro.product.model, so an emulator or a second phone beside
// the wanted one is never mistaken for it. mdns (connect) is the fast path, attached devices are
// the fallback, and --recover is the last resort: the last endpoint, a port scan of its IP, then
// an adb server restart. Only an IP:PORT serial is remembered (~/.cache/droid/endpoint,
// $DROID_CACHE moves the dir): an mdns name changes with the port and helps nobody later.

import (
	"bytes"
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
	"sync"
	"time"
)

const (
	scanPortMin = 30000
	scanPortMax = 49999
)

// seams: tests replace these to keep sleeps, the clock, the port scan and process exits instant.
var (
	waitSleep = time.Sleep
	waitNow   = time.Now
	waitScan  = scanPorts
	adbExit   = os.Exit
	// adbPassthrough keeps stdout and stderr apart for `droid adb`, which passes both through.
	adbPassthrough adbPipe = execAdbStreams
)

type adbPipe func(timeout time.Duration, args ...string) (stdout, stderr string, status int)

var endpointRe = regexp.MustCompile(`^(\d+\.\d+\.\d+\.\d+):(\d+)$`)

// endpointCache is where the last IP:PORT serial is kept; $DROID_CACHE replaces ~/.cache/droid.
func endpointCache() string {
	if dir := os.Getenv("DROID_CACHE"); dir != "" {
		return filepath.Join(dir, "endpoint")
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "droid", "endpoint")
}

func isEndpoint(s string) bool { return endpointRe.MatchString(s) }

func ipOf(endpoint string) string {
	if m := endpointRe.FindStringSubmatch(endpoint); m != nil {
		return m[1]
	}
	return ""
}

// parseEndpoint reads `PORT` or `IP:PORT`. A port alone needs lastIP, the IP of the last endpoint.
// It returns false (not an error) for anything else, so a caller can say what was expected.
func parseEndpoint(input, lastIP string) (string, bool) {
	text := strings.TrimSpace(input)
	ip, port := lastIP, text
	if m := endpointRe.FindStringSubmatch(text); m != nil {
		ip, port = m[1], m[2]
	}
	if ip == "" || len(port) == 0 || len(port) > 5 {
		return "", false
	}
	for _, c := range port {
		if c < '0' || c > '9' {
			return "", false
		}
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", false
	}
	return fmt.Sprintf("%s:%d", ip, n), true
}

// finder holds what finding one phone needs: the model asked for, the endpoint cache and the
// sleeps and scan a test can shorten.
type finder struct {
	r     Runner
	model string
	file  string
	sleep func(time.Duration)
	now   func() time.Time
	scan  func(ip string, from, to int) []int
}

func newFinder(r Runner, model string) *finder {
	return &finder{r: r, model: model, file: endpointCache(), sleep: waitSleep, now: waitNow, scan: waitScan}
}

func (f *finder) devices() []Dev {
	out, _ := f.r(10*time.Second, "devices", "-l")
	return ParseDevices(out)
}

// prop reads one getprop value; the model check is per candidate, so a stale serial is harmless.
func (f *finder) prop(serial, key string) string {
	out, _ := f.r(15*time.Second, "-s", serial, "shell", "getprop", key)
	return strings.TrimSpace(out)
}

// isPhone: the device answers and its ro.product.model is the one asked for.
func (f *finder) isPhone(serial string) bool {
	m := f.prop(serial, "ro.product.model")
	return m != "" && (f.model == "" || m == f.model)
}

// pick is find without recovery: mdns connect endpoints first, then attached ready devices.
//
// A phone attached twice (as IP:PORT and as its mdns name) is one phone, not two: ro.serialno
// says so, and the IP:PORT serial wins. Two different phones with one model are not guessed
// between: that is a DeviceError, and --serial is the way out.
func (f *finder) pick() (string, error) {
	mdns, _ := f.r(10*time.Second, "mdns", "services")
	ds := f.devices()
	var serials []string
	connected := false
	for _, e := range ParseMdns(mdns) {
		if e.Kind != "connect" {
			continue
		}
		if !readyAttached(ds, e) {
			f.r(20*time.Second, "connect", e.HostPort)
			connected = true
		}
		serials = append(serials, e.HostPort)
	}
	if connected {
		ds = f.devices() // the connects above may have added transports
	}
	for _, d := range ds {
		if d.State == "device" && !hasSerial(serials, d.Serial) {
			serials = append(serials, d.Serial)
		}
	}
	var hits []string
	for _, s := range serials {
		if f.isPhone(s) {
			hits = append(hits, s)
		}
	}
	return f.choose(hits)
}

func hasSerial(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// readyAttached is attached for a ready transport only: an offline entry with the right serial
// must not stop pick from connecting again.
func readyAttached(ds []Dev, e Endpoint) bool {
	for _, d := range ds {
		if d.State == "device" && (d.Serial == e.HostPort || strings.HasPrefix(d.Serial, e.Name+".")) {
			return true
		}
	}
	return false
}

func (f *finder) choose(hits []string) (string, error) {
	switch len(hits) {
	case 0:
		return "", nil
	case 1:
		return hits[0], nil
	}
	byPhone := map[string][]string{}
	var order []string
	for _, s := range hits {
		no := f.prop(s, "ro.serialno")
		if no == "" {
			return "", devErr("cannot tell the %d devices with ro.product.model %s apart: ro.serialno is empty for %s; pass --serial S", len(hits), f.model, s)
		}
		if _, ok := byPhone[no]; !ok {
			order = append(order, no)
		}
		byPhone[no] = append(byPhone[no], s)
	}
	if len(order) > 1 {
		return "", devErr("%d devices report ro.product.model %s (%s); pass --serial S to pick one", len(order), f.model, strings.Join(hits, ", "))
	}
	// One phone attached twice: the IP:PORT serial survives a Wi-Fi change better than the name.
	for _, s := range byPhone[order[0]] {
		if isEndpoint(s) {
			return s, nil
		}
	}
	return byPhone[order[0]][0], nil
}

// last is the cached endpoint, or "" when there is none.
func (f *finder) last() string {
	if f.file == "" {
		return ""
	}
	b, err := os.ReadFile(f.file)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// remember caches an endpoint, but only an IP:PORT one: an mdns name changes with the port.
func (f *finder) remember(serial string) {
	if serial == "" || !isEndpoint(serial) || f.file == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(f.file), 0o755); err != nil {
		return
	}
	os.WriteFile(f.file, []byte(serial+"\n"), 0o644) // a cache: failing to write it costs one slow find
}

// find looks once; with recover it also reattaches without mdns, in the order that costs least:
// the last endpoint, then the same IP with another port, then an adb restart and 10 one-second
// retries (a server that ran for days stops seeing mdns).
func (f *finder) find(recover bool) (string, error) {
	s, err := f.pick()
	if err != nil || s != "" || !recover {
		if err == nil {
			f.remember(s)
		}
		return s, err
	}
	last := f.last()
	if last != "" {
		f.r(20*time.Second, "connect", last)
		if f.isPhone(last) {
			f.remember(last)
			return last, nil
		}
	}
	if ip := ipOf(last); ip != "" {
		for _, port := range f.scan(ip, scanPortMin, scanPortMax) {
			s := fmt.Sprintf("%s:%d", ip, port)
			f.r(20*time.Second, "connect", s)
			if f.isPhone(s) {
				f.remember(s)
				return s, nil
			}
			f.r(10*time.Second, "disconnect", s)
		}
	}
	f.r(30*time.Second, "kill-server")
	f.startServer()
	for i := 0; i < 10; i++ {
		f.sleep(time.Second)
		s, err := f.pick()
		if err != nil {
			return "", err
		}
		if s != "" {
			f.remember(s)
			return s, nil
		}
	}
	return "", nil
}

// startServer leaves the adb server behind when droid runs from a systemd service: one started
// inside the service dies with it (the journal shows `Killing process (adb)` on every failure),
// so it gets its own scope when possible.
func (f *finder) startServer() {
	if os.Getenv("INVOCATION_ID") != "" {
		if _, _, code := execStreams(30*time.Second, "systemd-run", "--user", "--scope", "--quiet", "--collect", "adb", "start-server"); code == 0 {
			return
		}
	}
	f.r(30*time.Second, "start-server")
}

// wait is connect --wait: attempt k recovers when k%5==0, so a scheduled run does not restart
// every other adb user's server every minute.
func (f *finder) wait(every, limit time.Duration) (string, int, error) {
	start := f.now()
	for attempt := 0; ; attempt++ {
		s, err := f.find(attempt%5 == 0)
		if err != nil {
			return "", attempt + 1, err
		}
		if s != "" {
			return s, attempt + 1, nil
		}
		if attempt == 0 {
			fmt.Fprintf(os.Stderr, "note: no %s device yet; keep the phone awake and on this Wi-Fi\n", f.model)
		}
		if f.now().Sub(start)+every > limit {
			return "", attempt + 1, nil
		}
		f.sleep(every)
	}
}

// connectPort attaches to the port a person read off the phone (PORT alone uses the cached IP),
// checks the model and only then caches the endpoint.
func (f *finder) connectPort(input string) (string, error) {
	serial, ok := parseEndpoint(input, ipOf(f.last()))
	if !ok {
		return "", fmt.Errorf("--port %q: give a port number (41349) or IP:PORT", input)
	}
	out, _ := f.r(20*time.Second, "connect", serial)
	if !f.isPhone(serial) {
		f.r(10*time.Second, "disconnect", serial)
		said := firstLine(out)
		if said == "" {
			said = "no answer"
		}
		return "", devErr("%s did not answer as %s (%s); if the port is right the pairing may be gone: pair again and pass --port", serial, f.model, said)
	}
	f.remember(serial)
	return serial, nil
}

// pairing is the `_adb-tls-pairing` endpoint the phone advertises while its pairing dialog is
// open, or "".
func (f *finder) pairing() string {
	out, _ := f.r(10*time.Second, "mdns", "services")
	for _, e := range ParseMdns(out) {
		if e.Kind == "pairing" {
			return e.HostPort
		}
	}
	return ""
}

func scanPorts(ip string, from, to int) []int {
	return scanPortsWith(ip, from, to, tcpProbe)
}

// tcpProbe is one TCP probe: a port that accepts a connection may be adb's wireless debugging.
func tcpProbe(hostPort string, timeout time.Duration) bool {
	c, err := net.DialTimeout("tcp", hostPort, timeout)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// scanPortsWith probes [from,to] with many small dials at once: 20k ports one by one at a 300 ms
// timeout would take an hour, and the phone answers or drops most of them at once.
func scanPortsWith(ip string, from, to int, open func(hostPort string, timeout time.Duration) bool) []int {
	if to < from {
		return nil
	}
	const workers = 512
	const timeout = 300 * time.Millisecond
	ports := make([]bool, to-from+1)
	todo := make(chan int)
	var wg sync.WaitGroup
	for i := 0; i < workers && i < len(ports); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range todo {
				if open(fmt.Sprintf("%s:%d", ip, p), timeout) {
					ports[p-from] = true
				}
			}
		}()
	}
	for p := from; p <= to; p++ {
		todo <- p
	}
	close(todo)
	wg.Wait()
	var out []int
	for i, ok := range ports {
		if ok {
			out = append(out, from+i)
		}
	}
	return out
}

func flagDuration(o opts, key string, def time.Duration) (time.Duration, error) {
	s := o.val[key]
	if s == "" {
		return def, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("--%s %q: %v", key, s, err)
	}
	if d < 0 {
		return 0, fmt.Errorf("--%s %q: must not be negative", key, s)
	}
	return d, nil
}

func errNoModel(model string) error {
	return devErr("no device reports ro.product.model %s: turn on 무선 디버깅 on the phone (same Wi-Fi) and wait, or pass --port IP:PORT", model)
}

// pickDevice is device() for every command: --serial as it is, --model by ro.product.model,
// otherwise $ANDROID_SERIAL or the only ready device.
func pickDevice(o opts, r Runner) (Device, error) {
	if s := o.val["serial"]; s != "" {
		return Device{s, r}, nil
	}
	model := o.val["model"]
	if model == "" {
		return plainDevice(o, r)
	}
	s, err := newFinder(r, model).find(false)
	if err != nil {
		return Device{}, err
	}
	if s == "" {
		return Device{}, errNoModel(model)
	}
	return Device{s, r}, nil
}

func serialCmd(o opts, r Runner) error {
	if s := o.val["serial"]; s != "" {
		emit(o, s, map[string]any{"serial": s})
		return nil
	}
	model := o.val["model"]
	if model == "" {
		d, err := plainDevice(o, r)
		if err != nil {
			return err
		}
		emit(o, d.Serial, map[string]any{"serial": d.Serial})
		return nil
	}
	s, err := newFinder(r, model).find(o.flag["recover"])
	if err != nil {
		return err
	}
	if s == "" {
		return errNoModel(model)
	}
	emit(o, s, map[string]any{"serial": s})
	return nil
}

func pairCmd(o opts, r Runner) error {
	code := strings.TrimSpace(o.val["code"])
	if len(code) != 6 || !allDigits(code) {
		return errors.New("--code: the pairing dialog shows a 6-digit number")
	}
	model := o.val["model"]
	if model == "" {
		return errors.New("pair needs --model M: the model of the phone to pair")
	}
	f := newFinder(r, model)
	target := ""
	if input := o.val["port"]; input != "" {
		lastIP := ipOf(f.last())
		if lastIP == "" {
			lastIP = ipOf(f.pairing())
		}
		var ok bool
		if target, ok = parseEndpoint(input, lastIP); !ok {
			return fmt.Errorf("--port %q: give a port number (37000) or IP:PORT", input)
		}
	} else if target = f.pairing(); target == "" {
		return devErr("no pairing endpoint advertised: open 무선 디버깅 › 페어링 코드로 기기 페어링 and pass --port IP:PORT")
	}
	out, _ := r(20*time.Second, "pair", target, code)
	if !strings.Contains(strings.ToLower(out), "successfully paired") {
		return devErr("pairing %s failed: %s (the port and code change each time the dialog opens)", target, firstLine(out))
	}
	for i := 0; i < 8; i++ {
		s, err := f.pick()
		if err != nil {
			return err
		}
		if s != "" {
			f.remember(s)
			emit(o, fmt.Sprintf("paired %s · %s", target, s), map[string]any{"serial": s})
			return nil
		}
		f.sleep(time.Second)
	}
	return devErr("paired %s, but no connect endpoint turned up in 8s: pass --port with the wireless debugging port", target)
}

func allDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// adbCmd passes adb's stdout, stderr and exit status through unchanged, so a caller can use
// `droid adb` for anything droid has no verb for.
func adbCmd(o opts, r Runner) error {
	args := o.pos
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	if len(args) == 0 {
		return errors.New("adb needs arguments: droid adb [--serial S|--model M] -- devices -l")
	}
	timeout, err := flagDuration(o, "timeout", 120*time.Second)
	if err != nil {
		return err
	}
	if timeout <= 0 {
		return errors.New("--timeout must be greater than 0")
	}
	serial := o.val["serial"]
	if serial == "" && o.val["model"] != "" {
		d, err := pickDevice(o, r)
		if err != nil {
			return err
		}
		serial = d.Serial
	}
	if serial != "" {
		args = append([]string{"-s", serial}, args...)
	}
	stdout, stderr, status := adbPassthrough(timeout, args...)
	os.Stdout.WriteString(stdout)
	os.Stderr.WriteString(stderr)
	if status != 0 {
		adbExit(status)
	}
	return nil
}

// lockCmd waits for a person to unlock the phone. It never types a PIN, so the only outcomes are
// unlocked (0) and still locked (2).
func lockCmd(d Device, o opts) error {
	wait, err := flagDuration(o, "wait", 0)
	if err != nil {
		return err
	}
	t0 := waitNow()
	for checks := 1; ; checks++ {
		st, err := d.State()
		if err != nil {
			return err
		}
		elapsed := waitNow().Sub(t0)
		if !st.Locked {
			human := "unlocked"
			if checks > 1 {
				human = fmt.Sprintf("unlocked after %.1fs", elapsed.Seconds())
			}
			emit(o, human, map[string]any{"locked": false, "waitedMs": int(elapsed / time.Millisecond)})
			return nil
		}
		if elapsed >= wait {
			if wait <= 0 {
				return notMet{"the device is locked; unlock it on the device (droid never types a PIN)"}
			}
			return notMet{fmt.Sprintf("still locked after %s; unlock it on the device (droid never types a PIN)", wait)}
		}
		poll := 2 * time.Second
		if remaining := wait - elapsed; remaining < poll {
			poll = remaining
		}
		waitSleep(poll)
	}
}

// execAdbStreams is adbPassthrough's production implementation: separate streams and the real exit code.
// A start-server inside a systemd service runs in its own scope, or it dies with the service.
func execAdbStreams(timeout time.Duration, args ...string) (string, string, int) {
	if len(args) > 0 && args[0] == "start-server" && os.Getenv("INVOCATION_ID") != "" {
		if out, errOut, code := execStreams(timeout, "systemd-run", "--user", "--scope", "--quiet", "--collect", "adb", "start-server"); code == 0 {
			return out, errOut, 0
		}
	}
	return execStreams(timeout, "adb", args...)
}

func execStreams(timeout time.Duration, name string, args ...string) (string, string, int) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	code := 0
	switch {
	case err == nil:
	case ctx.Err() == context.DeadlineExceeded:
		code = 124
		fmt.Fprintf(&stderr, "%s %s did not answer in %s\n", name, strings.Join(args, " "), timeout)
	default:
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			code = 127
			fmt.Fprintf(&stderr, "%s: %v\n", name, err)
		}
	}
	return stdout.String(), stderr.String(), code
}

// --- connect without --model: the mdns flow that existed before --model ---

// attached: the mdns endpoint is already a ready adb device, by its mdns name or its ip:port.
func attached(ds []Dev, e Endpoint) bool {
	for _, d := range ds {
		if d.Serial == e.HostPort || strings.HasPrefix(d.Serial, e.Name+".") {
			return true
		}
	}
	return false
}

func connect(o opts, r Runner) error {
	if o.val["pair"] != "" {
		return connectMdns(o, r)
	}
	model := o.val["model"]
	if model == "" {
		if o.val["port"] != "" || o.val["wait"] != "" {
			return errors.New("connect --port and --wait need --model M")
		}
		return connectMdns(o, r)
	}
	f := newFinder(r, model)
	if port := o.val["port"]; port != "" {
		s, err := f.connectPort(port)
		if err != nil {
			return err
		}
		emit(o, "connected "+s, map[string]any{"serial": s})
		return nil
	}
	if o.val["wait"] == "" {
		s, err := f.find(false)
		if err != nil {
			return err
		}
		if s == "" {
			return errNoModel(model)
		}
		emit(o, s, map[string]any{"serial": s})
		return nil
	}
	limit, err := flagDuration(o, "wait", 40*time.Minute)
	if err != nil {
		return err
	}
	every, err := flagDuration(o, "every", time.Minute)
	if err != nil {
		return err
	}
	if every <= 0 {
		return errors.New("--every must be greater than 0")
	}
	s, attempts, err := f.wait(every, limit)
	if err != nil {
		return err
	}
	if s == "" {
		return devErr("no device reports ro.product.model %s after %s (%d attempts): wake the phone, keep it on this Wi-Fi, or pass --port IP:PORT", model, limit, attempts)
	}
	emit(o, fmt.Sprintf("%s after %d attempts", s, attempts), map[string]any{"serial": s, "attempts": attempts})
	return nil
}

func connectMdns(o opts, r Runner) error {
	if hp := o.val["pair"]; hp != "" {
		code := o.val["code"]
		if code == "" {
			return errors.New("--pair IP:PORT CODE (both from the phone's pairing dialog)")
		}
		out, _ := r(20*time.Second, "pair", hp, code)
		if !strings.Contains(out, "Successfully paired") {
			return devErr("pairing failed: %s (the port and code change each time the dialog opens)", firstLine(out))
		}
		fmt.Println("paired " + hp)
	}
	ready := func() []Dev {
		out, _ := r(10*time.Second, "devices", "-l")
		var ds []Dev
		for _, d := range ParseDevices(out) {
			if d.State == "device" {
				ds = append(ds, d)
			}
		}
		return ds
	}
	report := func(ds []Dev) error {
		for _, d := range ds {
			fmt.Printf("ok %s %s\n", d.Serial, d.Model)
		}
		return nil
	}
	all, _ := r(10*time.Second, "devices", "-l")
	if strings.Contains(all, "offline") {
		r(10*time.Second, "reconnect", "offline")
		waitSleep(2 * time.Second)
	}
	// Every phone that advertises wireless debugging and is not attached yet gets a connect, even
	// when another device (an emulator) is already ready: that one is not the phone asked for.
	mdns, _ := r(10*time.Second, "mdns", "services")
	var causes []string
	var pairing []string
	for _, e := range ParseMdns(mdns) {
		if e.Kind == "pairing" {
			pairing = append(pairing, e.HostPort)
			continue
		}
		if attached(ready(), e) {
			continue
		}
		out, _ := r(20*time.Second, "connect", e.HostPort)
		state, _ := r(10*time.Second, "-s", e.HostPort, "get-state")
		if strings.TrimSpace(state) == "device" {
			continue
		}
		causes = append(causes, fmt.Sprintf("%s: %s", e.HostPort, ConnectCause(out+state, tcpOpen(e.HostPort))))
	}
	if ds := ready(); len(ds) > 0 {
		for _, c := range causes {
			fmt.Fprintln(os.Stderr, "✗ "+c)
		}
		phone := false
		for _, d := range ds {
			phone = phone || !strings.HasPrefix(d.Serial, "emulator-")
		}
		if !phone && len(causes) == 0 && len(pairing) == 0 {
			fmt.Fprintln(os.Stderr, "note: only emulators; no phone advertises wireless debugging (screen off or Wi-Fi dozing: `droid awake` next time; or 무선 디버깅 off)")
		}
		return report(ds)
	}
	switch {
	case len(causes) > 0:
		return devErr("%s", strings.Join(causes, "; "))
	case len(pairing) > 0:
		return devErr("the pairing dialog is open at %s: run `droid connect --pair %s CODE` with its 6-digit code", pairing[0], pairing[0])
	default:
		return devErr("no device advertises wireless debugging: turn on 개발자 옵션 › 무선 디버깅 on the phone (same Wi-Fi as this PC) and rerun, or start an emulator. On Android 17 with adb 37, tick \"이 네트워크에서 항상 허용\" once: the phone then reconnects by itself after Wi-Fi drops")
	}
}
