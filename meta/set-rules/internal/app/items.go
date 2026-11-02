// items.go ports the inventory half of set-rules.py: source roots, rule and
// skill discovery, the general/stack/skills grouping, the display-entry list
// the picker scrolls, and the always/routed mode rules read from frontmatter.
package app

import (
	"fmt"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"sort"
	"strings"
)

const (
	ruleSuffix      = ".md"
	alwaysMode      = "always"
	routedMode      = "routed"
	exclusivePrefix = "stack-"

	// skillSourceDefault is SKILL_SOURCE_ROOT in the original: a literal absolute
	// path, so it does not move with HOME.
	skillSourceDefault = "/home/easydev/.agents/skills-optional"
)

// ruleModeDirs maps a rule mode to the directory it links into, in the
// original's dict order (always first).
var ruleModeDirs = []struct {
	mode string
	dir  string
}{
	{alwaysMode, "rules"},
	{routedMode, "rules-routed"},
}

// ManagedItem is one rule or skill the tool can link.
type ManagedItem struct {
	Kind         string // "rule" or "skill"
	RelativePath string // slash-separated, relative to its source root
}

func (m ManagedItem) parts() []string { return strings.Split(m.RelativePath, "/") }

// displayName is display_name_for(): a rule loses its .md suffix.
func (m ManagedItem) displayName() string {
	base := filepath.Base(m.RelativePath)
	if m.Kind == "rule" {
		return strings.TrimSuffix(base, ruleSuffix)
	}
	return base
}

// sourceRootFor is source_root_for().
func sourceRootFor(ruleRoot, skillRoot string, item ManagedItem) string {
	if item.Kind == "rule" {
		return ruleRoot
	}
	return skillRoot
}

// expandUser is Path.expanduser for the "~/..." forms the script uses; an
// unknown "~user" stays literal, as expanduser leaves it when pwd cannot say.
func expandUser(p string) string {
	if p != "~" && !strings.HasPrefix(p, "~/") {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		// expanduser falls back to the pwd entry when HOME is unset.
		if current, userErr := user.Current(); userErr == nil {
			home = current.HomeDir
		} else {
			return p
		}
	}
	if p == "~" {
		return home
	}
	return filepath.Join(home, strings.TrimPrefix(p, "~/"))
}

// resolvePath is Path.resolve() for a path that may not exist: absolute,
// cleaned, and symlink-resolved when the kernel can.
func resolvePath(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = filepath.Clean(p)
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return resolved
	}
	return abs
}

// ruleSourceRoot is RULE_SOURCE_ROOT.
func ruleSourceRoot() string { return resolvePath(expandUser("~/.agents/rules-optional")) }

// skillSourceRoot is SKILL_SOURCE_ROOT.
func skillSourceRoot() string { return resolvePath(skillSourceDefault) }

// listRuleItems is list_rule_items(): every *.md file under the rule root,
// sorted by its POSIX relative path.
func listRuleItems(root string) ([]ManagedItem, error) {
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("Source directory does not exist: %s", root)
	}
	var items []ManagedItem
	walkErr := filepath.WalkDir(root, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil // an unreadable subtree contributes nothing
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ruleSuffix) {
			return nil
		}
		// is_file() follows symlinks; WalkDir's type does not.
		info, statErr := os.Stat(p)
		if statErr != nil || !info.Mode().IsRegular() {
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		items = append(items, ManagedItem{Kind: "rule", RelativePath: filepath.ToSlash(rel)})
		return nil
	})
	if walkErr != nil {
		return nil, fmt.Errorf("Source directory does not exist: %s", root)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].RelativePath < items[j].RelativePath })
	if len(items) == 0 {
		return nil, fmt.Errorf("No rule files found in: %s", root)
	}
	return items, nil
}

// listSkillItems is list_skill_items(): the directories holding a SKILL.md,
// keeping the category folder. A missing skill root is not an error.
func listSkillItems(root string) []ManagedItem {
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return nil
	}
	seen := map[string]bool{}
	var rels []string
	_ = filepath.WalkDir(root, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() || entry.Name() != "SKILL.md" {
			return nil
		}
		rel, relErr := filepath.Rel(root, filepath.Dir(p))
		if relErr != nil {
			return nil
		}
		posix := filepath.ToSlash(rel)
		if !seen[posix] {
			seen[posix] = true
			rels = append(rels, posix)
		}
		return nil
	})
	sort.Strings(rels)
	items := make([]ManagedItem, 0, len(rels))
	for _, rel := range rels {
		items = append(items, ManagedItem{Kind: "skill", RelativePath: rel})
	}
	return items
}

