package app

import "testing"

// TestColorAllowed pins the single switch: both streams TTY, NO_COLOR unset or
// empty, TERM not dumb.
func TestColorAllowed(t *testing.T) {
	cases := []struct {
		name             string
		stdout, stderr   bool
		noColor, termVar string
		want             bool
	}{
		{"both ttys", true, true, "", "xterm-256color", true},
		{"stdout pipe", false, true, "", "xterm-256color", false},
		{"stderr pipe", true, false, "", "xterm-256color", false},
		{"no color set", true, true, "1", "xterm-256color", false},
		{"no color empty", true, true, "", "xterm-256color", true},
		{"term dumb", true, true, "", "dumb", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("NO_COLOR", tc.noColor)
			t.Setenv("TERM", tc.termVar)
			if got := colorAllowed(tc.stdout, tc.stderr); got != tc.want {
				t.Fatalf("colorAllowed(%v, %v) with NO_COLOR=%q TERM=%q = %v, want %v",
					tc.stdout, tc.stderr, tc.noColor, tc.termVar, got, tc.want)
			}
		})
	}
}
