#!/usr/bin/env python3
"""zju — unified Zellij utility CLI.

Subcommands:
    pane     Manage pane cwd sync and pane layouts.
    tab      Manage tabs (new, close).
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from importlib import import_module
from typing import Final

# Ensure the script directory is on sys.path so sibling modules resolve.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import ZjError  # noqa: E402


@dataclass(frozen=True)
class CommandSpec:
    module_name: str
    help: str


COMMANDS: Final[dict[str, CommandSpec]] = {
    "pane": CommandSpec("pane", "Manage pane cwd sync and pane layouts."),
    "tab": CommandSpec("tab", "Manage tabs (new, close)."),
}


def format_help() -> str:
    width = max(len(name) for name in COMMANDS)
    lines = ["usage: zju <command> [options]", "", "commands:"]
    lines.extend(f"  {name:<{width}}  {spec.help}" for name, spec in COMMANDS.items())
    lines.extend(("", "Use 'zju <command> --help' for command-specific help."))
    return "\n".join(lines)


def dispatch(command: str, argv: list[str]) -> int:
    spec = COMMANDS.get(command)
    if spec is None:
        print(f"zju: unknown command {command!r}", file=sys.stderr)
        return 1

    module = import_module(spec.module_name)
    return module.main(argv)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    if not argv:
        print(format_help())
        return 1

    command, *rest = argv
    if command in ("-h", "--help"):
        print(format_help())
        return 0

    return dispatch(command, rest)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ZjError as exc:
        print(f"zju: {exc}", file=sys.stderr)
        raise SystemExit(1)
