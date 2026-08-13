#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import textwrap
from dataclasses import dataclass
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve()
SOURCE_ROOT = SCRIPT_PATH.parents[1]
MANIFEST_PATH = SOURCE_ROOT / "meta" / "cmd-links.json"
PUBLIC_BIN_DIR = Path.home() / ".local" / "usr" / "bin"
LEGACY_ALIAS_PATH = Path.home() / ".local" / "share" / "easydev" / "commands"


@dataclass(frozen=True)
class CommandEntry:
    name: str
    mode: str
    target: str
    category: str
    description: str | None = None
    enabled: bool = True
    reason: str | None = None
    owned_paths: tuple[str, ...] = ()

    @property
    def target_path(self) -> Path:
        return SOURCE_ROOT / self.target

    @property
    def owned_source_paths(self) -> tuple[Path, ...]:
        raw_paths = self.owned_paths or (self.target,)
        unique: list[Path] = []
        seen: set[Path] = set()
        for raw in raw_paths:
            path = (SOURCE_ROOT / raw).resolve()
            if path in seen:
                continue
            seen.add(path)
            unique.append(path)
        return tuple(unique)


def load_manifest_data() -> dict:
    return json.loads(MANIFEST_PATH.read_text())


def write_manifest_data(data: dict) -> None:
    MANIFEST_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def load_manifest() -> list[CommandEntry]:
    data = load_manifest_data()
    raw_entries = data.get("commands", [])
    entries: list[CommandEntry] = []
    seen: set[str] = set()

    for raw in raw_entries:
        entry = CommandEntry(
            name=raw["name"],
            mode=raw["mode"],
            target=raw["target"],
            category=raw["category"],
            description=raw.get("description"),
            enabled=raw.get("enabled", True),
            reason=raw.get("reason"),
            owned_paths=tuple(raw.get("ownedPaths", [raw["target"]])),
        )
        if entry.mode not in {"symlink", "wrapper"}:
            raise SystemExit(f"Unsupported mode for {entry.name}: {entry.mode}")
        if entry.name in seen:
            raise SystemExit(f"Duplicate command in manifest: {entry.name}")
        seen.add(entry.name)
        entries.append(entry)

    return entries


def home_shell_reference(path: Path) -> str:
    resolved = path.resolve()
    home = Path.home().resolve()
    try:
        rel = resolved.relative_to(home)
    except ValueError:
        return resolved.as_posix()
    return f"$HOME/{rel.as_posix()}"


def desired_wrapper_text(entry: CommandEntry) -> str:
    target = home_shell_reference(entry.target_path)
    return f'#!/bin/sh\nexec "{target}" "$@"\n'


def desired_symlink_target(entry: CommandEntry) -> str:
    return os.path.relpath(entry.target_path, PUBLIC_BIN_DIR)


def legacy_alias_state() -> str:
    if not LEGACY_ALIAS_PATH.exists() and not LEGACY_ALIAS_PATH.is_symlink():
        return "missing"
    if not LEGACY_ALIAS_PATH.is_symlink():
        return "wrong-kind"
    try:
        resolved = LEGACY_ALIAS_PATH.resolve(strict=True)
    except FileNotFoundError:
        return "broken-link"
    return "ok" if resolved == SOURCE_ROOT.resolve() else "mismatch"


def inspect_entry(entry: CommandEntry) -> str:
    target = entry.target_path
    public_path = PUBLIC_BIN_DIR / entry.name

    if not entry.enabled:
        return "disabled"
    if not target.exists():
        return "target-missing"

    if entry.mode == "symlink":
        if not public_path.exists() and not public_path.is_symlink():
            return "missing"
        if not public_path.is_symlink():
            return "wrong-kind"
        try:
            resolved = public_path.resolve(strict=True)
        except FileNotFoundError:
            return "broken-link"
        if resolved != target.resolve():
            return "symlink-mismatch"
        if not os.access(resolved, os.X_OK):
            return "target-not-executable"
        return "ok"

    if not public_path.exists() and not public_path.is_symlink():
        return "missing"
    if public_path.is_symlink():
        return "wrong-kind"
    if not public_path.is_file():
        return "wrong-kind"
    if public_path.read_text() != desired_wrapper_text(entry):
        return "wrapper-mismatch"
    if not os.access(public_path, os.X_OK):
        return "wrapper-not-executable"
    return "ok"


