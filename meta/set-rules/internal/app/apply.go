// apply.go ports apply_selection(): the conflict refusal, the link creation,
// the move between rules/ and rules-routed/, and the summary counts.
package app

import (
	"fmt"
	"os"
	"path/filepath"
)

// removePath is remove_path().
func removePath(p string) error {
	if isSymlink(p) || !pathIsDir(p) {
		if err := os.Remove(p); err != nil {
			return err
		}
		return nil
	}
	return os.RemoveAll(p)
}

// applySelection is apply_selection().
func (a *app) applySelection(projectRoot string, items []ManagedItem, selected []ManagedItem, modes map[ManagedItem]string) (linked, moved, removed, unchanged []ManagedItem, err error) {
	agentsDir := filepath.Join(projectRoot, ".agents")
	if pathIsBrokenSymlink(agentsDir) || (pathExists(agentsDir) && !pathIsDir(agentsDir)) {
		return nil, nil, nil, nil, fmt.Errorf("Target path exists and is not a directory: %s", agentsDir)
	}

	if conflicts := a.collectConflicts(projectRoot, selected, modes); len(conflicts) > 0 {
		message := "Refusing to overwrite existing non-symlink paths:"
		for _, conflict := range uniqueSorted(conflicts) {
			message += "\n- " + conflict
		}
		return nil, nil, nil, nil, fmt.Errorf("%s", message)
	}

	selectedSet := make(map[ManagedItem]bool, len(selected))
	for _, item := range selected {
		selectedSet[item] = true
	}

	for _, item := range items {
		if !selectedSet[item] {
			continue
		}
		sourcePath := filepath.Join(sourceRootFor(a.ruleRoot, a.skillRoot, item), filepath.FromSlash(item.RelativePath))
		destination := filepath.Join(a.targetRootFor(projectRoot, item, modes), filepath.FromSlash(item.RelativePath))
		created := false
		if isSymlink(destination) && !symlinkResolvesTo(destination, sourcePath) {
			if removeErr := os.Remove(destination); removeErr != nil {
				return nil, nil, nil, nil, removeErr
			}
		} else if pathExists(destination) && !isSymlink(destination) {
			return nil, nil, nil, nil, fmt.Errorf("Refusing to overwrite existing non-symlink path: %s", destination)
		}
		if !isSymlink(destination) {
			if mkdirErr := os.MkdirAll(filepath.Dir(destination), 0o755); mkdirErr != nil {
				return nil, nil, nil, nil, mkdirErr
			}
			if linkErr := os.Symlink(sourcePath, destination); linkErr != nil {
				return nil, nil, nil, nil, linkErr
			}
			created = true
		}
		staleRemoved := false
		for _, stale := range a.staleLinkPaths(projectRoot, item, modes) {
			if stale == destination {
				continue
			}
			if isSymlink(stale) && symlinkResolvesTo(stale, sourcePath) {
				if removeErr := removePath(stale); removeErr != nil {
					return nil, nil, nil, nil, removeErr
				}
				staleRemoved = true
			}
		}
		switch {
		case staleRemoved:
			moved = append(moved, item)
		case created:
			linked = append(linked, item)
		default:
			unchanged = append(unchanged, item)
		}
	}

	inSelected := func(item ManagedItem) bool { return selectedSet[item] }
	for _, item := range items {
		if inSelected(item) {
			continue
		}
		sourcePath := filepath.Join(sourceRootFor(a.ruleRoot, a.skillRoot, item), filepath.FromSlash(item.RelativePath))
		destinations := append([]string{
			filepath.Join(a.targetRootFor(projectRoot, item, modes), filepath.FromSlash(item.RelativePath)),
		}, a.staleLinkPaths(projectRoot, item, modes)...)
		seen := map[string]bool{}
		for _, destination := range destinations {
			if seen[destination] {
				continue
			}
			seen[destination] = true
			if isSymlink(destination) && symlinkResolvesTo(destination, sourcePath) {
				if removeErr := removePath(destination); removeErr != nil {
					return nil, nil, nil, nil, removeErr
				}
				alreadyRemoved := false
				for _, done := range removed {
					if done == item {
						alreadyRemoved = true
						break
					}
				}
				if !alreadyRemoved {
					removed = append(removed, item)
				}
			}
		}
	}

	return linked, moved, removed, unchanged, nil
}

// printSummary is print_summary().
func (a *app) printSummary(projectRoot string, linked, moved, removed, unchanged []ManagedItem) {
	fmt.Fprintln(a.stdout, paint(a.color, "Target project: "+projectRoot, boldSeq, blueSeq))
	fmt.Fprintln(a.stdout, paint(a.color, "Rule source: "+a.ruleRoot, boldSeq, blueSeq))
	fmt.Fprintln(a.stdout, paint(a.color, "Skill source: "+a.skillRoot, boldSeq, blueSeq))
	fmt.Fprintln(a.stdout, paint(a.color, fmt.Sprintf(
		"Linked: %d | Moved: %d | Removed: %d | Unchanged: %d",
		len(linked), len(moved), len(removed), len(unchanged),
	), boldSeq))
	groups := []struct {
		label string
		items []ManagedItem
		style string
	}{
		{"Linked", linked, magentaSeq},
		{"Moved", moved, greenSeq},
		{"Removed", removed, cyanSeq},
		{"Unchanged", unchanged, dimSeq},
	}
	for _, group := range groups {
		if len(group.items) == 0 {
			continue
		}
		fmt.Fprintln(a.stdout, paint(a.color, group.label+":", boldSeq, group.style))
		for _, item := range group.items {
			fmt.Fprintf(a.stdout, "  - %s: %s\n", item.Kind, item.displayName())
		}
	}
}
