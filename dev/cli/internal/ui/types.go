// Package ui is the inline checkbox picker that replaces cli-rust select.rs.
//
// select.rs redraws on stderr with cursor-up and erase-line. It never enters
// the alternate screen, so View leaves AltScreen false and Run writes to stderr.
// Non-TTY help text and exit codes belong to the app package; Run only reports
// ErrNotTTY.
package ui

import "errors"

// Item is one row. ID is returned in Result.Selected (Label is used when ID
// is empty). Category is a raw id such as "cloud"; unknown values group under
// "other". In ModeOne an unknown category is the section title itself
// (the work menu passes "<tool> — 작업"). Detail is the dim note after the
// label (install version, "미설치").
type Item struct {
	ID       string
	Label    string
	Category string
	Detail   string
}

// Mode selects the picker. The zero value is the checkbox list.
type Mode int

const (
	// ModeMulti is select_many: checkboxes, nothing checked at first.
	ModeMulti Mode = iota
	// ModeOne is select_one: move and Enter accepts the current row.
	ModeOne
)

// Options configures one Run.
type Options struct {
	Title string
	Mode  Mode
	// Color forces ANSI on or off. Nil detects: off when NO_COLOR is set
	// (even if empty) or stderr is not a terminal, matching the Rust picker.
	Color *bool
}

// Result is a finished selection. On abort Run returns ErrAborted and a zero
// Result. Action is one of the Action* constants. Rust's Enter key is '\r';
// this package reports that as ActionMenu so the app can open the work menu.
type Result struct {
	Selected []string
	Action   string
}

const (
	ActionInstall = "i"
	ActionRemove  = "x"
	ActionUpdate  = "u"
	ActionCheck   = "c"
	ActionMenu    = "menu"
	ActionAccept  = "accept"
)

var (
	// ErrNotTTY means stdin or stderr is not an interactive terminal.
	ErrNotTTY = errors.New("ui: interactive terminal required")
	// ErrEmpty means the caller passed no items. Rust bails with "select list is empty".
	ErrEmpty = errors.New("ui: select list is empty")
	// ErrAborted means the user cancelled (q, Esc, Ctrl-C) or a signal stopped the program.
	ErrAborted = errors.New("ui: aborted")
)