def remove_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        raise SystemExit(f"Refusing to remove directory: {path}")
    if path.exists() or path.is_symlink():
        path.unlink()


def ensure_public_entry(entry: CommandEntry) -> str:
    public_path = PUBLIC_BIN_DIR / entry.name
    target = entry.target_path
    if not target.exists():
        raise SystemExit(f"Target does not exist for {entry.name}: {target}")

    state = inspect_entry(entry)
    if state == "ok":
        return "unchanged"

    PUBLIC_BIN_DIR.mkdir(parents=True, exist_ok=True)
    remove_path(public_path)

    if entry.mode == "symlink":
        public_path.symlink_to(desired_symlink_target(entry))
        return "linked"

    public_path.write_text(desired_wrapper_text(entry))
    public_path.chmod(0o755)
    return "wrapped"


def ensure_legacy_alias() -> str:
    desired_target = os.path.relpath(SOURCE_ROOT, LEGACY_ALIAS_PATH.parent)
    state = legacy_alias_state()
    if state == "ok":
        return "unchanged"

    LEGACY_ALIAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    remove_path(LEGACY_ALIAS_PATH)
    LEGACY_ALIAS_PATH.symlink_to(desired_target)
    return "linked"


def selected_entries(entries: list[CommandEntry], names: list[str]) -> list[CommandEntry]:
    if not names:
        return [entry for entry in entries if entry.enabled]

    by_name = {entry.name: entry for entry in entries}
    missing = [name for name in names if name not in by_name]
    if missing:
        raise SystemExit(f"Unknown command(s): {', '.join(sorted(missing))}")
    return [by_name[name] for name in names if by_name[name].enabled]


def description_text(entry: CommandEntry) -> str:
    return entry.description or "-"


def terminal_columns() -> int:
    return shutil.get_terminal_size((100, 24)).columns


def wrap_labeled(label: str, text: str, width: int) -> str:
    safe_width = max(len(label) + 20, width)
    return textwrap.fill(
        text,
        width=safe_width,
        initial_indent=label,
        subsequent_indent=" " * len(label),
        break_long_words=False,
        break_on_hyphens=False,
    )


def render_status_wide(chosen: list[CommandEntry]) -> None:
    print(f"{'NAME':<26} {'MODE':<8} {'STATE':<20} {'DESCRIPTION':<44} TARGET")
    for entry in chosen:
        print(
            f"{entry.name:<26} {entry.mode:<8} {inspect_entry(entry):<20} "
            f"{description_text(entry):<44} {entry.target}"
        )


def render_status_compact(chosen: list[CommandEntry], width: int) -> None:
    for entry in chosen:
        print(entry.name)
        print(wrap_labeled("  mode : ", entry.mode, width))
        print(wrap_labeled("  state: ", inspect_entry(entry), width))
        print(wrap_labeled("  desc : ", description_text(entry), width))
        print(wrap_labeled("  target: ", entry.target, width))
        if entry.reason:
            print(wrap_labeled("  reason: ", entry.reason, width))
        print("")


def cmd_status(entries: list[CommandEntry], names: list[str], *, force_wide: bool = False, force_compact: bool = False) -> int:
    chosen = selected_entries(entries, names)
    width = terminal_columns()

    if force_wide and force_compact:
        raise SystemExit("Choose only one of --wide or --compact.")

    if force_compact or (not force_wide and width < 140):
        render_status_compact(chosen, width)
        print(wrap_labeled("legacy : ", f"{legacy_alias_state()} {LEGACY_ALIAS_PATH}", width))
        return 0

    render_status_wide(chosen)
    print("")
    print(f"legacy-alias{'':<15} {'alias':<8} {legacy_alias_state():<20} {LEGACY_ALIAS_PATH}")
    return 0


def cmd_apply(entries: list[CommandEntry], names: list[str], include_legacy_alias: bool) -> int:
    chosen = selected_entries(entries, names)
    for entry in chosen:
        result = ensure_public_entry(entry)
        print(f"{entry.name}: {result}")
    if include_legacy_alias:
        print(f"legacy-alias: {ensure_legacy_alias()}")
    return 0


