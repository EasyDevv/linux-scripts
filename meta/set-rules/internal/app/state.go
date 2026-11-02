// state.go ports destination inspection: what each item's target path holds
// now (linked, relink, conflict, missing), the ancestor guards, and the
// symlink comparison both the picker and apply depend on.
package app

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// isSymlink is Path.is_symlink().
func isSymlink(p string) bool {
	info, err := os.Lstat(p)
	return err == nil && info.Mode()&os.ModeSymlink != 0
}

// pathExists is Path.exists(): a broken symlink does not exist.
func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// pathIsDir is Path.is_dir().
func pathIsDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// pathIsBrokenSymlink is path_is_broken_symlink().
func pathIsBrokenSymlink(p string) bool { return isSymlink(p) && !pathExists(p) }

// symlinkResolvesTo is symlink_resolves_to(): the link's resolved target must
// equal the resolved source, relative links resolved against the link's dir.
func symlinkResolvesTo(linkPath, sourcePath string) bool {
	if !isSymlink(linkPath) {
		return false
	}
	target, err := os.Readlink(linkPath)
	if err != nil {
		return false
	}
	targetPath := target
	if !filepath.IsAbs(targetPath) {
		targetPath = filepath.Join(filepath.Dir(linkPath), targetPath)
	}
	return resolvePath(targetPath) == resolvePath(sourcePath)
}

// firstBlockingPath is first_blocking_path(): a broken symlink or a non-dir
// blocks the path.
func firstBlockingPath(p string) (string, bool) {
	if isSymlink(p) && !pathExists(p) {
		return p, true
	}
	if pathExists(p) && !pathIsDir(p) {
		return p, true
	}
	return "", false
}

// describeBlockingPath is describe_blocking_path(): relative to the anchor,
// or the anchor's own name for the anchor itself.
func describeBlockingPath(blocking, anchor string) string {
	relative, err := filepath.Rel(anchor, blocking)
	if err != nil || strings.HasPrefix(relative, "..") {
		return filepath.ToSlash(blocking)
	}
	if relative == "." {
		return filepath.Base(anchor)
	}
	return filepath.ToSlash(relative)
}

// destinationAncestors is destination_ancestors().
func destinationAncestors(targetRoot, relativePath string) []string {
	ancestors := []string{filepath.Dir(targetRoot), targetRoot}
	current := targetRoot
	parts := strings.Split(relativePath, "/")
	for _, part := range parts[:max(0, len(parts)-1)] {
		current = filepath.Join(current, part)
		ancestors = append(ancestors, current)
	}
	return ancestors
}

// inspectDestinationState is inspect_destination_state(): the state name and
// the detail the picker prints in parentheses.
func inspectDestinationState(targetRoot, sourceRoot, relativePath string) (state, detail string) {
	destination := filepath.Join(targetRoot, filepath.FromSlash(relativePath))
	sourcePath := filepath.Join(sourceRoot, filepath.FromSlash(relativePath))

	for _, ancestor := range destinationAncestors(targetRoot, relativePath) {
		if blocking, found := firstBlockingPath(ancestor); found {
			anchor := targetRoot
			if ancestor == filepath.Dir(targetRoot) {
				anchor = filepath.Dir(targetRoot)
			}
			return "conflict", "blocked by " + describeBlockingPath(blocking, anchor)
		}
	}

	if isSymlink(destination) {
		if symlinkResolvesTo(destination, sourcePath) {
			return "linked", "already linked"
		}
		return "relink", "different symlink target"
	}
	if pathExists(destination) {
		return "conflict", "existing path"
	}
	return "missing", "not present"
}

// inspectStates is inspect_states().
func (a *app) inspectStates(projectRoot string, items []ManagedItem, modes map[ManagedItem]string) map[ManagedItem]destinationState {
	states := make(map[ManagedItem]destinationState, len(items))
	for _, item := range items {
		states[item] = a.inspectItem(projectRoot, item, modes)
	}
	return states
}

type destinationState struct {
	state  string
	detail string
}

func (a *app) inspectItem(projectRoot string, item ManagedItem, modes map[ManagedItem]string) destinationState {
	state, detail := inspectDestinationState(
		a.targetRootFor(projectRoot, item, modes),
		sourceRootFor(a.ruleRoot, a.skillRoot, item),
		item.RelativePath,
	)
	return destinationState{state: state, detail: detail}
}

// buildSelection is build_selection(): selected means already linked.
func (a *app) buildSelection(projectRoot string, items []ManagedItem, modes map[ManagedItem]string) map[ManagedItem]bool {
	selection := make(map[ManagedItem]bool, len(items))
	for _, item := range items {
		selection[item] = a.inspectItem(projectRoot, item, modes).state == "linked"
	}
	return selection
}

// normalizeSelection is normalize_selection(): at most one `stack-*` rule
// stays selected; the preferred item wins, then a linked one, then a relink.
func normalizeSelection(
	selection map[ManagedItem]bool,
	items []ManagedItem,
	states map[ManagedItem]destinationState,
	preferred ManagedItem,
	hasPreferred bool,
) {
	groups := map[string][]ManagedItem{}
	order := []string{}
	for _, item := range items {
		key, ok := exclusiveGroupKey(item)
		if !ok {
			continue
		}
		if _, seen := groups[key]; !seen {
			order = append(order, key)
		}
		groups[key] = append(groups[key], item)
	}

	for _, key := range order {
		groupItems := groups[key]
		var selectedItems []ManagedItem
		for _, item := range groupItems {
			if selection[item] {
				selectedItems = append(selectedItems, item)
			}
		}
		if len(selectedItems) <= 1 {
			continue
		}

		var keep ManagedItem
		keepFound := false
		if hasPreferred {
			for _, item := range selectedItems {
				if item == preferred {
					keep, keepFound = item, true
					break
				}
			}
		}
		if !keepFound {
			for _, item := range selectedItems {
				if states[item].state == "linked" {
					keep, keepFound = item, true
					break
				}
			}
		}
		if !keepFound {
			for _, item := range selectedItems {
				if states[item].state == "relink" {
					keep, keepFound = item, true
					break
				}
			}
		}

		for _, item := range groupItems {
			selection[item] = keepFound && item == keep
		}
	}
}

// collectConflicts is collect_conflicts().
func (a *app) collectConflicts(projectRoot string, selected []ManagedItem, modes map[ManagedItem]string) []string {
	var conflicts []string
	for _, item := range selected {
		targetRoot := a.targetRootFor(projectRoot, item, modes)
		for _, ancestor := range destinationAncestors(targetRoot, item.RelativePath) {
			if blocking, found := firstBlockingPath(ancestor); found {
				conflicts = append(conflicts, blocking)
				break
			}
		}
		destination := filepath.Join(targetRoot, filepath.FromSlash(item.RelativePath))
		if !isSymlink(destination) && pathExists(destination) {
			conflicts = append(conflicts, destination)
		}
	}
	return conflicts
}

// uniqueSorted is sorted(set(conflicts), key=as_posix).
func uniqueSorted(paths []string) []string {
	seen := map[string]bool{}
	unique := make([]string, 0, len(paths))
	for _, p := range paths {
		if !seen[p] {
			seen[p] = true
			unique = append(unique, p)
		}
	}
	sort.Slice(unique, func(i, j int) bool { return filepath.ToSlash(unique[i]) < filepath.ToSlash(unique[j]) })
	return unique
}
