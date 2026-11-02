// commit.go ports the db:snapshot pre-step and commit() from ship.ts,
// including the default message built from `git diff --cached --numstat`.
package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// commitPlan is what commit() decided before running git commit.
// Message is empty when there is nothing to commit; Notice is then the line
// ship prints instead.
type commitPlan struct {
	Message string
	Notice  string
}

// dbSnapshot runs package.json's db:snapshot script when it exists, and stops
// the ship on a failure. A missing/unreadable/invalid package.json is ignored,
// as the original's try/catch did.
func (c *ctx) dbSnapshot() error {
	pkgPath := filepath.Join(c.root, "package.json")
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return nil
	}
	var pkg struct {
		Scripts map[string]json.RawMessage `json:"scripts"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}
	script, ok := pkg.Scripts["db:snapshot"]
	if !ok || !truthy(script) {
		return nil
	}
	c.printf("db:snapshot: running...\n")
	res, err := c.exec(c.root, true, "bun", "run", "db:snapshot")
	if err != nil {
		return nil // the original's try/catch swallowed a spawn failure
	}
	if res.Code != 0 {
		if res.Stderr != "" {
			c.eprintf("%s\n", res.Stderr)
		}
		return fatal("db:snapshot failed, aborting commit/push")
	}
	c.printf("db:snapshot: ok\n")
	return nil
}

// truthy is JavaScript truthiness for a JSON value in a package.json script
// slot: null, false, 0 and "" are falsy.
func truthy(raw json.RawMessage) bool {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return false
	}
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case float64:
		return v != 0
	case string:
		return v != ""
	default:
		return true
	}
}

// commitChanges is commit(): stage everything, then commit with the flag
// message or the generated default. It reports whether a commit was made.
func (c *ctx) commitChanges() (bool, error) {
	if res, err := c.git(false, "add", "."); err != nil {
		return false, fatal(err.Error())
	} else if res.Code != 0 {
		// Bun's `$` throws on a non-zero exit; ship stops there.
		return false, exitCode(1)
	}

	res, err := c.git(true, "diff", "--cached", "--numstat")
	if err != nil {
		return false, fatal(err.Error())
	}
	plan := planCommit(res.Stdout, c.opts.Message)
	if plan.Message == "" {
		c.printf("%s\n", plan.Notice)
		return false, nil
	}

	committed, err := c.git(false, "commit", "-m", plan.Message)
	if err != nil {
		return false, fatal(err.Error())
	}
	if committed.Code != 0 {
		// The original threw here (uncaught shell error, exit 1). Git's own
		// output is already on the terminal.
		return false, exitCode(1)
	}
	return true, nil
}

type fileChange struct {
	filename string
	total    int
}

// planCommit is the message builder: the 5 files with the most added+deleted
// lines, by basename, then "and N other(s)". Binary lines (-/-) are skipped.
func planCommit(numstat, flagMessage string) commitPlan {
	lines := []string{}
	if trimmed := strings.TrimSpace(numstat); trimmed != "" {
		for _, line := range strings.Split(trimmed, "\n") {
			if line != "" {
				lines = append(lines, line)
			}
		}
	}
	if len(lines) == 0 {
		return commitPlan{Notice: "nothing to commit, working tree clean"}
	}

	if message := strings.TrimSpace(flagMessage); message != "" {
		return commitPlan{Message: message}
	}

	changes := make([]fileChange, 0, len(lines))
	for _, line := range lines {
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}
		added, deleted := parts[0], parts[1]
		if added == "-" || deleted == "-" {
			continue
		}
		filename := strings.Join(parts[2:], "\t")
		total := parseInt(added) + parseInt(deleted)
		changes = append(changes, fileChange{filename: filename, total: total})
	}
	if len(changes) == 0 {
		return commitPlan{Notice: "nothing to commit (only binary files changed)"}
	}

	sort.SliceStable(changes, func(i, j int) bool { return changes[i].total > changes[j].total })
	count := len(changes)
	if count > 5 {
		count = 5
	}
	names := make([]string, count)
	for i := 0; i < count; i++ {
		names[i] = basename(changes[i].filename)
	}
	message := strings.Join(names, ", ")
	if rest := len(changes) - 5; rest > 0 {
		suffix := "others"
		if rest == 1 {
			suffix = "other"
		}
		message = fmt.Sprintf("%s and %d %s", message, rest, suffix)
	}
	return commitPlan{Message: message}
}

// parseInt is JavaScript's parseInt(s, 10) for the digit fields numstat prints.
func parseInt(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	n, err := strconv.Atoi(s[:end])
	if err != nil {
		return 0
	}
	return n
}

// basename is JavaScript's `filename.split("/").pop()`.
func basename(filename string) string {
	if i := strings.LastIndex(filename, "/"); i >= 0 {
		return filename[i+1:]
	}
	return filename
}
