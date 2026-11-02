// color.go ports cli-rust/src/color.rs.
//
// Exported: RESET BOLD DIM RED GREEN YELLOW BLUE MAGENTA CYAN,
// StdoutEnabled, StderrEnabled, Paint, CategoryColor, PriorityColor.

package app

import (
	"os"
	"syscall"
	"unsafe"
)

const (
	RESET   = "\x1b[0m"
	BOLD    = "\x1b[1m"
	DIM     = "\x1b[2m"
	RED     = "\x1b[31m"
	GREEN   = "\x1b[32m"
	YELLOW  = "\x1b[33m"
	BLUE    = "\x1b[34m"
	MAGENTA = "\x1b[35m"
	CYAN    = "\x1b[36m"
)

// StdoutEnabled is color::stdout_enabled.
// Color is on only when stdout is a TTY and NO_COLOR is unset (empty value still disables).
func StdoutEnabled() bool {
	return isTerminal(os.Stdout) && !noColor()
}

// StderrEnabled is color::stderr_enabled.
func StderrEnabled() bool {
	return isTerminal(os.Stderr) && !noColor()
}

func noColor() bool {
	_, set := os.LookupEnv("NO_COLOR")
	return set
}

// Paint is color::paint. styles are concatenated in order, then text, then RESET.
func Paint(text string, styles []string, enabled bool) string {
	if !enabled || len(styles) == 0 {
		return text
	}
	var b []byte
	for _, style := range styles {
		b = append(b, style...)
	}
	b = append(b, text...)
	b = append(b, RESET...)
	return string(b)
}

// CategoryColor is color::category_color.
func CategoryColor(category string) string {
	switch category {
	case "cloud":
		return CYAN
	case "payment":
		return YELLOW
	case "database":
		return GREEN
	case "ai":
		return MAGENTA
	case "social":
		return BLUE
	case "security":
		return RED
	default:
		return DIM
	}
}

// PriorityColor is color::priority_color.
func PriorityColor(priority string) string {
	switch priority {
	case "P1":
		return YELLOW
	case "P2":
		return CYAN
	case "P3":
		return BLUE
	default:
		return DIM
	}
}

func isTerminal(f *os.File) bool {
	if f == nil {
		return false
	}
	var termios syscall.Termios
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), uintptr(syscall.TCGETS), uintptr(unsafe.Pointer(&termios)))
	return errno == 0
}
