#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
import select
import re
import shutil
import sys
import termios
import tty
import unicodedata
from pathlib import Path

RULE_SOURCE_ROOT = Path("~/.agents/rules-optional").expanduser().resolve()
SKILL_SOURCE_ROOT = Path("/home/easydev/.agents/skills-optional").expanduser().resolve()
HELP_TEXT = (
    "Inline selector | Arrow keys/jk move | Space toggle | a toggle all | "
    "m mode always/routed | Enter confirm | q quit"
)
RULE_SUFFIXES = (".md",)
ALWAYS_MODE = "always"
ROUTED_MODE = "routed"
RULE_MODE_DIRS = {ALWAYS_MODE: "rules", ROUTED_MODE: "rules-routed"}
EXCLUSIVE_PREFIXES = ("stack-",)
CHECKED_MARKER = "[✓]"
UNCHECKED_MARKER = "[ ]"
ACTIVE_MARKER = "›"
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
RED = "\033[31m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"


@dataclass(frozen=True)
class ManagedItem:
    kind: str
    relative_path: Path


def resolve_project_root(argv: list[str]) -> Path:
    if len(argv) == 2 and argv[1] in {"-h", "--help"}:
        print(f"Usage: {Path(argv[0]).name} [PROJECT_PATH]")
        raise SystemExit(0)
    if len(argv) > 2:
        raise SystemExit(f"Usage: {Path(argv[0]).name} [PROJECT_PATH]")
    project_root = (
        Path(argv[1]).expanduser().resolve() if len(argv) == 2 else Path.cwd().resolve()
    )
    if not project_root.exists():
        raise SystemExit(f"Project path does not exist: {project_root}")
    return project_root


def source_root_for(item: ManagedItem) -> Path:
    return RULE_SOURCE_ROOT if item.kind == "rule" else SKILL_SOURCE_ROOT


@lru_cache(maxsize=None)
def rule_frontmatter(item: ManagedItem) -> tuple[str, ...]:
    lines = (RULE_SOURCE_ROOT / item.relative_path).read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].rstrip() != "---":
        return ()
    frontmatter: list[str] = []
    for line in lines[1:]:
        if line.rstrip() == "---":
            return tuple(frontmatter)
        frontmatter.append(line)
    return ()


def rule_has_description(item: ManagedItem) -> bool:
    return any(line.startswith("description:") for line in rule_frontmatter(item))


def rule_load_override(item: ManagedItem) -> str | None:
    for line in rule_frontmatter(item):
        if line.startswith("load:"):
            value = line.split(":", 1)[1].strip().strip("\"'").lower()
            if value in RULE_MODE_DIRS:
                return value
    return None


def rule_default_mode(item: ManagedItem) -> str:
    # `load: always|routed` overrides the default; a rule without `description:` stays
    # always, because the routed classifier keys on that description.
    if not rule_has_description(item):
        return ALWAYS_MODE
    return rule_load_override(item) or ROUTED_MODE


def rule_is_routed(item: ManagedItem) -> bool:
    # A rule with `description:` frontmatter is injected per prompt from rules-routed/;
    # any other rule (`paths:` glob or none) goes to rules/, which every harness loads.
    # `load: always|routed` overrides that default, and `load: routed` only counts when
    # the rule has a `description:` (the routed classifier needs it).
    return rule_default_mode(item) == ROUTED_MODE


def rule_mode_targets(project_root: Path) -> dict[str, Path]:
    return {
        mode: project_root / ".agents" / dirname
        for mode, dirname in RULE_MODE_DIRS.items()
    }


def target_root_for(
    project_root: Path,
    item: ManagedItem,
    modes: dict[ManagedItem, str] | None = None,
) -> Path:
    # An opt-in skill is routed for that project only: find_skill reads
    # <project>/.agents/skills-routed/{<name>,<category>/<name>}. A rule goes to the
    # directory of its mode, which the user can switch per rule with `m`.
    if item.kind == "skill":
        return project_root / ".agents" / "skills-routed"
    mode = mode_for(item, modes)
    return rule_mode_targets(project_root)[mode]


