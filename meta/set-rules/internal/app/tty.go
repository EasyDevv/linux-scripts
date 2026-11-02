package app

import (
	"os"

	"github.com/charmbracelet/x/term"
)

// isTerminal reports whether the stream is a terminal, for the color switch
// and the interactive guard.
func isTerminal(file *os.File) bool { return term.IsTerminal(file.Fd()) }
