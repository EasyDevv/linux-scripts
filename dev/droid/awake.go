package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Keeping a phone awake while an agent drives it. adb input is not user activity, so the screen
// times out mid-job; then the phone locks and Wi-Fi may doze, which drops wireless debugging.
//
// `droid awake` saves the two settings, sets screen_off_timeout to "never" and
// stay_on_while_plugged_in to AC|USB|wireless (what scrcpy --stay-awake does), and starts a
// watchdog on the device. Every droid call touches awakeDir/beat in a shell command it runs anyway;
// once no call came for --idle (10m), the watchdog restores the saved values and exits. So a crashed
// or forgetful session cannot leave the screen on for good, and the host need not stay connected.
// The lock screen settings are never changed: a screen that stays on does not lock.

const awakeDir = "/data/local/tmp/droid-awake"

// beat is prepended to the shell scripts droid runs on every call; it costs no extra round trip.
const beat = `[ -d ` + awakeDir + ` ] && touch ` + awakeDir + `/beat; `

func awakeScript(idle time.Duration) string {
	secs := int(idle.Seconds())
	if secs < 60 {
		secs = 60
	}
	watchdog := fmt.Sprintf(`D=%s; while sleep 20; do [ -f $D/saved ] || exit 0; `+
		`age=$(( $(date +%%s) - $(stat -c %%Y $D/beat 2>/dev/null || echo 0) )); `+
		`[ $age -gt $(cat $D/idle) ] && break; done; `+
		`set -- $(cat $D/saved); settings put system screen_off_timeout $1; settings put global stay_on_while_plugged_in $2; rm -rf $D`, awakeDir)
	return fmt.Sprintf(`D=%s; mkdir -p $D; `+
		`if [ ! -f $D/saved ]; then t=$(settings get system screen_off_timeout); s=$(settings get global stay_on_while_plugged_in); `+
		`case $t in ''|null) t=60000;; esac; case $s in ''|null) s=0;; esac; echo "$t $s" > $D/saved; fi; `+
		`echo %d > $D/idle; touch $D/beat; `+
		`settings put system screen_off_timeout 2147483647; settings put global stay_on_while_plugged_in 7; input keyevent KEYCODE_WAKEUP; `+
		`if ! { [ -f $D/pid ] && kill -0 $(cat $D/pid) 2>/dev/null; }; then nohup sh -c '%s' >/dev/null 2>&1 & echo $! > $D/pid; fi; `+
		`echo "saved $(cat $D/saved) pid $(cat $D/pid)"`, awakeDir, secs, watchdog)
}

const restScript = `D=` + awakeDir + `; if [ -f $D/saved ]; then set -- $(cat $D/saved); ` +
	`settings put system screen_off_timeout $1; settings put global stay_on_while_plugged_in $2; ` +
	`[ -f $D/pid ] && kill $(cat $D/pid) 2>/dev/null; rm -rf $D; echo "restored $1 $2"; else echo "not awake"; fi`

var savedRe = regexp.MustCompile(`saved (\d+) (\d+) pid (\d+)`)

func awake(d Device, o opts) error {
	idle := 10 * time.Minute
	if s := o.val["idle"]; s != "" {
		v, err := time.ParseDuration(s)
		if err != nil {
			return fmt.Errorf("--idle %q: %v", s, err)
		}
		idle = v
	}
	out, err := d.Shell(15*time.Second, awakeScript(idle))
	if err != nil {
		return err
	}
	m := savedRe.FindStringSubmatch(out)
	if m == nil {
		return devErr("awake did not take: %s", firstLine(out))
	}
	ms, _ := strconv.Atoi(m[1])
	emit(o, fmt.Sprintf("%s awake: screen stays on until %s after the last droid call (then back to %s); `droid rest` ends it now",
		d.Serial, idle, time.Duration(ms)*time.Millisecond), map[string]any{"timeoutMs": ms, "idleMs": idle.Milliseconds()})
	return nil
}

func rest(d Device, o opts) error {
	out, err := d.Shell(15*time.Second, restScript)
	if err != nil {
		return err
	}
	said := strings.TrimSpace(out)
	emit(o, d.Serial+" "+said, map[string]any{"restored": strings.HasPrefix(said, "restored"), "said": said})
	return nil
}
