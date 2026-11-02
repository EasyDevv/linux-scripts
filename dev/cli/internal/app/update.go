// update.go ports cli-rust/src/update.rs.
//
// --check is read-only. Replace and rollback both go through installToolWith
// (gate included). Rollback reinstalls the previous version stored in the lock.
// Vendor sha256 is cleared so the gate judges the new bytes.
// render is updateRender: audit.go already owns render.

package app

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Candidate is one tool's update lookup. Status is latest, update, cooldown, or unknown.
type Candidate struct {
	Name    string  `json:"name"`
	Current string  `json:"current"`
	Latest  *string `json:"latest"`
	Status  string  `json:"status"`
	Detail  string  `json:"detail"`
}

// checkTool looks up one candidate. Lookup failures are status unknown, not errors.
func checkTool(tool *Tool, entry *LockEntry, fetch Fetch, now time.Time, cooldownDays uint32) Candidate {
	candidate := Candidate{
		Name:    tool.Name,
		Current: entry.Version,
		Status:  "unknown",
	}
	latest, err := latestCandidate(tool, fetch)
	if err != nil {
		candidate.Detail = err.Error()
		return candidate
	}
	latest = plainVersion(latest)
	candidate.Latest = &latest
	if plainVersion(entry.Version) == latest {
		candidate.Status = "latest"
		return candidate
	}
	next := *tool
	nextVersion := latest
	next.Version = &nextVersion
	published, err := publishedAt(&next, latest, fetch)
	if err != nil {
		candidate.Detail = fmt.Sprintf("게시 시각 확인 실패: %s", err.Error())
		return candidate
	}
	if err := checkCooldown(published, now, cooldownDays); err != nil {
		var violation *CooldownViolation
		if errors.As(err, &violation) && violation != nil {
			candidate.Status = "cooldown"
			candidate.Detail = fmt.Sprintf("게시 %d일 전, %d일 필요", violation.AgeDays, violation.RequiredDays)
			return candidate
		}
		candidate.Detail = fmt.Sprintf("게시 시각 확인 실패: %s", err.Error())
		return candidate
	}
	candidate.Status = "update"
	candidate.Detail = fmt.Sprintf("게시 %s", published.UTC().Format("2006-01-02"))
	return candidate
}

// checkAll skips tools missing from the lock, and tools whose HTTP client cannot be built.
func checkAll(tools []*Tool, lock *LockFile, now time.Time, cooldownDays uint32) []Candidate {
	if lock == nil {
		return nil
	}
	var out []Candidate
	for _, tool := range tools {
		if tool == nil {
			continue
		}
		entry, ok := lock.Tools[tool.Name]
		if !ok {
			continue
		}
		fetch, err := newHttpFetch(ForTool(tool))
		if err != nil {
			continue
		}
		out = append(out, checkTool(tool, &entry, fetch, now, cooldownDays))
	}
	return out
}

// updateRender is update::render. Named aside from audit.go render.
func updateRender(candidates []Candidate) string {
	width := 4
	for _, c := range candidates {
		if n := len(c.Name); n > width {
			width = n
		}
	}
	var out strings.Builder
	for _, c := range candidates {
		label := "확인 불가"
		switch c.Status {
		case "latest":
			label = "최신"
		case "update":
			label = "교체 가능"
		case "cooldown":
			label = "대기"
		}
		latest := "-"
		if c.Latest != nil {
			latest = *c.Latest
		}
		fmt.Fprintf(&out, "%s  %s → %s  %s  %s\n", padRight(c.Name, width), c.Current, latest, label, c.Detail)
	}
	if len(candidates) == 0 {
		out.WriteString("cli 로 설치한 도구가 없습니다\n")
	}
	return out.String()
}

// updateTool replaces the locked version with the latest candidate.
// A vendor pin is cleared because it does not apply to the new bytes.
func updateTool(env *Env, tool *Tool, fetch Fetch) (Outcome, error) {
	lock, err := LoadLockFile(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	entry, ok := lock.Tools[tool.Name]
	if !ok {
		return Outcome{}, fmt.Errorf("%s: cli 로 설치한 기록이 없습니다 (cli install)", tool.Name)
	}
	latest, err := latestCandidate(tool, fetch)
	if err != nil {
		return Outcome{}, err
	}
	latest = plainVersion(latest)
	if plainVersion(entry.Version) == latest {
		return Outcome{Kind: OutcomeAlreadyInstalled, Version: entry.Version}, nil
	}
	return replaceWith(env, tool, latest)
}

// rollbackTool reinstalls the previous version recorded in the lock.
func rollbackTool(env *Env, tool *Tool) (Outcome, error) {
	lock, err := LoadLockFile(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	entry, ok := lock.Tools[tool.Name]
	if !ok {
		return Outcome{}, fmt.Errorf("%s: cli 로 설치한 기록이 없습니다", tool.Name)
	}
	if entry.Previous == nil {
		return Outcome{}, fmt.Errorf("%s: 되돌릴 이전 버전 기록이 없습니다", tool.Name)
	}
	return replaceWith(env, tool, *entry.Previous)
}

func replaceWith(env *Env, tool *Tool, version string) (Outcome, error) {
	next := *tool
	pinned := version
	next.Version = &pinned
	if next.Method == MethodVendor {
		next.SHA256 = nil
	}
	outcome, err := installToolWith(env, &next, true)
	if err != nil {
		return Outcome{}, err
	}
	if outcome.Kind == OutcomeInstalled {
		if err := writeVersion(env.ManifestPath, tool.Name, version); err != nil {
			return Outcome{}, err
		}
	}
	return outcome, nil
}
