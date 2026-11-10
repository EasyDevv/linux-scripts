package app

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
)

// shortPath shows the package directory with $HOME collapsed to ~.
func shortPath(dir string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return dir
	}
	if dir == home {
		return "~"
	}
	if strings.HasPrefix(dir, home+string(filepath.Separator)) {
		return "~" + dir[len(home):]
	}
	return dir
}

// printList writes the list form: Recent rows marked with *, then the rest.
type listRow struct {
	Name    string `json:"name"`
	Command string `json:"command"`
	Recent  bool   `json:"recent"`
	Count   int    `json:"count"`
}

type listDoc struct {
	Dir     string    `json:"dir"`
	Name    string    `json:"name"`
	PM      string    `json:"pm"`
	Scripts []listRow `json:"scripts"`
}

func buildList(pkg Package, recent []recentEntry) []listRow {
	commands := make(map[string]string, len(pkg.Scripts))
	for _, s := range pkg.Scripts {
		commands[s.Name] = s.Command
	}
	seen := make(map[string]bool, len(recent))
	rows := make([]listRow, 0, len(pkg.Scripts))
	for _, entry := range recent {
		seen[entry.Name] = true
		rows = append(rows, listRow{Name: entry.Name, Command: commands[entry.Name], Recent: true, Count: entry.Count})
	}
	for _, s := range pkg.Scripts {
		if seen[s.Name] {
			continue
		}
		rows = append(rows, listRow{Name: s.Name, Command: s.Command})
	}
	return rows
}

// printList prints the list as text or JSON. Text columns are aligned with
// a tabwriter so a long script name does not shift the command column.
func printList(w io.Writer, pkg Package, recent []recentEntry, asJSON bool) error {
	rows := buildList(pkg, recent)
	if asJSON {
		doc := listDoc{Dir: pkg.Dir, Name: displayName(pkg), PM: pkg.PM, Scripts: rows}
		data, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(w, "%s\n", data)
		return err
	}
	fmt.Fprintf(w, "%s  %s  (%s)\n", displayName(pkg), shortPath(pkg.Dir), pkg.PM)
	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	for _, row := range rows {
		marker := " "
		note := ""
		if row.Recent {
			marker = "*"
			note = fmt.Sprintf("  ×%d", row.Count)
		}
		fmt.Fprintf(tw, "%s %s\t%s%s\n", marker, row.Name, row.Command, note)
	}
	return tw.Flush()
}