def mode_for(item: ManagedItem, modes: dict[ManagedItem, str] | None = None) -> str:
    return (modes or {}).get(item) or (
        ROUTED_MODE if rule_is_routed(item) else ALWAYS_MODE
    )


def other_rule_root(
    project_root: Path,
    item: ManagedItem,
    modes: dict[ManagedItem, str] | None = None,
) -> Path:
    other = ALWAYS_MODE if mode_for(item, modes) == ROUTED_MODE else ROUTED_MODE
    return rule_mode_targets(project_root)[other]


def stale_link_paths(
    project_root: Path,
    item: ManagedItem,
    modes: dict[ManagedItem, str] | None = None,
) -> list[Path]:
    # The same rule linked in the other directory is stale: apply moves the link.
    if item.kind != "rule":
        return []
    return [other_rule_root(project_root, item, modes) / item.relative_path]


def rule_link_mode(project_root: Path, item: ManagedItem) -> str | None:
    source_path = source_root_for(item) / item.relative_path
    linked = [
        mode
        for mode, root in rule_mode_targets(project_root).items()
        if symlink_resolves_to(root / item.relative_path, source_path)
    ]
    return linked[0] if len(linked) == 1 else None


def initial_rule_modes(
    project_root: Path, items: list[ManagedItem]
) -> dict[ManagedItem, str]:
    # An existing link keeps its directory as the mode; otherwise the frontmatter default.
    modes: dict[ManagedItem, str] = {}
    for item in items:
        if item.kind != "rule":
            continue
        modes[item] = rule_link_mode(project_root, item) or rule_default_mode(item)
    return modes


def toggle_rule_mode(item: ManagedItem, modes: dict[ManagedItem, str]) -> str:
    name = display_name_for(item)
    if item.kind != "rule":
        return "Skills are always routed; m applies to rules only."
    if mode_for(item, modes) == ROUTED_MODE:
        modes[item] = ALWAYS_MODE
        return f"{name}: always (Enter applies)"
    if not rule_has_description(item):
        return f"{name}: always only, no description: frontmatter"
    modes[item] = ROUTED_MODE
    return f"{name}: routed (Enter applies)"


def display_name_for(item: ManagedItem) -> str:
    if item.kind == "rule":
        return item.relative_path.name.removesuffix(".md")
    return item.relative_path.name


def list_rule_items() -> list[ManagedItem]:
    if not RULE_SOURCE_ROOT.is_dir():
        raise SystemExit(f"Source directory does not exist: {RULE_SOURCE_ROOT}")
    items = sorted(
        (
            ManagedItem("rule", path.relative_to(RULE_SOURCE_ROOT))
            for path in RULE_SOURCE_ROOT.rglob("*")
            if path.is_file() and path.suffix in RULE_SUFFIXES
        ),
        key=lambda item: item.relative_path.as_posix(),
    )
    if not items:
        raise SystemExit(f"No rule files found in: {RULE_SOURCE_ROOT}")
    return items


def list_skill_items() -> list[ManagedItem]:
    # ~/.agents/skills-optional holds skills only some projects want (`writing/write-doc`); the
    # category folder is kept in the link so the project's skills-routed reads it the same way.
    if not SKILL_SOURCE_ROOT.is_dir():
        return []
    skill_dirs = sorted(
        {
            skill_file.parent.relative_to(SKILL_SOURCE_ROOT)
            for skill_file in SKILL_SOURCE_ROOT.rglob("SKILL.md")
        },
        key=lambda relative_path: relative_path.as_posix(),
    )
    return [ManagedItem("skill", relative_path) for relative_path in skill_dirs]


def list_instruction_items() -> list[ManagedItem]:
    return [*list_rule_items(), *list_skill_items()]


def build_selection(
    project_root: Path,
    items: list[ManagedItem],
    modes: dict[ManagedItem, str] | None = None,
) -> dict[ManagedItem, bool]:
    selection: dict[ManagedItem, bool] = {}
    for item in items:
        state, _ = inspect_destination_state(
            target_root_for(project_root, item, modes), item
        )
        selection[item] = state == "linked"
    return selection


def inspect_states(
    project_root: Path,
    items: list[ManagedItem],
    modes: dict[ManagedItem, str] | None = None,
) -> dict[ManagedItem, tuple[str, str]]:
    return {
        item: inspect_destination_state(
            target_root_for(project_root, item, modes), item
        )
        for item in items
    }