// listInstructionItems is list_instruction_items().
func listInstructionItems(ruleRoot, skillRoot string) ([]ManagedItem, error) {
	rules, err := listRuleItems(ruleRoot)
	if err != nil {
		return nil, err
	}
	return append(rules, listSkillItems(skillRoot)...), nil
}

// skillGroupKey is skill_group_key(): a `_group` top folder becomes a section.
func skillGroupKey(item ManagedItem) (string, bool) {
	if item.Kind != "skill" {
		return "", false
	}
	parts := item.parts()
	if len(parts) >= 2 && strings.HasPrefix(parts[0], "_") && len(parts[0]) > 1 {
		return parts[0], true
	}
	return "", false
}

// iterSkillSections is iter_skill_sections(): ungrouped skills first, then
// each `_group` in sorted key order.
func iterSkillSections(items []ManagedItem) []section {
	var ungrouped []ManagedItem
	grouped := map[string][]ManagedItem{}
	for _, item := range items {
		if item.Kind != "skill" {
			continue
		}
		key, ok := skillGroupKey(item)
		if !ok {
			ungrouped = append(ungrouped, item)
			continue
		}
		grouped[key] = append(grouped[key], item)
	}
	var sections []section
	if len(ungrouped) > 0 {
		sections = append(sections, section{label: "Skills", items: ungrouped})
	}
	keys := make([]string, 0, len(grouped))
	for key := range grouped {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		sections = append(sections, section{label: "Skills / " + strings.TrimPrefix(key, "_"), items: grouped[key]})
	}
	return sections
}

type section struct {
	label string
	items []ManagedItem
}

// exclusiveGroupKey is exclusive_group_key(): `stack-*` rules are exclusive.
func exclusiveGroupKey(item ManagedItem) (string, bool) {
	if item.Kind != "rule" {
		return "", false
	}
	stem := strings.TrimSuffix(filepath.Base(item.RelativePath), ruleSuffix)
	if strings.HasPrefix(stem, exclusivePrefix) {
		return exclusivePrefix, true
	}
	return "", false
}

// groupInstructionItems is group_instruction_items(): general rules, stack
// rules, then skills section by section.
func groupInstructionItems(items []ManagedItem) []ManagedItem {
	var general, stack []ManagedItem
	for _, item := range items {
		if item.Kind != "rule" {
			continue
		}
		if _, exclusive := exclusiveGroupKey(item); exclusive {
			stack = append(stack, item)
		} else {
			general = append(general, item)
		}
	}
	grouped := append(general, stack...)
	for _, sec := range iterSkillSections(items) {
		grouped = append(grouped, sec.items...)
	}
	return grouped
}

// entry is one display line of the picker list: a spacer, a section header,
// or an item row.
type entry struct {
	kind  string // "spacer", "section", "item"
	label string
	item  ManagedItem
}

// buildDisplayEntries is build_display_entries().
func buildDisplayEntries(items []ManagedItem) ([]entry, map[ManagedItem]int) {
	var general, stack []ManagedItem
	for _, item := range items {
		if item.Kind != "rule" {
			continue
		}
		if _, exclusive := exclusiveGroupKey(item); exclusive {
			stack = append(stack, item)
		} else {
			general = append(general, item)
		}
	}
	sections := []section{{label: "General", items: general}, {label: "Stack", items: stack}}
	sections = append(sections, iterSkillSections(items)...)

	var entries []entry
	index := map[ManagedItem]int{}
	for _, sec := range sections {
		if len(sec.items) == 0 {
			continue
		}
		entries = append(entries, entry{kind: "spacer"})
		entries = append(entries, entry{kind: "section", label: fmt.Sprintf("%s (%d)", sec.label, len(sec.items))})
		entries = append(entries, entry{kind: "spacer"})
		for _, item := range sec.items {
			index[item] = len(entries)
			entries = append(entries, entry{kind: "item", item: item})
		}
	}
	return entries, index
}

// ruleFrontmatter is rule_frontmatter(): the lines between the first `---`
// and the closing `---`, or nothing when the file has no frontmatter block.
func (a *app) ruleFrontmatter(item ManagedItem) []string {
	data, err := os.ReadFile(filepath.Join(a.ruleRoot, filepath.FromSlash(item.RelativePath)))
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], " \t\r\n\v\f") != "---" {
		return nil
	}
	var frontmatter []string
	for _, line := range lines[1:] {
		if strings.TrimRight(line, " \t\r\n\v\f") == "---" {
			return frontmatter
		}
		frontmatter = append(frontmatter, line)
	}
	return nil
}

// ruleHasDescription is rule_has_description().
func (a *app) ruleHasDescription(item ManagedItem) bool {
	for _, line := range a.ruleFrontmatter(item) {
		if strings.HasPrefix(line, "description:") {
			return true
		}
	}
	return false
}

