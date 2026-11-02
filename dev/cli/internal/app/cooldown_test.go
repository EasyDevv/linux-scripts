package app

import (
	"testing"
	"time"
)

func TestParsesRfc3339AndHttpDate(t *testing.T) {
	rfc3339, err := parseTime("2026-10-30T18:58:48Z")
	if err != nil {
		t.Fatal(err)
	}
	http, err := parseTime("Fri, 30 Oct 2026 18:58:48 GMT")
	if err != nil {
		t.Fatal(err)
	}
	if !rfc3339.Equal(http) {
		t.Fatalf("rfc3339 %s http %s", rfc3339, http)
	}
	if got := formatRFC3339(rfc3339); got != "2026-10-30T18:58:48+00:00" {
		t.Fatalf("to_rfc3339 %s", got)
	}
}

func TestCooldownBoundaryIsInclusiveAndFutureFails(t *testing.T) {
	published, err := parseTime("2026-10-30T18:58:48Z")
	if err != nil {
		t.Fatal(err)
	}
	if err := checkCooldown(published, published.AddDate(0, 0, 7), 7); err != nil {
		t.Fatal(err)
	}
	early := published.AddDate(0, 0, 6).Add(23 * time.Hour)
	err = checkCooldown(published, early, 7)
	violation, ok := err.(*CooldownViolation)
	if !ok {
		t.Fatalf("error type %T %v", err, err)
	}
	if violation.RequiredDays != 7 || violation.AgeDays != 6 {
		t.Fatalf("%+v", violation)
	}
	if err := checkCooldown(published, published.Add(-time.Second), 7); err == nil {
		t.Fatal("future publish should fail")
	}
}