def color_enabled() -> bool:
    return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def paint(text: str, *styles: str) -> str:
    if not styles or not color_enabled():
        return text
    return f"{''.join(styles)}{text}{RESET}"


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text)


def cell_width(char: str) -> int:
    if unicodedata.combining(char):
        return 0
    category = unicodedata.category(char)
    if category in {"Mn", "Me", "Cf"}:
        return 0
    if unicodedata.east_asian_width(char) in {"W", "F"}:
        return 2
    return 1


def visible_width(text: str) -> int:
    return sum(cell_width(char) for char in strip_ansi(text))



def skill_group_key(item: ManagedItem) -> str | None:
    if item.kind != "skill":
        return None
    parts = item.relative_path.parts
    if len(parts) >= 2 and parts[0].startswith("_") and len(parts[0]) > 1:
        return parts[0]
    return None


def skill_group_label(group_key: str) -> str:
    return group_key[1:]


def iter_skill_sections(items: list[ManagedItem]) -> list[tuple[str, list[ManagedItem]]]:
    ungrouped: list[ManagedItem] = []
    grouped: dict[str, list[ManagedItem]] = {}
    for item in items:
        if item.kind != "skill":
            continue
        key = skill_group_key(item)
        if key is None:
            ungrouped.append(item)
        else:
            grouped.setdefault(key, []).append(item)
    sections: list[tuple[str, list[ManagedItem]]] = []
    if ungrouped:
        sections.append(("Skills", ungrouped))
    for key in sorted(grouped):
        sections.append((f"Skills / {skill_group_label(key)}", grouped[key]))
    return sections


def group_instruction_items(items: list[ManagedItem]) -> list[ManagedItem]:
    general_items = [
        item
        for item in items
        if item.kind == "rule" and exclusive_group_key(item) is None
    ]
    stack_items = [
        item
        for item in items
        if item.kind == "rule" and exclusive_group_key(item) is not None
    ]
    skill_items = [
        item
        for _, section_items in iter_skill_sections(items)
        for item in section_items
    ]
    return [*general_items, *stack_items, *skill_items]


def exclusive_group_key(item: ManagedItem) -> str | None:
    if item.kind != "rule":
        return None
    stem = item.relative_path.name.removesuffix(".md")
    for prefix in EXCLUSIVE_PREFIXES:
        if stem.startswith(prefix):
            return prefix
    return None


def normalize_selection(
    selection: dict[ManagedItem, bool],
    items: list[ManagedItem],
    states: dict[ManagedItem, tuple[str, str]],
    preferred_item: ManagedItem | None = None,
) -> None:
    groups: dict[str, list[ManagedItem]] = {}
    for item in items:
        group_key = exclusive_group_key(item)
        if group_key is None:
            continue
        groups.setdefault(group_key, []).append(item)

    for group_items in groups.values():
        selected_items = [item for item in group_items if selection[item]]
        if len(selected_items) <= 1:
            continue

        if preferred_item in selected_items:
            keep_item = preferred_item
        else:
            keep_item = next(
                (item for item in selected_items if states[item][0] == "linked"),
                None,
            )
            if keep_item is None:
                keep_item = next(
                    (item for item in selected_items if states[item][0] == "relink"),
                    None,
                )

        for item in group_items:
            selection[item] = item == keep_item if keep_item is not None else False


def build_display_entries(
    items: list[ManagedItem],
) -> tuple[list[tuple[str, str | ManagedItem]], dict[ManagedItem, int]]:
    entries: list[tuple[str, str | ManagedItem]] = []
    item_display_index: dict[ManagedItem, int] = {}

    grouped_sections: list[tuple[str, list[ManagedItem]]] = [
        (
            "General",
            [
                item
                for item in items
                if item.kind == "rule" and exclusive_group_key(item) is None
            ],
        ),
        (
            "Stack",
            [
                item
                for item in items
                if item.kind == "rule" and exclusive_group_key(item) is not None
            ],
        ),
        *iter_skill_sections(items),
    ]

    for section_label, section_items in grouped_sections:
        if not section_items:
            continue
        entries.append(("spacer", ""))
        entries.append(("section", f"{section_label} ({len(section_items)})"))
        entries.append(("spacer", ""))
        for item in section_items:
            item_display_index[item] = len(entries)
            entries.append(("item", item))

    return entries, item_display_index


