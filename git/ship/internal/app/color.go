// color.go is the single color switch, ported from ship.ts's `color`/`sgr`.
//
// Color is on only when stdout and stderr are both terminals, NO_COLOR is
// unset or empty, and TERM is not "dumb" (the build-terminal rule; the TS
// original had no TERM check).
package app

import (
	"os"

	"github.com/charmbracelet/x/term"
)

// colorEnabled is computed once, like the module-level `color` in ship.ts.
var colorEnabled = detectColor()

func detectColor() bool {
	return colorAllowed(isTerminal(os.Stdout), isTerminal(os.Stderr))
}

func isTerminal(f *os.File) bool {
	return term.IsTerminal(f.Fd())
}

// colorAllowed is the testable core of the switch.
func colorAllowed(stdoutTTY, stderrTTY bool) bool {
	if !stdoutTTY || !stderrTTY {
		return false
	}
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	return os.Getenv("TERM") != "dumb"
}

// sgr returns an SGR sequence, or "" when color is off.
func sgr(code string) string {
	if !colorEnabled {
		return ""
	}
	return "\x1b[" + code + "m"
}

func Red() string    { return sgr("0;31") }
func Green() string  { return sgr("0;32") }
func Yellow() string { return sgr("1;33") }
func Blue() string   { return sgr("0;34") }
func Cyan() string   { return sgr("0;36") }
func Bold() string   { return sgr("1") }
func Dim() string    { return sgr("2") }
func NC() string     { return sgr("0") }