def remove_public_entries(chosen: list[CommandEntry], include_legacy_alias: bool) -> int:
    for entry in chosen:
        public_path = PUBLIC_BIN_DIR / entry.name
        if public_path.exists() or public_path.is_symlink():
            remove_path(public_path)
            print(f"{entry.name}: removed")
        else:
            print(f"{entry.name}: missing")
    if include_legacy_alias:
        if LEGACY_ALIAS_PATH.exists() or LEGACY_ALIAS_PATH.is_symlink():
            remove_path(LEGACY_ALIAS_PATH)
            print("legacy-alias: removed")
        else:
            print("legacy-alias: missing")
    return 0


def cmd_doctor(entries: list[CommandEntry], names: list[str]) -> int:
    chosen = selected_entries(entries, names)
    problems = 0
    for entry in chosen:
        state = inspect_entry(entry)
        if state != "ok":
            problems += 1
            print(f"{entry.name}: {state} ({entry.mode} -> {entry.target})")
    alias_state = legacy_alias_state()
    if alias_state != "ok":
        problems += 1
        print(f"legacy-alias: {alias_state} ({LEGACY_ALIAS_PATH})")
    if problems == 0:
        print("All managed command entries look healthy.")
        return 0
    return 1


def cmd_set_description(name: str, text: str) -> int:
    normalized = text.strip()
    if not normalized:
        raise SystemExit("Description must not be empty.")

    data = load_manifest_data()
    commands = data.get("commands", [])
    for command in commands:
        if command.get("name") != name:
            continue

        previous = command.get("description")
        command["description"] = normalized
        write_manifest_data(data)

        if previous == normalized:
            print(f"{name}: unchanged")
        elif previous:
            print(f"{name}: updated")
        else:
            print(f"{name}: added")
        print(f"description: {normalized}")
        return 0

    raise SystemExit(f"Unknown command: {name}")


def manifest_command_indexes(data: dict) -> dict[str, int]:
    indexes: dict[str, int] = {}
    for index, command in enumerate(data.get("commands", [])):
        name = command.get("name")
        if not name:
            continue
        indexes[name] = index
    return indexes


def prune_empty_parent_dirs(path: Path) -> None:
    current = path.parent
    source_root = SOURCE_ROOT.resolve()
    while current != source_root and source_root in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def delete_confirmation_message(entries: list[CommandEntry]) -> str:
    lines = [
        "This will permanently remove the following managed command resources:",
        "",
    ]
    for entry in entries:
        lines.append(f"- {entry.name}")
        lines.append(f"  public entry : {PUBLIC_BIN_DIR / entry.name}")
        lines.append(f"  manifest row : {entry.name}")
        for source_path in entry.owned_source_paths:
            lines.append(f"  source file  : {source_path}")
        lines.append("")
    lines.append("Type 'yes' to continue: ")
    return "\n".join(lines)


def confirm_destructive_delete(entries: list[CommandEntry], assume_yes: bool) -> None:
    if assume_yes:
        return
    if not sys.stdin.isatty():
        raise SystemExit("Refusing destructive delete without a TTY. Re-run with --yes to confirm.")
    answer = input(delete_confirmation_message(entries)).strip().lower()
    if answer != "yes":
        raise SystemExit("Remove cancelled.")


def destructive_remove_entries(chosen: list[CommandEntry], assume_yes: bool, include_legacy_alias: bool) -> int:
    if not chosen:
        raise SystemExit("No enabled commands selected for destructive removal.")

    confirm_destructive_delete(chosen, assume_yes)

    data = load_manifest_data()
    indexes = manifest_command_indexes(data)
    removed_manifest_names: list[str] = []

    for entry in chosen:
        public_path = PUBLIC_BIN_DIR / entry.name
        if public_path.exists() or public_path.is_symlink():
            remove_path(public_path)
            print(f"{entry.name}: public entry removed")
        else:
            print(f"{entry.name}: public entry missing")

        for source_path in entry.owned_source_paths:
            source_root = SOURCE_ROOT.resolve()
            if source_root not in source_path.parents and source_path != source_root:
                raise SystemExit(f"Refusing to delete path outside source root: {source_path}")
            if source_path.is_dir() and not source_path.is_symlink():
                raise SystemExit(f"Refusing to delete directory source path: {source_path}")
            if source_path.exists() or source_path.is_symlink():
                remove_path(source_path)
                prune_empty_parent_dirs(source_path)
                print(f"{entry.name}: source removed -> {source_path.relative_to(SOURCE_ROOT)}")
            else:
                print(f"{entry.name}: source missing -> {source_path.relative_to(SOURCE_ROOT)}")

        index = indexes.get(entry.name)
        if index is not None:
            removed_manifest_names.append(entry.name)

    if removed_manifest_names:
        kept_commands = [
            command
            for command in data.get("commands", [])
            if command.get("name") not in removed_manifest_names
        ]
        data["commands"] = kept_commands
        write_manifest_data(data)
        print(f"manifest: removed {', '.join(sorted(removed_manifest_names))}")

    if include_legacy_alias:
        if LEGACY_ALIAS_PATH.exists() or LEGACY_ALIAS_PATH.is_symlink():
            remove_path(LEGACY_ALIAS_PATH)
            print("legacy-alias: removed")
        else:
            print("legacy-alias: missing")

    return 0