def fit_to_width(text: str, width: int) -> str:
    if width <= 0:
        return ""
    if visible_width(text) <= width:
        return text
    if width == 1:
        return "…"

    limit = width - 1
    parts: list[str] = []
    visible = 0
    position = 0

    for match in ANSI_RE.finditer(text):
        if match.start() > position and visible < limit:
            chunk = text[position : match.start()]
            chunk_text, chunk_width = trim_to_width(chunk, limit - visible)
            parts.append(chunk_text)
            visible += chunk_width
            if visible >= limit:
                break
        parts.append(match.group(0))
        position = match.end()

    if visible < limit and position < len(text):
        chunk = text[position:]
        chunk_text, chunk_width = trim_to_width(chunk, limit - visible)
        parts.append(chunk_text)
        visible += chunk_width

    parts.append("…")
    if ANSI_RE.search(text):
        parts.append(RESET)
    return "".join(parts)


def trim_to_width(text: str, width: int) -> tuple[str, int]:
    if width <= 0:
        return "", 0
    output: list[str] = []
    visible = 0
    for char in text:
        char_width = cell_width(char)
        if visible + char_width > width:
            break
        output.append(char)
        visible += char_width
    return "".join(output), visible


def inspect_destination_state(target_root: Path, item: ManagedItem) -> tuple[str, str]:
    destination = target_root / item.relative_path
    source_path = source_root_for(item) / item.relative_path

    for ancestor in destination_ancestors(target_root, item.relative_path):
        blocking = first_blocking_path(ancestor)
        if blocking is not None:
            anchor = (
                target_root.parent if ancestor == target_root.parent else target_root
            )
            return "conflict", f"blocked by {describe_blocking_path(blocking, anchor)}"

    if destination.is_symlink():
        if symlink_resolves_to(destination, source_path):
            return "linked", "already linked"
        return "relink", "different symlink target"

    if destination.exists():
        return "conflict", "existing path"

    return "missing", "not present"


def marker_style(selected: bool, state: str) -> str:
    if state == "conflict":
        return RED if selected else DIM
    if state in {"linked", "relink"}:
        return GREEN if selected else CYAN
    return GREEN if selected else DIM


def planned_action(selected: bool, state: str) -> str | None:
    if state == "conflict":
        return "[!]"
    if selected:
        if state == "linked":
            return "[=]"
        if state == "relink":
            return "[~]"
        if state == "missing":
            return "[+]"
    elif state == "linked":
        return "[-]"
    return None


def action_style(action: str) -> str:
    if action == "[=]":
        return GREEN
    if action == "[+]":
        return CYAN
    if action in {"[-]", "[~]"}:
        return YELLOW
    return RED


def first_blocking_path(path: Path) -> Path | None:
    if path.is_symlink() and not path.exists():
        return path
    if path.exists() and not path.is_dir():
        return path
    return None


def path_is_broken_symlink(path: Path) -> bool:
    return path.is_symlink() and not path.exists()


def describe_blocking_path(blocking: Path, anchor: Path) -> str:
    try:
        relative = blocking.relative_to(anchor)
    except ValueError:
        return blocking.as_posix()
    return anchor.name if relative == Path(".") else relative.as_posix()


def destination_ancestors(target_root: Path, item: Path) -> list[Path]:
    ancestors: list[Path] = [target_root.parent, target_root]
    current = target_root
    for part in item.parts[:-1]:
        current = current / part
        ancestors.append(current)
    return ancestors


def summarize_states(states: dict[ManagedItem, tuple[str, str]]) -> str:
    counts: dict[str, int] = {"linked": 0, "relink": 0, "conflict": 0}
    for state, _ in states.values():
        if state in counts:
            counts[state] += 1
    return " | ".join(
        [
            paint(f"Linked {counts['linked']}", GREEN),
            paint(f"Relink {counts['relink']}", YELLOW),
            paint(f"Conflict {counts['conflict']}", RED),
        ]
    )