// ruleLoadOverride is rule_load_override().
func (a *app) ruleLoadOverride(item ManagedItem) (string, bool) {
	for _, line := range a.ruleFrontmatter(item) {
		if !strings.HasPrefix(line, "load:") {
			continue
		}
		_, value, _ := strings.Cut(line, ":")
		value = strings.TrimSpace(value)
		value = strings.Trim(value, "\"'")
		value = strings.ToLower(value)
		for _, mode := range ruleModeDirs {
			if value == mode.mode {
				return value, true
			}
		}
	}
	return "", false
}

// ruleDefaultMode is rule_default_mode(): a rule without `description:` stays
// always, because the routed classifier keys on that description.
func (a *app) ruleDefaultMode(item ManagedItem) string {
	if !a.ruleHasDescription(item) {
		return alwaysMode
	}
	if override, ok := a.ruleLoadOverride(item); ok {
		return override
	}
	return routedMode
}

// ruleIsRouted is rule_is_routed().
func (a *app) ruleIsRouted(item ManagedItem) bool { return a.ruleDefaultMode(item) == routedMode }

// modeFor is mode_for(): the user's picker choice wins over the default.
func (a *app) modeFor(item ManagedItem, modes map[ManagedItem]string) string {
	if mode, ok := modes[item]; ok && mode != "" {
		return mode
	}
	if a.ruleIsRouted(item) {
		return routedMode
	}
	return alwaysMode
}

// ruleModeTargets is rule_mode_targets().
func ruleModeTarget(projectRoot, mode string) string {
	for _, pair := range ruleModeDirs {
		if pair.mode == mode {
			return filepath.Join(projectRoot, ".agents", pair.dir)
		}
	}
	return filepath.Join(projectRoot, ".agents", "rules")
}

// targetRootFor is target_root_for(): a skill is routed for that project
// only; a rule goes to the directory of its mode.
func (a *app) targetRootFor(projectRoot string, item ManagedItem, modes map[ManagedItem]string) string {
	if item.Kind == "skill" {
		return filepath.Join(projectRoot, ".agents", "skills-routed")
	}
	return ruleModeTarget(projectRoot, a.modeFor(item, modes))
}

// otherRuleRoot is other_rule_root().
func (a *app) otherRuleRoot(projectRoot string, item ManagedItem, modes map[ManagedItem]string) string {
	other := routedMode
	if a.modeFor(item, modes) == routedMode {
		other = alwaysMode
	}
	return ruleModeTarget(projectRoot, other)
}

// staleLinkPaths is stale_link_paths(): the same rule linked in the other
// directory is stale, because apply moves the link.
func (a *app) staleLinkPaths(projectRoot string, item ManagedItem, modes map[ManagedItem]string) []string {
	if item.Kind != "rule" {
		return nil
	}
	return []string{filepath.Join(a.otherRuleRoot(projectRoot, item, modes), filepath.FromSlash(item.RelativePath))}
}

// ruleLinkMode is rule_link_mode(): an existing link keeps its directory as
// the mode.
func (a *app) ruleLinkMode(projectRoot string, item ManagedItem) (string, bool) {
	source := filepath.Join(a.ruleRoot, filepath.FromSlash(item.RelativePath))
	var linked []string
	for _, pair := range ruleModeDirs {
		if symlinkResolvesTo(filepath.Join(ruleModeTarget(projectRoot, pair.mode), filepath.FromSlash(item.RelativePath)), source) {
			linked = append(linked, pair.mode)
		}
	}
	if len(linked) == 1 {
		return linked[0], true
	}
	return "", false
}

// initialRuleModes is initial_rule_modes().
func (a *app) initialRuleModes(projectRoot string, items []ManagedItem) map[ManagedItem]string {
	modes := map[ManagedItem]string{}
	for _, item := range items {
		if item.Kind != "rule" {
			continue
		}
		if mode, ok := a.ruleLinkMode(projectRoot, item); ok {
			modes[item] = mode
		} else {
			modes[item] = a.ruleDefaultMode(item)
		}
	}
	return modes
}

// toggleRuleMode is toggle_rule_mode(): it mutates modes and returns the
// message the picker shows.
func (a *app) toggleRuleMode(item ManagedItem, modes map[ManagedItem]string) string {
	name := item.displayName()
	if item.Kind != "rule" {
		return "Skills are always routed; m applies to rules only."
	}
	if a.modeFor(item, modes) == routedMode {
		modes[item] = alwaysMode
		return name + ": always (Enter applies)"
	}
	if !a.ruleHasDescription(item) {
		return name + ": always only, no description: frontmatter"
	}
	modes[item] = routedMode
	return name + ": routed (Enter applies)"
}
