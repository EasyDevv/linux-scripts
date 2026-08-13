#!/usr/bin/env python3
from __future__ import annotations

import fcntl
import json
import os
import re
import select
import shutil
import sys
import tempfile
import termios
import textwrap
import tty
import unicodedata
from pathlib import Path
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_FILE = Path(
    os.environ.get(
        "OPENCODE_CONFIG", str(Path.home() / ".config" / "opencode" / "opencode.jsonc")
    )
).expanduser()
PRESETS_FILE = Path(
    os.environ.get(
        "OPENCODE_SWAP_PRESETS", str(SCRIPT_DIR / "swap-opencode.presets.jsonc")
    )
).expanduser()
LOCK_FILE = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "swap-opencode.lock"
BUILTIN_AGENTS = ("title", "compaction", "plan", "build", "general", "explore")
JSON_SUFFIXES = (".json", ".jsonc")
ACTIVE_MARKER = ">"
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
WHITE = "\033[37m"
HELP_TEXT_MENU = "Inline selector | Arrow keys/jk move | Enter confirm | q quit"
HELP_TEXT_CONFLICT = "Inline selector | Arrow keys/jk move | Space toggle target | Enter confirm | q quit"


def supports_color() -> bool:
    return sys.stdout.isatty()


def paint(text: str, *styles: str) -> str:
    if not styles or not supports_color():
        return text
    return f"{''.join(styles)}{text}{RESET}"


def style(text: str, code: str) -> str:
    if not supports_color():
        return text
    return f"\033[{code}m{text}\033[0m"


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


def fit_to_width(text: str, width: int) -> str:
    if width <= 0:
        return ""
    if visible_width(text) <= width:
        return text
    if width == 1:
        return "."

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

    parts.append(".")
    if ANSI_RE.search(text):
        parts.append(RESET)
    return "".join(parts)


def pad_visible(text: str, width: int) -> str:
    if width <= 0:
        return ""
    fitted = fit_to_width(text, width)
    padding = max(0, width - visible_width(fitted))
    return f"{fitted}{' ' * padding}"


def wrap_plain_to_width(text: str, width: int) -> list[str]:
    if width <= 0:
        return [""]
    if not text:
        return [""]

    parts: list[str] = []
    remaining = text
    while remaining:
        chunk, chunk_width = trim_to_width(remaining, width)
        if not chunk or chunk_width <= 0:
            break
        parts.append(chunk)
        remaining = remaining[len(chunk) :]
    return parts or [""]


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


def terminal_width(default: int = 88) -> int:
    if not sys.stdout.isatty():
        return default
    return max(60, shutil.get_terminal_size(fallback=(default, 24)).columns)


def wrap_text(
    text: str, width: int, *, indent: str = "", subsequent_indent: str | None = None
) -> str:
    wrapped = textwrap.fill(
        text,
        width=width,
        initial_indent=indent,
        subsequent_indent=subsequent_indent
        if subsequent_indent is not None
        else indent,
        break_long_words=False,
        break_on_hyphens=False,
    )
    return wrapped


def print_wrapped_line(label: str, value: str, *, label_style: str = "1;36") -> None:
    width = terminal_width()
    prefix = f"{style(label, label_style)}: "
    value_width = max(20, width - len(label) - 2)
    print(
        wrap_text(
            value, value_width, indent=prefix, subsequent_indent=" " * len(label) + ": "
        )
    )


def print_wrapped_block(lines: list[str]) -> None:
    width = terminal_width()
    for line in lines:
        print(wrap_text(line, width))


def natural_sort_key(value: str) -> tuple[int, Any]:
    return (0, int(value)) if value.isdigit() else (1, value)