def render_lines(
    project_root: Path,
    items: list[ManagedItem],
    selection: dict[ManagedItem, bool],
    modes: dict[ManagedItem, str],
    current_index: int,
    offset: int,
    message: str,
) -> tuple[list[str], int]:
    terminal_size = shutil.get_terminal_size((100, 24))
    display_entries, item_display_index = build_display_entries(items)
    current_item = items[current_index]
    current_display_index = item_display_index[current_item]
    states = inspect_states(project_root, items, modes)
    selected_conflicts = sum(
        1 for item in items if selection[item] and states[item][0] == "conflict"
    )
    selected_linked = sum(
        1 for item in items if selection[item] and states[item][0] == "linked"
    )
    selected_relink = sum(
        1 for item in items if selection[item] and states[item][0] == "relink"
    )
    header_lines = [
        paint(f"Rule source: {RULE_SOURCE_ROOT}", BOLD, BLUE),
        paint(f"Skill source: {SKILL_SOURCE_ROOT}", BOLD, BLUE),
        paint(f"Rule target: {project_root / '.agents'}/{{rules,rules-routed}}", BOLD, BLUE),
        paint(f"Skill target: {project_root / '.agents' / 'skills-routed'}", BOLD, BLUE),
        paint(HELP_TEXT, DIM),
        paint(
            f"Selected: {sum(selection.values())}/{len(items)} | {summarize_states(states)}",
            BOLD,
        ),
        paint(
            f"Ready: {selected_linked} linked | {selected_relink} relink | {selected_conflicts} conflict",
            RED if selected_conflicts else DIM,
        ),
    ]
    list_height = max(1, terminal_size.lines - len(header_lines) - 1)
    if current_display_index < offset:
        offset = current_display_index
    elif current_display_index >= offset + list_height:
        offset = current_display_index - list_height + 1

    lines = list(header_lines)
    for entry_kind, value in display_entries[offset : offset + list_height]:
        if entry_kind == "spacer":
            lines.append("")
            continue
        if entry_kind == "section":
            section_label = str(value)
            section_color = (
                MAGENTA
                if section_label.startswith("General")
                else CYAN
                if section_label.startswith("Stack")
                else BLUE
            )
            lines.append(paint(f"  {section_label}", BOLD, section_color))
            continue

        item = value
        prefix = ACTIVE_MARKER if item == current_item else " "
        marker = CHECKED_MARKER if selection[item] else UNCHECKED_MARKER
        state, detail = states[item]
        marker_color = marker_style(selection[item], state)
        item_text = display_name_for(item)
        action = planned_action(selection[item], state)
        status_parts: list[str] = []
        if item.kind == "rule":
            mode = modes.get(item, ALWAYS_MODE)
            status_parts.append(paint(mode, MAGENTA if mode == ROUTED_MODE else BLUE))
            if not rule_has_description(item):
                note = "no description" if mode == ROUTED_MODE else "always only"
                status_parts.append(paint(f"({note})", DIM))
        if action is not None:
            status_parts.append(paint(action, action_style(action)))
            if state in {"conflict", "relink"} and detail:
                status_parts.append(paint(f"({detail})", DIM))
        status_text = f" {' '.join(status_parts)}" if status_parts else ""
        line = f"{paint(prefix, BOLD, CYAN) if item == current_item else ' '} {paint(marker, marker_color)} {item_text}{status_text}"
        if item == current_item:
            line = paint(line, BOLD)
        lines.append(line)
    lines.append(message)
    return lines, offset


def draw_lines(lines: list[str], previous_line_count: int) -> int:
    width = shutil.get_terminal_size((100, 24)).columns
    total_lines = max(previous_line_count, len(lines))
    if previous_line_count > 1:
        sys.stdout.write(f"\033[{previous_line_count - 1}F")
    elif previous_line_count == 1:
        sys.stdout.write("\r")

    for line_index in range(total_lines):
        sys.stdout.write("\r\033[2K")
        if line_index < len(lines):
            sys.stdout.write(fit_to_width(lines[line_index], max(1, width - 1)))
        if line_index < total_lines - 1:
            sys.stdout.write("\n")
    sys.stdout.flush()
    return total_lines


