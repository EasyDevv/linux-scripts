from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import (
    ZjError,
    current_tab_info,
    list_tabs,
    require_session,
    zellij_action,
    zellij_action_parallel,
)
from pane_layout import materialize_load_layout, resolve_new_tab_layout


def handle_new(args: argparse.Namespace) -> int:
    session = require_session()
    count: int = args.count

    base: list[str] = ["new-tab"]
    layout = resolve_new_tab_layout(args.layout)
    layout_temp: Path | None = None
    if args.name and layout:
        candidate = Path(layout).expanduser()
        if candidate.is_file():
            layout_cwd = Path(args.cwd).expanduser() if args.cwd else Path.cwd()
            layout_temp = materialize_load_layout(candidate, layout_cwd, stem="zj-tab-new")
            layout = str(layout_temp)
    if layout:
        base.extend(["--layout", layout])
    if args.cwd:
        base.extend(["--cwd", args.cwd])

    try:
        commands: list[list[str]] = []
        for i in range(count):
            cmd = list(base)
            if args.name:
                name = f"{args.name}-{i + 1}" if count > 1 else args.name
                cmd.extend(["--name", name])
            commands.append(cmd)

        zellij_action_parallel(commands, session=session)
    finally:
        if layout_temp is not None:
            layout_temp.unlink(missing_ok=True)

    label = f"{count} tab(s)" if count > 1 else "1 tab"
    print(f"Opened {label}.")
    return 0


def handle_close(args: argparse.Namespace) -> int:
    session = require_session()

    # No flags → close current tab
    if not args.right and not args.others:
        if not args.yes:
            info = current_tab_info(session=session)
            answer = input(f"Close current tab {info['name']!r}? (y/N): ")
            if answer.lower() not in ("y", "yes"):
                print("Cancelled.")
                return 0
        zellij_action("close-tab", session=session)
        print("Closed current tab.")
        return 0

    tabs = list_tabs(session=session)
    info = current_tab_info(session=session)
    current_position = info["position"]
    current_id = info["tab_id"]

    if args.right:
        targets = [t for t in tabs if t["position"] > current_position]
    else:
        targets = [t for t in tabs if t["tab_id"] != current_id]

    if not targets:
        direction = "to the right" if args.right else "other than current"
        print(f"No tabs {direction}.")
        return 0

    if not args.yes:
        direction = "to the right" if args.right else "(except current)"
        names = ", ".join(t["name"] for t in targets)
        answer = input(f"Close {len(targets)} tab(s) {direction}? [{names}] (y/N): ")
        if answer.lower() not in ("y", "yes"):
            print("Cancelled.")
            return 0

    # Close all targets in parallel (uses stable tab IDs, no index shifting)
    commands = [["close-tab-by-id", str(t["tab_id"])] for t in targets]
    zellij_action_parallel(commands, session=session)

    print(f"Closed {len(targets)} tab(s).")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="zju tab", description="Manage Zellij tabs.")
    sub = parser.add_subparsers(dest="tab_action", required=True)

    new_parser = sub.add_parser(
        "new",
        help="Open new tab(s). Uses my-layout.kdl by default when present.",
        description=(
            "Open one or more tabs. When no layout is provided, zju uses "
            "~/.config/zellij/layouts/my-layout.kdl if it exists."
        ),
    )
    new_parser.add_argument("count", nargs="?", type=int, default=1, help="Number of tabs to open (default: 1).")
    new_parser.add_argument("--name", "-n", help="Tab name. With count >1, appends -1, -2, etc.")
    new_parser.add_argument("--cwd", help="Working directory for new tab(s).")
    new_parser.add_argument(
        "--layout",
        "-l",
        help="Layout to use for new tab(s). Defaults to ~/.config/zellij/layouts/my-layout.kdl if present.",
    )
    new_parser.set_defaults(handler=handle_new)

    close_parser = sub.add_parser(
        "close",
        help="Close tabs (current tab if no flags).",
        description=(
            "Close tabs. With no flags this closes the current tab; use "
            "--right or --others to target additional tabs."
        ),
    )
    close_target = close_parser.add_mutually_exclusive_group()
    close_target.add_argument("--right", "-r", action="store_true", help="Close all tabs to the right.")
    close_target.add_argument("--others", "-o", action="store_true", help="Close all tabs except current.")
    close_parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation prompt.")
    close_parser.set_defaults(handler=handle_close)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.handler(args)
