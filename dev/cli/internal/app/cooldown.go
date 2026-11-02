// cooldown.go ports cli-rust/src/cooldown.rs.
//
// parseTime accepts RFC3339 and RFC2822 (HTTP date) and returns UTC.
// checkCooldown fails when age is strictly less than required_days * 86400 seconds.
// The boundary is inclusive. age_days is Euclidean division of whole seconds.

package app

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// CooldownViolation is cooldown::CooldownViolation.
// Published is formatted like chrono DateTime::to_rfc3339 (UTC is +00:00, not Z).
type CooldownViolation struct {
	Published    time.Time
	AgeDays      int64
	RequiredDays uint32
}

func (e *CooldownViolation) Error() string {
	if e == nil {
		return "cooldown: published , age 0d, required 0d"
	}
	return fmt.Sprintf(
		"cooldown: published %s, age %dd, required %dd",
		formatRFC3339(e.Published),
		e.AgeDays,
		e.RequiredDays,
	)
}

// parseTime is parse_time. Unrecognized input is "unrecognized time: {text}".
func parseTime(text string) (time.Time, error) {
	text = strings.TrimSpace(text)
	if parsed, err := time.Parse(time.RFC3339Nano, text); err == nil {
		return parsed.UTC(), nil
	}
	for _, layout := range httpDateLayouts {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized time: %s", text)
}

// checkCooldown is check_cooldown.
func checkCooldown(published, now time.Time, requiredDays uint32) error {
	age := chronoSeconds(now.Sub(published))
	required := saturatingMul(int64(requiredDays), 86_400)
	if age < required {
		return &CooldownViolation{
			Published:    published,
			AgeDays:      divEuclid(age, 86_400),
			RequiredDays: requiredDays,
		}
	}
	return nil
}

// formatRFC3339 is chrono's to_rfc3339 with SecondsFormat::AutoSi.
func formatRFC3339(t time.Time) string {
	if t.Nanosecond() == 0 {
		return t.Format("2006-01-02T15:04:05-07:00")
	}
	formatted := t.Format("2006-01-02T15:04:05.000000000-07:00")
	dot := strings.IndexByte(formatted, '.')
	zone := len(formatted) - len("-07:00")
	if dot < 0 || zone < dot {
		return formatted
	}
	frac := strings.TrimRight(formatted[dot+1:zone], "0")
	return formatted[:dot+1] + frac + formatted[zone:]
}

func chronoSeconds(d time.Duration) int64 {
	sec := int64(d / time.Second)
	if d < 0 && d%time.Second != 0 {
		sec--
	}
	return sec
}

func divEuclid(a, b int64) int64 {
	q := a / b
	r := a % b
	if r < 0 {
		q--
	}
	return q
}

func saturatingMul(a, b int64) int64 {
	if a == 0 || b == 0 {
		return 0
	}
	if a > 0 && b > 0 && a > math.MaxInt64/b {
		return math.MaxInt64
	}
	if a < 0 && b < 0 && a < math.MaxInt64/b {
		return math.MaxInt64
	}
	if a > 0 && b < 0 && b < math.MinInt64/a {
		return math.MinInt64
	}
	if a < 0 && b > 0 && a < math.MinInt64/b {
		return math.MinInt64
	}
	return a * b
}

var httpDateLayouts = []string{
	time.RFC1123,  // Mon, 02 Jan 2006 15:04:05 MST
	time.RFC1123Z, // Mon, 02 Jan 2006 15:04:05 -0700
	"Mon, 2 Jan 2006 15:04:05 MST",
	"Mon, 2 Jan 2006 15:04:05 -0700",
	"Mon, 02 Jan 2006 15:04:05 GMT",
	"02 Jan 2006 15:04:05 MST",
	"2 Jan 2006 15:04:05 MST",
	"02 Jan 2006 15:04:05 -0700",
	"Mon, 02 Jan 2006 15:04:05 -0700",
}