def read_key(file_descriptor: int) -> str | None:
    first = os.read(file_descriptor, 1)
    if not first:
        return "QUIT"
    if first == b"\x03":
        return "QUIT"
    if first in (b"\r", b"\n"):
        return "ENTER"
    if first == b" ":
        return "TOGGLE"
    if first in (b"a", b"A"):
        return "TOGGLE_ALL"
    if first in (b"m", b"M"):
        return "TOGGLE_MODE"
    if first in (b"q", b"Q"):
        return "QUIT"
    if first in (b"j", b"J"):
        return "DOWN"
    if first in (b"k", b"K"):
        return "UP"
    if first == b"\x1b":
        sequence = b""
        while True:
            ready, _, _ = select.select([file_descriptor], [], [], 0.01)
            if not ready:
                break
            sequence += os.read(file_descriptor, 1)
        if sequence in (b"[A", b"OA"):
            return "UP"
        if sequence in (b"[B", b"OB"):
            return "DOWN"
        return "QUIT"
    return None


def choose_files(
    project_root: Path,
    items: list[ManagedItem],
    selection: dict[ManagedItem, bool],
    modes: dict[ManagedItem, str],
) -> list[ManagedItem] | None:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise SystemExit("This script must run in an interactive terminal.")

    file_descriptor = sys.stdin.fileno()
    previous_line_count = 0
    current_index = 0
    offset = 0
    message = "Press Enter to apply the current selection."
    result: list[ManagedItem] | None = None
    original_settings = termios.tcgetattr(file_descriptor)

    states = inspect_states(project_root, items, modes)

    normalize_selection(selection, items, states)
    for item in items:
        if states[item][0] == "conflict":
            selection[item] = False

    sys.stdout.write("\033[?25l")
    sys.stdout.flush()
    try:
        tty.setraw(file_descriptor)
        while True:
            lines, offset = render_lines(
                project_root, items, selection, modes, current_index, offset, message
            )
            previous_line_count = draw_lines(lines, previous_line_count)
            action = read_key(file_descriptor)
            if action == "UP":
                current_index = max(0, current_index - 1)
            elif action == "DOWN":
                current_index = min(len(items) - 1, current_index + 1)
            elif action == "TOGGLE":
                item = items[current_index]
                selection[item] = not selection[item]
                if selection[item]:
                    normalize_selection(selection, items, states, item)
            elif action == "TOGGLE_MODE":
                item = items[current_index]
                previous_mode = modes.get(item)
                message = toggle_rule_mode(item, modes)
                if modes.get(item) != previous_mode:
                    states = inspect_states(project_root, items, modes)
                    if not selection[item]:
                        selection[item] = True
                    normalize_selection(selection, items, states, item)
                continue
            elif action == "TOGGLE_ALL":
                new_value = not all(selection.values())
                for item in items:
                    selection[item] = new_value
                normalize_selection(selection, items, states)
            elif action == "ENTER":
                result = [item for item in items if selection[item]]
                break
            elif action == "QUIT":
                break
            else:
                message = "Use arrows/jk, Space, a, m, Enter, or q."
                continue
            message = "Press Enter to apply the current selection."
    finally:
        termios.tcsetattr(file_descriptor, termios.TCSADRAIN, original_settings)
        sys.stdout.write("\033[?25h\n")
        sys.stdout.flush()

    return result


def symlink_resolves_to(link_path: Path, source_path: Path) -> bool:
    if not link_path.is_symlink():
        return False
    link_target = os.readlink(link_path)
    target_path = Path(link_target)
    if not target_path.is_absolute():
        target_path = (link_path.parent / target_path).resolve()
    else:
        target_path = target_path.resolve()
    return target_path == source_path.resolve()


def collect_conflicts(
    project_root: Path,
    selected_items: set[ManagedItem],
    modes: dict[ManagedItem, str] | None = None,
) -> list[Path]:
    conflicts: list[Path] = []
    for item in selected_items:
        target_root = target_root_for(project_root, item, modes)
        for ancestor in destination_ancestors(target_root, item.relative_path):
            blocking = first_blocking_path(ancestor)
            if blocking is not None:
                conflicts.append(blocking)
                break
        destination = target_root / item.relative_path
        if not destination.is_symlink() and destination.exists():
            conflicts.append(destination)
    return conflicts


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    if path.is_dir():
        shutil.rmtree(path)