def cmd_remove(
    entries: list[CommandEntry],
    names: list[str],
    include_legacy_alias: bool,
    *,
    delete_sources: bool = False,
    assume_yes: bool = False,
) -> int:
    chosen = selected_entries(entries, names)
    if delete_sources:
        if not names:
            raise SystemExit("Destructive remove requires at least one command name.")
        return destructive_remove_entries(chosen, assume_yes, include_legacy_alias)
    if assume_yes:
        raise SystemExit("--yes is only valid with remove --delete.")
    return remove_public_entries(chosen, include_legacy_alias)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Manage ~/.local/usr/bin command entries from the manifest under "
            "~/.local/share/scripts/meta/cmd-links.json."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    status = subparsers.add_parser("status", help="Show the current state of managed entries.")
    status.add_argument("names", nargs="*", help="Optional command names to inspect.")
    status.add_argument(
        "--wide",
        action="store_true",
        help="Force the wide table layout even on a narrow terminal.",
    )
    status.add_argument(
        "--compact",
        action="store_true",
        help="Force the stacked compact layout.",
    )

    apply_cmd = subparsers.add_parser("apply", help="Create or refresh managed entries from the manifest.")
    apply_cmd.add_argument("names", nargs="*", help="Optional command names to apply.")
    apply_cmd.add_argument(
        "--no-legacy-alias",
        action="store_true",
        help="Do not create or refresh the legacy easydev/commands compatibility symlink.",
    )

    remove_cmd = subparsers.add_parser(
        "remove",
        help="Remove managed public entries, or with --delete also remove manifest rows and owned sources.",
    )
    remove_cmd.add_argument("names", nargs="*", help="Optional command names to remove.")
    remove_cmd.add_argument(
        "--legacy-alias",
        action="store_true",
        help="Also remove the legacy easydev/commands compatibility symlink.",
    )
    remove_cmd.add_argument(
        "--delete",
        action="store_true",
        help="Also delete manifest rows and owned source files after confirmation.",
    )
    remove_cmd.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation prompt for remove --delete.",
    )

    relink = subparsers.add_parser("relink", help="Force-remove and then re-apply selected entries.")
    relink.add_argument("names", nargs="*", help="Optional command names to relink.")
    relink.add_argument(
        "--no-legacy-alias",
        action="store_true",
        help="Do not create or refresh the legacy easydev/commands compatibility symlink.",
    )

    doctor = subparsers.add_parser("doctor", help="Report only broken or drifting managed entries.")
    doctor.add_argument("names", nargs="*", help="Optional command names to inspect.")

    set_description = subparsers.add_parser(
        "set-description",
        help="Add or update the human-readable description stored in the manifest.",
    )
    set_description.add_argument("name", help="Managed command name to update.")
    set_description.add_argument(
        "text",
        nargs="+",
        help="Description text to store in the manifest.",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    entries = load_manifest()

    if args.command == "status":
        return cmd_status(entries, args.names, force_wide=args.wide, force_compact=args.compact)
    if args.command == "apply":
        return cmd_apply(entries, args.names, not args.no_legacy_alias)
    if args.command == "remove":
        return cmd_remove(
            entries,
            args.names,
            args.legacy_alias,
            delete_sources=args.delete,
            assume_yes=args.yes,
        )
    if args.command == "relink":
        cmd_remove(entries, args.names, False)
        return cmd_apply(entries, args.names, not args.no_legacy_alias)
    if args.command == "doctor":
        return cmd_doctor(entries, args.names)
    if args.command == "set-description":
        return cmd_set_description(args.name, " ".join(args.text))

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
