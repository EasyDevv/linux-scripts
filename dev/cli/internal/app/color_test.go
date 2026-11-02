package app

import (
	"strings"
	"testing"
)

func TestPaintResetsWhenEnabled(t *testing.T) {
	painted := Paint("명령", []string{BOLD, CYAN}, true)
	if !strings.HasPrefix(painted, BOLD) {
		t.Fatalf("paint does not start with BOLD: %q", painted)
	}
	if !strings.Contains(painted, CYAN) {
		t.Fatalf("paint missing CYAN: %q", painted)
	}
	if !strings.HasSuffix(painted, RESET) {
		t.Fatalf("paint does not end with RESET: %q", painted)
	}
	if !strings.Contains(painted, "명령") {
		t.Fatalf("paint missing text: %q", painted)
	}
}

func TestPaintIsPlainWhenDisabled(t *testing.T) {
	if got := Paint("명령", []string{BOLD}, false); got != "명령" {
		t.Fatalf("disabled paint = %q", got)
	}
	if got := Paint("명령", nil, true); got != "명령" {
		t.Fatalf("empty styles paint = %q", got)
	}
}