def apply_selection(
    project_root: Path,
    items: list[ManagedItem],
    selected_items: set[ManagedItem],
    modes: dict[ManagedItem, str] | None = None,
) -> tuple[
    list[ManagedItem], list[ManagedItem], list[ManagedItem], list[ManagedItem]
]:
    agents_dir = project_root / ".agents"
    if path_is_broken_symlink(agents_dir) or (
        agents_dir.exists() and not agents_dir.is_dir()
    ):
        raise SystemExit(f"Target path exists and is not a directory: {agents_dir}")
    conflicts = collect_conflicts(project_root, selected_items, modes)
    if conflicts:
        unique_conflicts = sorted(
            set(conflicts),
            key=lambda path: path.as_posix(),
        )
        conflict_lines = "\n".join(f"- {path}" for path in unique_conflicts)
        raise SystemExit(
            f"Refusing to overwrite existing non-symlink paths:\n{conflict_lines}"
        )

    linked: list[ManagedItem] = []
    moved: list[ManagedItem] = []
    removed: list[ManagedItem] = []
    unchanged: list[ManagedItem] = []

    for item in items:
        if item not in selected_items:
            continue
        source_path = source_root_for(item) / item.relative_path
        destination = target_root_for(project_root, item, modes) / item.relative_path
        created = False
        if destination.is_symlink() and not symlink_resolves_to(destination, source_path):
            destination.unlink()
        elif destination.exists() and not destination.is_symlink():
            raise SystemExit(
                f"Refusing to overwrite existing non-symlink path: {destination}"
            )
        if not destination.is_symlink():
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.symlink_to(source_path)
            created = True
        stale_removed = False
        for stale in stale_link_paths(project_root, item, modes):
            if stale == destination:
                continue
            if stale.is_symlink() and symlink_resolves_to(stale, source_path):
                remove_path(stale)
                stale_removed = True
        if stale_removed:
            moved.append(item)
        elif created:
            linked.append(item)
        else:
            unchanged.append(item)

    for item in items:
        if item in selected_items:
            continue
        source_path = source_root_for(item) / item.relative_path
        destinations = [
            target_root_for(project_root, item, modes) / item.relative_path,
            *stale_link_paths(project_root, item, modes),
        ]
        for destination in dict.fromkeys(destinations):
            if destination.is_symlink() and symlink_resolves_to(destination, source_path):
                remove_path(destination)
                if item not in removed:
                    removed.append(item)

    return linked, moved, removed, unchanged


def print_summary(
    project_root: Path,
    linked: list[ManagedItem],
    moved: list[ManagedItem],
    removed: list[ManagedItem],
    unchanged: list[ManagedItem],
) -> None:
    print(paint(f"Target project: {project_root}", BOLD, BLUE))
    print(paint(f"Rule source: {RULE_SOURCE_ROOT}", BOLD, BLUE))
    print(paint(f"Skill source: {SKILL_SOURCE_ROOT}", BOLD, BLUE))
    print(
        paint(
            f"Linked: {len(linked)} | Moved: {len(moved)} | "
            f"Removed: {len(removed)} | Unchanged: {len(unchanged)}",
            BOLD,
        )
    )
    for label, values, style in (
        ("Linked", linked, MAGENTA),
        ("Moved", moved, GREEN),
        ("Removed", removed, CYAN),
        ("Unchanged", unchanged, DIM),
    ):
        if not values:
            continue
        print(paint(f"{label}:", BOLD, style))
        for value in values:
            print(f"  - {value.kind}: {display_name_for(value)}")


def main(argv: list[str]) -> int:
    project_root = resolve_project_root(argv)
    items = group_instruction_items(list_instruction_items())
    modes = initial_rule_modes(project_root, items)
    selection = build_selection(project_root, items, modes)
    chosen = choose_files(project_root, items, selection, modes)
    if chosen is None:
        print("Cancelled.")
        return 130

    linked, moved, removed, unchanged = apply_selection(
        project_root, items, set(chosen), modes
    )
    print_summary(project_root, linked, moved, removed, unchanged)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