def profile_tier_items(profile: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    tiers = profile.get("tiers", {})
    if not isinstance(tiers, dict):
        raise SystemExit("Error: invalid profile tiers format.")
    return sorted(tiers.items(), key=lambda item: tier_sort_key(item[0]))


def tier_sort_key(value: str) -> tuple[int, Any]:
    order = {
        "max": 0,
        "plus": 1,
        "large": 1,
        "core": 2,
        "medium": 2,
        "lite": 3,
        "small": 3,
        "mini": 4,
    }
    return (order.get(value, 100), natural_sort_key(value))


def usage() -> None:
    print_wrapped_block(
        [
            "Usage:",
            "  swap-opencode",
            "  swap-opencode status",
            "  swap-opencode list",
            "  swap-opencode <profile-id>",
            "",
            "Interactive TTY mode shows an arrow-key menu when no arguments are given.",
            "Use list to inspect the available profiles and their tiers.",
            "",
            "Environment:",
            "  OPENCODE_CONFIG         Override config file path",
            "  OPENCODE_SWAP_PRESETS   Override preset file path",
        ]
    )


def strip_jsonc_comments(text: str) -> str:
    output: list[str] = []
    in_string = False
    quote = ""
    escaped = False
    index = 0

    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""

        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                in_string = False
            index += 1
            continue

        if char in {'"', "'"}:
            in_string = True
            quote = char
            output.append(char)
            index += 1
            continue

        if char == "/" and next_char == "/":
            index += 2
            while index < len(text) and text[index] not in "\r\n":
                index += 1
            continue

        if char == "/" and next_char == "*":
            index += 2
            while index + 1 < len(text):
                if text[index] == "*" and text[index + 1] == "/":
                    index += 2
                    break
                index += 1
            else:
                index = len(text)
            continue

        output.append(char)
        index += 1

    return "".join(output)


def strip_jsonc_trailing_commas(text: str) -> str:
    output: list[str] = []
    in_string = False
    quote = ""
    escaped = False
    index = 0

    while index < len(text):
        char = text[index]

        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                in_string = False
            index += 1
            continue

        if char in {'"', "'"}:
            in_string = True
            quote = char
            output.append(char)
            index += 1
            continue

        if char == ",":
            lookahead = index + 1
            while lookahead < len(text) and text[lookahead].isspace():
                lookahead += 1
            if lookahead < len(text) and text[lookahead] in {"]", "}"}:
                index += 1
                continue

        output.append(char)
        index += 1

    return "".join(output)


def load_json(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    return json.loads(strip_jsonc_trailing_commas(strip_jsonc_comments(text)))


def reorder_for_write(value: Any, path: tuple[str, ...] = ()) -> Any:
    if isinstance(value, dict):
        items = list(value.items())
        if path == ("agent",):
            items = [item for item in items if item[0] not in BUILTIN_AGENTS] + [
                (name, value[name]) for name in BUILTIN_AGENTS if name in value
            ]
        elif path in {
            ("bindings", "agent"),
            ("bindings", "global"),
            ("bindings", "command"),
        }:
            items = sorted(items, key=lambda item: tier_sort_key(item[0]))
        return {key: reorder_for_write(child, (*path, key)) for key, child in items}
    if isinstance(value, list):
        return [reorder_for_write(item, path) for item in value]
    return value


def insert_builtin_agents_comment(text: str) -> str:
    lines = text.splitlines()
    updated: list[str] = []
    in_agent_block = False
    custom_inserted = False
    inserted = False

    for line in lines:
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        if not in_agent_block and line == '  "agent": {':
            in_agent_block = True
            inserted = False
            custom_inserted = False
            updated.append(line)
            continue

        if in_agent_block and not custom_inserted and indent == 4:
            updated.append("    /*")
            updated.append("     * custom agents")
            updated.append("     * keep project-specific agents together")
            updated.append("     */")
            custom_inserted = True

        if (
            in_agent_block
            and not inserted
            and indent == 4
            and any(stripped.startswith(f'"{name}":') for name in BUILTIN_AGENTS)
        ):
            updated.append("    /*")
            updated.append("     * builtin agents")
            updated.append("     * keep these agents at the end")
            updated.append("     */")
            inserted = True

        updated.append(line)

        if in_agent_block and indent == 2 and stripped in {"}", "},"}:
            in_agent_block = False

    return "\n".join(updated) + "\n"


def dump_config(path: Path, data: dict[str, Any]) -> str:
    ordered = reorder_for_write(data)
    text = json.dumps(ordered, indent=2, ensure_ascii=False)
    if path.suffix == ".jsonc":
        return insert_builtin_agents_comment(text)
    return text + "\n"


def resolve_supported_path(path: Path, label: str) -> Path:
    expanded = path.expanduser()
    candidates = [expanded]
    if expanded.suffix in JSON_SUFFIXES:
        candidates.append(
            expanded.with_suffix(
                JSON_SUFFIXES[1]
                if expanded.suffix == JSON_SUFFIXES[0]
                else JSON_SUFFIXES[0]
            )
        )
    else:
        candidates.extend(expanded.with_suffix(suffix) for suffix in JSON_SUFFIXES)

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.exists() and candidate.is_file():
            abs_path = Path(os.path.abspath(candidate))
            real_path = candidate.resolve(strict=False)
            if abs_path != real_path:
                raise SystemExit(
                    f"Error: symlinked path is unsupported for swap-opencode: {candidate}"
                )
            return real_path

    raise SystemExit(f"Error: could not find {label} file: {path}")


def require_file(path: Path, label: str) -> None:
    if not path.exists() or not path.is_file():
        raise SystemExit(f"Error: could not find {label} file: {path}")


def get_path(data: Any, keys: list[Any]) -> Any:
    current = data
    for key in keys:
        current = current[key]
    return current


def set_path(data: Any, keys: list[Any], value: Any) -> None:
    current: Any = data
    for key in keys[:-1]:
        if isinstance(current, list):
            current = current[key]
            continue
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    if isinstance(current, list):
        current[keys[-1]] = value
        return
    current[keys[-1]] = value


def has_path(data: Any, keys: list[Any]) -> bool:
    try:
        get_path(data, keys)
    except (KeyError, TypeError, IndexError):
        return False
    return True


def remove_path(data: Any, keys: list[Any]) -> bool:
    current: Any = data
    for key in keys[:-1]:
        if isinstance(current, list):
            if not isinstance(key, int) or key >= len(current):
                return False
            current = current[key]
            continue
        if key not in current or not isinstance(current[key], (dict, list)):
            return False
        current = current[key]
    if isinstance(current, list):
        key = keys[-1]
        if not isinstance(key, int) or key >= len(current):
            return False
        del current[key]
        return True
    if keys[-1] not in current:
        return False
    del current[keys[-1]]
    return True


def prompt_yes_no(message: str, default: bool = False) -> bool:
    if not sys.stdin.isatty():
        return default

    suffix = "[Y/n]" if default else "[y/N]"
    while True:
        answer = input(f"{message} {suffix} ").strip().lower()
        if not answer:
            return default
        if answer in {"y", "yes", "예", "네"}:
            return True
        if answer in {"n", "no", "아니오", "아니"}:
            return False
        print("Please answer with y or n.")


def prompt_choice(message: str, options: list[str], default: int = 0) -> int:
    if not options:
        raise SystemExit("Error: no options available.")
    if not sys.stdin.isatty():
        return default

    while True:
        print(message)
        for index, option in enumerate(options, start=1):
            suffix = " (default)" if index - 1 == default else ""
            print(f"  {index}. {option}{suffix}")
        answer = input(f"Select [1-{len(options)}] (default {default + 1}): ").strip()
        if not answer:
            return default
        if answer.isdigit() and 1 <= int(answer) <= len(options):
            return int(answer) - 1
        print("Enter a valid number.")


def format_path_label(path: tuple[Any, ...]) -> str:
    return ".".join(str(part) for part in path)


def format_binding_scope(path: tuple[Any, ...]) -> str:
    if not path:
        return "Binding"
    scope = str(path[0]).lower()
    if scope == "agent":
        return "Agent"
    if scope == "command":
        return "Command"
    if scope == "global":
        return "Global"
    return str(path[0]).capitalize()


def format_binding_name(path: tuple[Any, ...]) -> str:
    if not path:
        return ""
    scope = str(path[0]).lower()
    if scope in {"agent", "command", "global"}:
        if len(path) >= 2:
            return str(path[1])
        return ""
    return ".".join(str(part) for part in path[1:] if part != "model") or str(path[0])


def binding_scope_key(path: tuple[Any, ...]) -> str:
    if not path:
        return "binding"
    return str(path[0]).lower()


def conflict_target_summary(conflict: dict[str, Any]) -> str:
    return str(conflict["direction"])


def format_conflict_field(field: str) -> str:
    if field == "model":
        return paint(field, BOLD, WHITE)
    if field == "effort":
        return paint(field, BOLD, CYAN)
    return paint(field, BOLD)


def effort_styles(value: str) -> tuple[str, ...]:
    styles = {
        "low": (BOLD, BLUE),
        "medium": (BOLD, GREEN),
        "high": (BOLD, YELLOW),
        "xhigh": (BOLD, RED),
    }
    return styles.get(value, (BOLD,))


def conflict_value_styles(
    field: str, value: str, *, previous: bool = False
) -> tuple[str, ...]:
    if field == "model":
        styles: tuple[str, ...] = (BOLD, WHITE)
    elif field == "effort":
        styles = effort_styles(value)
    else:
        styles = (BOLD,)

    if previous:
        return (DIM, *styles)
    return styles


def format_conflict_change(
    field: str,
    current: str,
    previous: str,
) -> str:
    current_value = paint(current, *conflict_value_styles(field, current))
    previous_value = paint(
        previous, *conflict_value_styles(field, previous, previous=True)
    )
    return f"{current_value} ({previous_value})"


def conflict_field_parts(conflict: dict[str, Any]) -> list[tuple[str, str]]:
    parts: list[tuple[str, str]] = []
    if conflict.get("model_conflict"):
        previous, current = conflict_arrow_values(
            conflict, "preset_model", "config_model"
        )
        parts.append(
            (
                "model",
                f"{format_conflict_field('model')} {paint('|', DIM)} {format_conflict_change('model', current, previous)}",
            )
        )
    if conflict.get("effort_conflict"):
        previous, current = conflict_arrow_values(
            conflict, "preset_effort", "config_effort"
        )
        parts.append(
            (
                "effort",
                f"{format_conflict_field('effort')} {paint('|', DIM)} {format_conflict_change('effort', current, previous)}",
            )
        )
    return parts


def conflict_arrow_values(
    conflict: dict[str, Any], preset_key: str, config_key: str
) -> tuple[str, str]:
    if conflict["direction"] == "presets":
        return str(conflict[config_key]), str(conflict[preset_key])
    return str(conflict[preset_key]), str(conflict[config_key])


def conflict_changed_fields(conflict: dict[str, Any]) -> list[str]:
    return [label for _, label in conflict_field_parts(conflict)]


def field_lines(entry: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    model = entry.get("model")
    if model is not None:
        model_value = str(model)
        lines.append(
            f"{format_conflict_field('model')} {paint('|', DIM)} {paint(model_value, *conflict_value_styles('model', model_value))}"
        )
    effort = entry.get("effort")
    if effort is not None:
        effort_value = str(effort)
        lines.append(
            f"{format_conflict_field('effort')} {paint('|', DIM)} {paint(effort_value, *conflict_value_styles('effort', effort_value))}"
        )
    return lines


def wrap_conflict_detail_line(text: str, width: int) -> list[str]:
    plain_text = strip_ansi(text)
    wrapped_plain = wrap_plain_to_width(plain_text, width)
    if len(wrapped_plain) <= 1:
        return [text]

    prefix_length = len(wrapped_plain[0])
    first_segment = fit_to_width(text, prefix_length)
    continuation_indent = " " * max(
        0, visible_width(first_segment) - visible_width(first_segment.lstrip())
    )
    return [
        first_segment,
        *[f"{continuation_indent}{segment}" for segment in wrapped_plain[1:]],
    ]


def format_direction_target(direction: str) -> str:
    if direction == "presets":
        return paint("[presets]", BOLD, MAGENTA)
    if direction == "opencode":
        return paint("[opencode]", BOLD, CYAN)
    if direction == "current":
        return paint("[current]", BOLD, GREEN)
    return paint(f"[{direction}]", BOLD)


def format_named_block(
    target: str,
    name_path: tuple[Any, ...],
    detail_lines: list[str],
    target_width: int,
    name_width: int,
    detail_width: int,
) -> list[str]:
    name_label = paint(format_binding_name(name_path), BOLD)
    target_cell = pad_visible(target, target_width)
    name_cell = pad_visible(name_label, name_width)

    if not detail_lines:
        return [f"{target_cell} {name_cell}"]

    header = f"{target_cell} {name_cell}"
    detail_indent = " " * (target_width + 1 + name_width + 1)
    lines: list[str] = []
    for index, detail_line in enumerate(detail_lines):
        prefix = f"{header} " if index == 0 else detail_indent
        wrapped_detail = wrap_conflict_detail_line(detail_line, detail_width)
        lines.append(f"{prefix}{wrapped_detail[0]}")
        continuation_prefix = f"{detail_indent}{' ' * 2}"
        lines.extend(f"{continuation_prefix}{part}" for part in wrapped_detail[1:])
    return lines


def format_conflict_blocks(
    conflict: dict[str, Any], target_width: int, name_width: int, detail_width: int
) -> list[str]:
    return format_named_block(
        format_direction_target(conflict_target_summary(conflict)),
        conflict["binding_path"],
        conflict_changed_fields(conflict),
        target_width,
        name_width,
        detail_width,
    )


def format_entry_blocks(
    entry: dict[str, Any], target_width: int, name_width: int, detail_width: int
) -> list[str]:
    return format_named_block(
        format_direction_target(str(entry["direction"])),
        entry["binding_path"],
        field_lines(entry),
        target_width,
        name_width,
        detail_width,
    )


def build_applied_entries(
    bindings: list[dict[str, Any]], conflicts: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    conflict_map = {
        tuple(conflict["preset_binding_path"]): conflict for conflict in conflicts
    }
    entries: list[dict[str, Any]] = []
    for binding in bindings:
        conflict = conflict_map.get(tuple(binding["binding_path"]))
        if not conflict:
            continue

        display_path = display_binding_path(binding)
        entry: dict[str, Any] = {
            "binding_path": display_path,
            "scope": binding_scope_key(binding["binding_path"]),
            "direction": conflict["direction"],
        }

        if conflict.get("model_conflict"):
            entry["model"] = (
                conflict["preset_model"]
                if conflict["direction"] == "presets"
                else conflict["config_model"]
            )
        if conflict.get("effort_conflict"):
            entry["effort"] = (
                conflict["preset_effort"]
                if conflict["direction"] == "presets"
                else conflict["config_effort"]
            )
        entries.append(entry)
    return entries


def build_current_entries(
    config: dict[str, Any], bindings: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for binding in bindings:
        entry: dict[str, Any] = {
            "binding_path": display_binding_path(binding),
            "scope": binding_scope_key(binding["binding_path"]),
            "direction": "current",
        }
        try:
            entry["model"] = str(
                get_path(
                    config,
                    list((*binding["path"], "model"))
                    if binding["mode"] == "pair"
                    else list(binding["path"]),
                )
            )
        except (KeyError, TypeError, IndexError):
            continue
        if binding["mode"] == "pair":
            effort = read_current_reasoning_effort(config, binding["path"])
            if effort is not None:
                entry["effort"] = effort
        entries.append(entry)
    return entries


def append_grouped_blocks(
    lines: list[str],
    entries: list[dict[str, Any]],
    formatter: Callable[[dict[str, Any]], list[str]],
) -> None:
    previous_scope = ""
    for entry in entries:
        scope = str(entry.get("scope", binding_scope_key(entry["binding_path"])))
        if scope != previous_scope:
            if previous_scope:
                lines.append("")
            scope_label = (
                "Agent"
                if scope == "agent"
                else "Command"
                if scope == "command"
                else "Global"
                if scope == "global"
                else scope.capitalize()
            )
            lines.append(paint(scope_label, BOLD, WHITE))
            lines.append("")
            previous_scope = scope
        lines.extend(formatter(entry))


def render_conflict_lines(
    conflicts: list[dict[str, Any]], current_index: int, offset: int, message: str
) -> tuple[list[str], int]:
    terminal_size = shutil.get_terminal_size((100, 24))
    selected_for_presets = sum(
        1 for conflict in conflicts if conflict["direction"] == "presets"
    )
    lines = [
        paint("Model conflict resolution", BOLD, BLUE),
        paint(HELP_TEXT_CONFLICT, DIM),
        paint(
            f"Items: {len(conflicts)} | opencode: {len(conflicts) - selected_for_presets} | presets: {selected_for_presets}",
            BOLD,
        ),
        "",
    ]
    list_height = max(1, terminal_size.lines - len(lines) - 1)
    if current_index < offset:
        offset = current_index
    visible_conflicts = conflicts[offset:]
    target_width = max(
        [
            visible_width(f"[{conflict_target_summary(conflict)}]")
            for conflict in visible_conflicts
        ],
        default=len("[opencode]"),
    )
    available_name_width = max(12, terminal_size.columns // 6)
    name_width = min(
        max(
            [
                visible_width(format_binding_name(conflict["binding_path"]))
                for conflict in visible_conflicts
            ],
            default=available_name_width,
        ),
        available_name_width,
    )
    detail_width = max(
        20, terminal_size.columns - 2 - target_width - 1 - name_width - 1
    )

    rendered_blocks = [
        format_conflict_blocks(conflict, target_width, name_width, detail_width)
        for conflict in conflicts
    ]
    rendered_entries: list[tuple[int | None, list[str]]] = []
    previous_scope = ""
    for index in range(offset, len(conflicts)):
        scope = binding_scope_key(conflicts[index]["binding_path"])
        if not rendered_entries or scope != previous_scope:
            if rendered_entries:
                rendered_entries.append((None, [""]))
            rendered_entries.append(
                (
                    None,
                    [
                        paint(
                            format_binding_scope(conflicts[index]["binding_path"]),
                            BOLD,
                            WHITE,
                        )
                    ],
                )
            )
            rendered_entries.append((None, [""]))
            previous_scope = scope
        rendered_entries.append((index, rendered_blocks[index]))

    while True:
        used_lines = sum(
            len(block_lines)
            for entry_index, block_lines in rendered_entries
            if entry_index is None or entry_index <= current_index
        )
        if used_lines <= list_height or offset >= current_index:
            break
        offset += 1
        rendered_entries = []
        previous_scope = ""
        for index in range(offset, len(conflicts)):
            scope = binding_scope_key(conflicts[index]["binding_path"])
            if not rendered_entries or scope != previous_scope:
                if rendered_entries:
                    rendered_entries.append((None, [""]))
                rendered_entries.append(
                    (
                        None,
                        [
                            paint(
                                format_binding_scope(conflicts[index]["binding_path"]),
                                BOLD,
                                WHITE,
                            )
                        ],
                    )
                )
                rendered_entries.append((None, [""]))
                previous_scope = scope
            rendered_entries.append((index, rendered_blocks[index]))

    page_lines = 0
    visible_entries: list[tuple[int | None, list[str]]] = []
    seen_conflict = False
    for entry in rendered_entries:
        block_height = len(entry[1])
        if seen_conflict and page_lines + block_height > list_height:
            break
        if not visible_entries and block_height > list_height:
            visible_entries.append(entry)
            break
        visible_entries.append(entry)
        page_lines += block_height
        if entry[0] is not None:
            seen_conflict = True

    for entry_index, block_lines in visible_entries:
        if entry_index is None:
            lines.extend(block_lines)
            continue
        prefix = (
            paint(ACTIVE_MARKER, BOLD, CYAN) if entry_index == current_index else " "
        )
        first_line = f"{prefix} {block_lines[0]}"
        if entry_index == current_index:
            first_line = paint(first_line, BOLD)
        lines.append(first_line)
        for block_line in block_lines[1:]:
            line = f"  {block_line}"
            if entry_index == current_index:
                line = paint(line, BOLD)
            lines.append(line)

    lines.append(message)
    return lines, offset


def run_conflict_selector(conflicts: list[dict[str, Any]]) -> str:
    file_descriptor = sys.stdin.fileno()
    previous_line_count = 0
    current_index = 0
    offset = 0
    message = "Press Enter to apply the current directions."
    original_settings = termios.tcgetattr(file_descriptor)

    sys.stdout.write("\033[?25l")
    sys.stdout.flush()
    try:
        tty.setraw(file_descriptor)
        while True:
            lines, offset = render_conflict_lines(
                conflicts, current_index, offset, message
            )
            previous_line_count = draw_lines(lines, previous_line_count)
            action = read_key(file_descriptor)
            if action == "UP":
                current_index = max(0, current_index - 1)
            elif action == "DOWN":
                current_index = min(len(conflicts) - 1, current_index + 1)
            elif action == "TOGGLE":
                conflict = conflicts[current_index]
                conflict["direction"] = (
                    "opencode" if conflict["direction"] == "presets" else "presets"
                )
            elif action == "ENTER":
                return "ok"
            elif action == "QUIT":
                return "cancel"
            else:
                message = "Use arrows/jk, Space, Enter, or q."
                continue
            message = "Press Enter to apply the current directions."
    finally:
        termios.tcsetattr(file_descriptor, termios.TCSADRAIN, original_settings)
        sys.stdout.write("\033[?25h\n")
        sys.stdout.flush()


def prompt_conflict_directions(conflicts: list[dict[str, Any]]) -> str:
    if not conflicts:
        return "ok"
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        return "ok"
    return run_conflict_selector(conflicts)


def remove_agent_binding(presets: dict[str, Any], agent_name: str) -> None:
    agent_bindings = get_path(presets, ["bindings", "agent"])
    if not isinstance(agent_bindings, dict):
        raise SystemExit("Error: invalid presets agent bindings format.")

    for tier_name, value in list(agent_bindings.items()):
        if is_legacy_agent_binding(value):
            if tier_name != agent_name:
                continue
            if remove_path(presets, ["bindings", "agent", agent_name]):
                return
            break

        if not isinstance(value, dict) or agent_name not in value:
            continue
        if not remove_path(presets, ["bindings", "agent", tier_name, agent_name]):
            break
        if not value:
            remove_path(presets, ["bindings", "agent", tier_name])
        return

    raise SystemExit(f"Error: could not find {agent_name} binding in presets.")


def iter_agent_binding_names(agent_bindings: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for key, value in agent_bindings.items():
        if is_legacy_agent_binding(value):
            names.append(key)
            continue
        if not isinstance(value, dict):
            raise SystemExit("Error: invalid presets agent bindings format.")
        names.extend(str(agent_name) for agent_name in value.keys())
    return names


def prompt_remove_missing_agent_bindings(
    config: dict[str, Any], presets: dict[str, Any]
) -> None:
    agent_bindings = get_path(presets, ["bindings", "agent"])
    if not isinstance(agent_bindings, dict):
        raise SystemExit("Error: invalid presets agent bindings format.")

    for agent_name in iter_agent_binding_names(agent_bindings):
        if agent_name in BUILTIN_AGENTS:
            continue
        if has_path(config, ["agent", agent_name, "model"]):
            continue

        should_remove = prompt_yes_no(
            f"{agent_name} is missing from opencode.json. Remove {agent_name} from presets.jsonc?"
        )
        if should_remove:
            remove_agent_binding(presets, agent_name)


def write_presets(path: Path, presets: dict[str, Any]) -> None:
    write_text_atomic(path, dump_config(path, presets))


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as tmp_file:
            tmp_path = Path(tmp_file.name)
            tmp_file.write(text)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())

        os.replace(tmp_path, path)
    except Exception:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise


def load_presets() -> dict[str, Any]:
    require_file(PRESETS_FILE, "preset")
    presets = load_json(PRESETS_FILE)
    if not isinstance(presets, dict):
        raise SystemExit("Error: invalid preset JSON format.")
    return presets


def load_config() -> dict[str, Any]:
    require_file(CONFIG_FILE, "config")
    config = load_json(CONFIG_FILE)
    if not isinstance(config, dict):
        raise SystemExit("Error: invalid config JSON format.")
    return config


def normalize_binding(
    binding: Any, prefix: tuple[str, ...], binding_path: tuple[Any, ...]
) -> dict[str, Any]:
    normalized_binding: dict[str, Any]
    if isinstance(binding, str):
        normalized_binding = {"tier": binding}
    elif isinstance(binding, list):
        if not all(isinstance(item, str) for item in binding):
            raise SystemExit("Error: binding array items must be strings.")
        if prefix and prefix[0] == "agent":
            if len(binding) != 2:
                raise SystemExit("Error: agent binding arrays must use [tier, effort].")
            normalized_binding = {"tier": binding[0], "effort": binding[1]}
        else:
            if len(binding) != 1:
                raise SystemExit("Error: model binding arrays must use [tier].")
            normalized_binding = {"tier": binding[0]}
    elif isinstance(binding, dict):
        normalized_binding = binding
    else:
        raise SystemExit("Error: invalid binding format.")

    if "tier" not in normalized_binding:
        raise SystemExit("Error: binding entries require a tier.")

    normalized: dict[str, Any] = {
        "tier": normalized_binding["tier"],
        "optional": bool(normalized_binding.get("optional", False)),
        "binding_path": binding_path,
    }

    if "path" in normalized_binding:
        path = normalized_binding["path"]
        if not isinstance(path, list) or not all(
            isinstance(item, str) for item in path
        ):
            raise SystemExit("Error: invalid binding path format.")
        normalized["path"] = tuple(path)
        normalized["mode"] = "model"
        return normalized

    if not prefix:
        raise SystemExit("Error: grouped bindings require a path or prefix.")

    if prefix[0] == "agent" and "effort" not in normalized_binding:
        raise SystemExit("Error: agent bindings require an effort.")

    if "effort" in normalized_binding:
        normalized["effort"] = normalized_binding["effort"]

    if prefix[0] == "global":
        normalized["path"] = (prefix[-1],)
        normalized["mode"] = "model"
    elif prefix[0] == "command":
        normalized["path"] = (*prefix, "model")
        normalized["mode"] = "model"
    else:
        normalized["path"] = prefix
        normalized["mode"] = "pair" if prefix[0] == "agent" else "model"
    return normalized


def is_legacy_agent_binding(binding: Any) -> bool:
    return isinstance(binding, (str, list)) or (
        isinstance(binding, dict) and ("tier" in binding or "path" in binding)
    )


def is_legacy_model_binding(binding: Any) -> bool:
    return isinstance(binding, (str, list)) or (
        isinstance(binding, dict) and ("tier" in binding or "path" in binding)
    )


def normalize_agent_tier_binding(
    tier_name: str,
    agent_name: str,
    binding: Any,
    binding_path: tuple[Any, ...],
) -> dict[str, Any]:
    normalized_binding: dict[str, Any]
    if isinstance(binding, str):
        normalized_binding = {"effort": binding}
    elif isinstance(binding, dict):
        normalized_binding = binding
    else:
        raise SystemExit(
            "Error: grouped agent bindings must use effort strings or objects."
        )

    if "effort" not in normalized_binding:
        raise SystemExit("Error: grouped agent bindings require an effort.")

    return {
        "tier": tier_name,
        "effort": normalized_binding["effort"],
        "optional": bool(normalized_binding.get("optional", False)),
        "binding_path": binding_path,
        "path": ("agent", agent_name),
        "mode": "pair",
    }


def normalize_grouped_model_binding(
    scope: str,
    tier_name: str,
    name: str,
    binding: Any,
    binding_path: tuple[Any, ...],
) -> dict[str, Any]:
    if isinstance(binding, dict):
        normalized_binding = binding
    else:
        raise SystemExit("Error: grouped model binding entries must use objects.")

    normalized: dict[str, Any] = {
        "tier": tier_name,
        "optional": bool(normalized_binding.get("optional", False)),
        "binding_path": binding_path,
    }
    if scope == "global":
        normalized["path"] = (name,)
    elif scope == "command":
        normalized["path"] = ("command", name, "model")
    else:
        raise SystemExit(f"Error: unsupported grouped model binding scope '{scope}'.")
    normalized["mode"] = "model"
    return normalized


def collect_bindings(
    node: Any, prefix: tuple[str, ...] = (), binding_path: tuple[Any, ...] = ()
) -> list[dict[str, Any]]:
    if isinstance(node, list):
        if all(isinstance(item, str) for item in node):
            return [normalize_binding(node, prefix, binding_path)]
        bindings: list[dict[str, Any]] = []
        for index, item in enumerate(node):
            if not isinstance(item, dict):
                raise SystemExit("Error: preset binding items must be objects.")
            if "tier" in item:
                bindings.append(normalize_binding(item, prefix, (*binding_path, index)))
                continue
            raise SystemExit("Error: preset binding leaves must be tier objects.")
        return bindings
    if isinstance(node, dict):
        if "tier" in node or "effort" in node:
            return [normalize_binding(node, prefix, binding_path)]
        flattened: list[dict[str, Any]] = []
        if prefix == ("agent",):
            for key, value in node.items():
                if is_legacy_agent_binding(value):
                    flattened.extend(
                        collect_bindings(value, (*prefix, key), (*binding_path, key))
                    )
                    continue
                if not isinstance(value, dict):
                    raise SystemExit("Error: invalid grouped agent bindings format.")
                for agent_name, agent_binding in value.items():
                    flattened.append(
                        normalize_agent_tier_binding(
                            key,
                            agent_name,
                            agent_binding,
                            (*binding_path, key, agent_name),
                        )
                    )
            return flattened
        if prefix in {("global",), ("command",)}:
            scope = prefix[0]
            for key, value in node.items():
                # In grouped model scopes, a string list names the target config keys.
                # Treat it before legacy binding detection so values like
                # global.lite = ["small_model"] do not get parsed as [tier].
                if isinstance(value, list):
                    if not all(isinstance(item, str) for item in value):
                        raise SystemExit(
                            "Error: grouped model binding lists must contain only strings."
                        )
                    for index, name in enumerate(value):
                        flattened.append(
                            normalize_grouped_model_binding(
                                scope,
                                key,
                                name,
                                {},
                                (*binding_path, key, index),
                            )
                        )
                    continue
                if is_legacy_model_binding(value):
                    flattened.extend(
                        collect_bindings(value, (*prefix, key), (*binding_path, key))
                    )
                    continue
                if not isinstance(value, dict):
                    raise SystemExit("Error: invalid grouped model bindings format.")
                for name, grouped_binding in value.items():
                    flattened.append(
                        normalize_grouped_model_binding(
                            scope,
                            key,
                            name,
                            grouped_binding,
                            (*binding_path, key, name),
                        )
                    )
            return flattened
        for key, value in node.items():
            flattened.extend(
                collect_bindings(value, (*prefix, key), (*binding_path, key))
            )
        return flattened
    if isinstance(node, str):
        return [normalize_binding(node, prefix, binding_path)]
    raise SystemExit("Error: invalid preset bindings format.")


def profile_ids(presets: dict[str, Any]) -> list[str]:
    profiles = presets.get("profiles", {})
    if not isinstance(profiles, dict):
        raise SystemExit("Error: preset JSON is missing profiles.")
    return sorted(profiles.keys(), key=natural_sort_key)


def profile_data(presets: dict[str, Any], profile_id: str) -> dict[str, Any]:
    profiles = presets.get("profiles", {})
    if profile_id not in profiles:
        raise SystemExit(f"Error: unsupported profile '{profile_id}'")
    profile = profiles[profile_id]
    if not isinstance(profile, dict):
        raise SystemExit(f"Error: invalid profile '{profile_id}' format.")
    return profile


def preset_models(presets: dict[str, Any]) -> dict[str, Any]:
    models = presets.get("model", {})
    if not isinstance(models, dict):
        raise SystemExit("Error: invalid preset model format.")
    return models


def resolve_profile_tier_name(profile: dict[str, Any], name: str) -> str:
    tiers = profile.get("tiers", {})
    if not isinstance(tiers, dict):
        raise SystemExit("Error: invalid profile tiers format.")

    tier_candidates = {
        "max": ("max", "plus", "large"),
        "plus": ("plus", "large"),
        "large": ("plus", "large"),
        "core": ("core", "medium"),
        "medium": ("core", "medium"),
        "lite": ("lite", "small"),
        "small": ("lite", "small"),
        "mini": ("mini", "lite", "small"),
    }

    for candidate in tier_candidates.get(name, (name,)):
        if candidate in tiers:
            return candidate

    raise SystemExit(f"Error: unknown tier: {name}")


def profile_tier_value(profile: dict[str, Any], name: str) -> Any:
    tiers = profile.get("tiers", {})
    resolved_name = resolve_profile_tier_name(profile, name)
    return tiers[resolved_name]


def tier_model(presets: dict[str, Any], profile: dict[str, Any], name: str) -> str:
    tier = profile_tier_value(profile, name)
    if isinstance(tier, str):
        return tier
    if not isinstance(tier, dict) or "model" not in tier:
        raise SystemExit(
            f"Error: invalid tier '{resolve_profile_tier_name(profile, name)}' format."
        )
    return str(tier["model"])


def model_efforts(presets: dict[str, Any], model: str) -> list[str]:
    entry = preset_models(presets).get(model)
    if entry is None:
        return []
    if isinstance(entry, list) and all(isinstance(item, str) for item in entry):
        return list(entry)
    if isinstance(entry, dict):
        efforts = entry.get("efforts", [])
        if isinstance(efforts, list) and all(isinstance(item, str) for item in efforts):
            return list(efforts)
    raise SystemExit(f"Error: invalid model entry format for '{model}'.")


def normalize_reasoning_effort(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def read_current_reasoning_effort(
    config: dict[str, Any], path: tuple[str, ...]
) -> str | None:
    try:
        value = get_path(config, list((*path, "reasoningEffort")))
    except (KeyError, TypeError, IndexError):
        return None
    return normalize_reasoning_effort(value)


def binding_expectations(
    presets: dict[str, Any], profile: dict[str, Any], binding: dict[str, Any]
) -> list[tuple[tuple[str, ...], Any, str]]:
    model_value = tier_model(presets, profile, binding["tier"])
    path = binding["path"]
    if binding["mode"] == "pair":
        return [
            ((*path, "model"), model_value, "model"),
            (
                (*path, "reasoningEffort"),
                normalize_reasoning_effort(binding["effort"]),
                "reasoningEffort",
            ),
        ]
    return [(path, model_value, "model")]


def collect_binding_conflicts(
    presets: dict[str, Any],
    profile: dict[str, Any],
    config: dict[str, Any],
    bindings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []

    for binding in bindings:
        if binding["optional"] and not has_path(config, list(binding["path"])):
            continue

        conflict: dict[str, Any] = {
            "tier": binding["tier"],
            "binding_path": binding["path"],
            "preset_binding_path": binding["binding_path"],
            "mode": binding["mode"],
            "direction": "presets",
            "model_conflict": False,
            "effort_conflict": False,
        }

        for target, expected, field in binding_expectations(presets, profile, binding):
            if field == "reasoningEffort":
                current = read_current_reasoning_effort(config, binding["path"])
            else:
                try:
                    current = get_path(config, list(target))
                except (KeyError, TypeError):
                    continue

            if current == expected:
                continue

            if field == "model":
                conflict["model_conflict"] = True
                conflict["target_path"] = target
                conflict["preset_model"] = str(expected)
                conflict["config_model"] = str(current)
            elif field == "reasoningEffort":
                conflict["effort_conflict"] = True
                conflict["preset_effort"] = str(expected)
                conflict["config_effort"] = "none" if current is None else str(current)

        if conflict["model_conflict"] or conflict["effort_conflict"]:
            conflicts.append(conflict)

    return conflicts


def update_profile_models_from_config(
    presets: dict[str, Any], profile_id: str, conflicts: list[dict[str, Any]]
) -> None:
    profile = profile_data(presets, profile_id)
    tiers = profile.get("tiers")
    if not isinstance(tiers, dict):
        raise SystemExit(f"Error: invalid profile '{profile_id}' tiers format.")

    updates_by_tier: dict[str, str] = {}
    sources_by_tier: dict[str, list[str]] = {}
    for conflict in conflicts:
        if conflict["direction"] != "opencode" or not conflict.get("model_conflict"):
            continue
        tier_name = conflict["tier"]
        model = conflict["config_model"]
        path_label = format_path_label(conflict["binding_path"])
        sources_by_tier.setdefault(tier_name, []).append(f"{model} ({path_label})")
        if tier_name in updates_by_tier and updates_by_tier[tier_name] != model:
            raise SystemExit(
                "Error: bindings that write back to the same presets tier point to different models: "
                f"tier '{tier_name}' -> {', '.join(sources_by_tier[tier_name])}"
            )
        updates_by_tier[tier_name] = model

    for tier_name, model in updates_by_tier.items():
        if tier_name not in tiers:
            raise SystemExit(
                f"Error: profile '{profile_id}' is missing tier '{tier_name}'."
            )
        tier = tiers[tier_name]
        if isinstance(tier, str):
            tiers[tier_name] = model
            continue
        if not isinstance(tier, dict):
            raise SystemExit(f"Error: invalid tier '{tier_name}' format.")
        tier["model"] = model


def update_binding_efforts_from_config(
    conflicts: list[dict[str, Any]], presets: dict[str, Any]
) -> None:
    bindings = presets.get("bindings")
    if not isinstance(bindings, dict):
        raise SystemExit("Error: invalid preset bindings format.")

    for conflict in conflicts:
        if conflict["direction"] != "opencode" or not conflict.get("effort_conflict"):
            continue
        binding = get_path(bindings, list(conflict["preset_binding_path"]))
        if isinstance(binding, str):
            set_path(
                bindings,
                list(conflict["preset_binding_path"]),
                conflict["config_effort"],
            )
            continue
        if isinstance(binding, list):
            if len(binding) < 2:
                raise SystemExit("Error: invalid preset agent binding array format.")
            binding[1] = conflict["config_effort"]
            continue
        if not isinstance(binding, dict):
            raise SystemExit("Error: invalid preset binding format.")
        binding["effort"] = conflict["config_effort"]


def profile_matches(
    presets: dict[str, Any],
    profile: dict[str, Any],
    config: dict[str, Any],
    bindings: list[dict[str, Any]],
) -> bool:
    for binding in bindings:
        optional = binding["optional"]
        for target, expected, field in binding_expectations(presets, profile, binding):
            if field == "reasoningEffort":
                current = read_current_reasoning_effort(config, binding["path"])
                if current != expected:
                    return False
                continue
            try:
                current = get_path(config, target)
            except (KeyError, TypeError):
                if optional:
                    continue
                return False
            if current != expected:
                return False
    return True


def detect_profile(presets: dict[str, Any], config: dict[str, Any]) -> str:
    bindings = collect_bindings(presets.get("bindings", {}))

    for profile_id in profile_ids(presets):
        profile = profile_data(presets, profile_id)
        if profile_matches(presets, profile, config, bindings):
            return profile_id
    return "custom"


def display_binding_path(binding: dict[str, Any]) -> tuple[Any, ...]:
    path = binding["path"]
    if binding["mode"] == "model" and path and path[-1] == "model":
        return tuple(path[:-1])
    return tuple(path)


def print_status(presets: dict[str, Any], config: dict[str, Any]) -> None:
    active_profile = detect_profile(presets, config)
    bindings = collect_bindings(presets.get("bindings", {}))
    current_entries = build_current_entries(config, bindings)
    name_width = min(
        max(
            (
                visible_width(format_binding_name(entry["binding_path"]))
                for entry in current_entries
            ),
            default=12,
        ),
        max(12, terminal_width() // 5),
    )
    detail_width = max(20, terminal_width() - len("[current]") - name_width - 4)

    print(paint("Status", BOLD, BLUE))
    print()
    print(paint("Summary", BOLD, WHITE))
    print()
    print_wrapped_line("active-profile", active_profile)
    print()
    print(paint("Files", BOLD, WHITE))
    print()
    print_wrapped_line("config", str(CONFIG_FILE))
    print_wrapped_line("presets", str(PRESETS_FILE))
    print()
    print(paint("Current", BOLD, WHITE))
    print()
    append_grouped_blocks(
        lines := [],
        current_entries,
        lambda entry: format_entry_blocks(
            entry, len("[current]"), name_width, detail_width
        ),
    )
    for line in lines:
        print(line)


def print_apply_summary(
    presets: dict[str, Any],
    config: dict[str, Any],
    profile_id: str,
    bindings: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
) -> None:
    applied_entries = build_applied_entries(bindings, conflicts)
    target_width = len("[opencode]")
    name_width = min(
        max(
            (
                visible_width(format_binding_name(entry["binding_path"]))
                for entry in applied_entries
            ),
            default=12,
        ),
        max(12, terminal_width() // 5),
    )
    detail_width = max(20, terminal_width() - target_width - name_width - 4)

    print(paint("Profile Applied", BOLD, BLUE))
    print()
    print(paint("Summary", BOLD, WHITE))
    print()
    print_wrapped_line("profile", profile_id)
    print_wrapped_line("active-profile", detect_profile(presets, config))
    print()
    print(paint("Files", BOLD, WHITE))
    print()
    print_wrapped_line("config", str(CONFIG_FILE))
    print_wrapped_line("presets", str(PRESETS_FILE))
    if applied_entries:
        print()
        print(paint("Applied", BOLD, WHITE))
        print()
        append_grouped_blocks(
            lines := [],
            applied_entries,
            lambda entry: format_entry_blocks(
                entry, target_width, name_width, detail_width
            ),
        )
        for line in lines:
            print(line)


def format_tier_with_presets(
    presets: dict[str, Any], profile: dict[str, Any], name: str
) -> str:
    model = tier_model(presets, profile, name)
    efforts = ",".join(model_efforts(presets, model))
    if efforts:
        return f"  {name}={model} [{efforts}]"
    return f"  {name}={model}"


def print_profiles(presets: dict[str, Any]) -> None:
    for profile_id in profile_ids(presets):
        profile = profile_data(presets, profile_id)
        print(style(f"[{profile_id}]", "1;35") + f" {profile['label']}")
        for tier_name, _ in profile_tier_items(profile):
            print(
                wrap_text(
                    format_tier_with_presets(presets, profile, tier_name),
                    terminal_width(),
                    indent="",
                    subsequent_indent="    ",
                )
            )
        print()


def build_menu_items(presets: dict[str, Any]) -> list[tuple[str, str | None, str]]:
    items: list[tuple[str, str | None, str]] = []
    for profile_id in profile_ids(presets):
        profile = profile_data(presets, profile_id)
        items.append(
            ("apply", profile_id, f"Apply profile {profile_id}: {profile['label']}")
        )
    items.extend(
        [
            ("status", None, "Show status"),
            ("list", None, "Show profile list"),
            ("help", None, "Show help"),
            ("quit", None, "Quit"),
        ]
    )
    return items


def build_menu_entries(
    items: list[tuple[str, str | None, str]],
) -> list[tuple[str, int | None, str]]:
    entries: list[tuple[str, int | None, str]] = [
        ("section", None, "Profiles"),
        ("spacer", None, ""),
    ]
    profile_count = sum(1 for action, _, _ in items if action == "apply")
    for index, (_, _, label) in enumerate(items[:profile_count]):
        entries.append(("item", index, label))

    entries.extend(
        [
            ("spacer", None, ""),
            ("section", None, "Other"),
            ("spacer", None, ""),
        ]
    )
    for index, (_, _, label) in enumerate(items[profile_count:], start=profile_count):
        entries.append(("item", index, label))
    return entries


def render_menu_lines(
    presets: dict[str, Any],
    items: list[tuple[str, str | None, str]],
    current_index: int,
    offset: int,
    message: str,
) -> tuple[list[str], int]:
    terminal_size = shutil.get_terminal_size((100, 24))
    active_profile = detect_profile(presets, load_config())
    entries = build_menu_entries(items)
    selected_entry_position = next(
        index
        for index, (_, item_index, _) in enumerate(entries)
        if item_index == current_index
    )
    lines = [
        paint("swap-opencode", BOLD, BLUE),
        paint(HELP_TEXT_MENU, DIM),
        paint(f"Config: {CONFIG_FILE}", DIM),
        paint(
            f"Active profile: {active_profile}",
            BOLD,
            MAGENTA if active_profile != "custom" else YELLOW,
        ),
    ]
    list_height = max(1, terminal_size.lines - len(lines) - 1)
    if selected_entry_position < offset:
        offset = selected_entry_position
    elif selected_entry_position >= offset + list_height:
        offset = selected_entry_position - list_height + 1

    for kind, item_index, label in entries[offset : offset + list_height]:
        if kind == "spacer":
            lines.append("")
            continue
        if kind == "section":
            lines.append(paint(label, BOLD, WHITE))
            continue

        prefix = (
            paint(ACTIVE_MARKER, BOLD, CYAN) if item_index == current_index else " "
        )
        line = f"{prefix} {label}"
        if item_index == current_index:
            line = paint(line, BOLD)
        lines.append(line)
    lines.append(message)
    return lines, offset


def interactive_menu(presets: dict[str, Any]) -> tuple[str, str | None] | None:
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        return None

    items = build_menu_items(presets)
    file_descriptor = sys.stdin.fileno()
    previous_line_count = 0
    current_index = 0
    offset = 0
    message = "Press Enter to execute the selected action."
    original_settings = termios.tcgetattr(file_descriptor)

    sys.stdout.write("\033[?25l")
    sys.stdout.flush()
    try:
        tty.setraw(file_descriptor)
        while True:
            lines, offset = render_menu_lines(
                presets, items, current_index, offset, message
            )
            previous_line_count = draw_lines(lines, previous_line_count)
            action = read_key(file_descriptor)
            if action == "UP":
                current_index = max(0, current_index - 1)
            elif action == "DOWN":
                current_index = min(len(items) - 1, current_index + 1)
            elif action == "ENTER":
                return items[current_index][0], items[current_index][1]
            elif action == "QUIT":
                return "quit", None
            else:
                message = "Use arrows/jk, Enter, or q."
                continue
            message = "Press Enter to execute the selected action."
    finally:
        termios.tcsetattr(file_descriptor, termios.TCSADRAIN, original_settings)
        sys.stdout.write("\033[?25h\n")
        sys.stdout.flush()


def apply_profile(profile_id: str, presets: dict[str, Any]) -> None:
    config = load_config()
    profile = profile_data(presets, profile_id)
    config_path = resolve_supported_path(CONFIG_FILE, "config")
    config_dir = config_path.parent
    config_dir.mkdir(parents=True, exist_ok=True)

    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("a+") as lock_handle:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)

        original_presets = json.loads(json.dumps(presets))
        prompt_remove_missing_agent_bindings(config, presets)
        if presets != original_presets:
            write_presets(PRESETS_FILE, presets)

        bindings = collect_bindings(presets.get("bindings", {}))
        conflicts = collect_binding_conflicts(presets, profile, config, bindings)
        resolution = prompt_conflict_directions(conflicts)
        if resolution == "cancel":
            raise SystemExit("Cancelled.")
        if any(conflict["direction"] == "opencode" for conflict in conflicts):
            update_profile_models_from_config(presets, profile_id, conflicts)
            update_binding_efforts_from_config(conflicts, presets)
            write_presets(PRESETS_FILE, presets)
            profile = profile_data(presets, profile_id)
            bindings = collect_bindings(presets.get("bindings", {}))

        updated = json.loads(json.dumps(config))
        for binding in bindings:
            for target, expected, field in binding_expectations(
                presets, profile, binding
            ):
                if binding["optional"] and not has_path(updated, target):
                    continue
                set_path(updated, target, expected)

        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=config_dir,
                prefix=".swap-opencode.config.",
                delete=False,
            ) as tmp_file:
                tmp_path = Path(tmp_file.name)
                tmp_file.write(dump_config(config_path, updated))
                tmp_file.flush()
                os.fsync(tmp_file.fileno())

            os.replace(tmp_path, config_path)
        except Exception:
            if tmp_path is not None and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            raise

    print_apply_summary(presets, updated, profile_id, bindings, conflicts)


def main(argv: list[str]) -> None:
    global CONFIG_FILE, PRESETS_FILE

    if len(argv) > 2:
        usage()
        raise SystemExit(1)

    if len(argv) > 1 and argv[1] in {"-h", "--help", "help"}:
        usage()
        raise SystemExit(0)

    config_path = resolve_supported_path(CONFIG_FILE, "config")
    presets_path = resolve_supported_path(PRESETS_FILE, "preset")
    CONFIG_FILE = config_path
    PRESETS_FILE = presets_path

    if len(argv) == 1:
        if sys.stdin.isatty() and sys.stdout.isatty():
            selected = interactive_menu(load_presets())
            if selected is None:
                return
            action, value = selected
            if action == "quit":
                return
            if action == "help":
                usage()
                return
            if action == "list":
                print_profiles(load_presets())
                return
            if action == "status":
                presets = load_presets()
                config = load_config()
                print_status(presets, config)
                return
            if action == "apply" and value is not None:
                apply_profile(value, load_presets())
                return
        action = "status"
    else:
        action = argv[1]

    presets = load_presets()

    if action == "list":
        print_profiles(presets)
        return

    config = load_config()

    if action == "status":
        print_status(presets, config)
        return

    if action in profile_ids(presets):
        apply_profile(action, presets)
        return

    usage()
    raise SystemExit(1)


if __name__ == "__main__":
    main(sys.argv)
