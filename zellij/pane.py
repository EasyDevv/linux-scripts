from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

from common import (
    ZjError,
    current_tab_terminal_panes,
    is_current_pane,
    list_panes,
    pane_ref,
    require_session,
    write_bytes_to_pane,
    zellij_action,
)
from pane_layout import (
    handle_load as handle_layout_load,
    handle_restore as handle_layout_restore,
    handle_save as handle_layout_save,
    resolve_target,
    watch_default_new_tabs,
)

AUTO_GENERATED_TAB_NAME_RE = re.compile(r"^Tab #\d+$")


def write_process(session: str, pane_id: str, payload: bytes) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["ZELLIJ_SESSION_NAME"] = session
    return subprocess.Popen(
        ["zellij", "action", "write", "-p", pane_id, *[str(byte) for byte in payload]],
        env=env,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def wait_for_cwd_sync(session: str, pane_refs: set[str], target: str, timeout: float = 5.0) -> None:
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        panes = {pane_ref(pane): pane for pane in list_panes(session=session)}
        if all(panes.get(pane_id, {}).get("pane_cwd") == target for pane_id in pane_refs):
            return
        time.sleep(0.01)
    raise ZjError(f"timed out waiting for {len(pane_refs)} pane(s) to reach {target}")


def rename_auto_named_tab(session: str, current_tab: dict, target: Path) -> str | None:
    if not AUTO_GENERATED_TAB_NAME_RE.fullmatch(current_tab["name"]):
        return None

    target_name = target.name
    if not target_name or target_name == current_tab["name"]:
        return None

    zellij_action("rename-tab-by-id", str(current_tab["tab_id"]), target_name, session=session)
    return target_name


def handle_sync(args: argparse.Namespace) -> int:
    session = require_session()
    target = Path(args.path).expanduser() if args.path else Path.cwd()
    if not target.exists() or not target.is_dir():
        raise ZjError(f"{target} is not a directory")
    target = target.resolve()

    current_tab, panes = current_tab_terminal_panes(session=session)
    change_payload = f"cd -- {shlex.quote(str(target))} && clear\r".encode()
    clear_payload = b"clear\r"

    pending_processes: list[tuple[str, subprocess.Popen[str]]] = []
    completion_pane_refs: set[str] = set()
    current_pane_payload: tuple[str, bytes] | None = None

    for pane in panes:
        pane_id = pane_ref(pane)
        if pane.get("pane_cwd") is None or pane.get("pane_command") is None:
            continue

        if is_current_pane(pane):
            # Defer write until after other panes sync (keeps errors visible).
            payload = clear_payload if pane.get("pane_cwd") == str(target) else change_payload
            current_pane_payload = (pane_id, payload)
            continue

        if pane.get("pane_cwd") == str(target):
            continue

        pending_processes.append((pane_id, write_process(session, pane_id, change_payload)))
        completion_pane_refs.add(pane_id)

    failures: list[str] = []
    for pane_id, process in pending_processes:
        _, stderr = process.communicate()
        if process.returncode != 0:
            failures.append(f"{pane_id}: {stderr.strip() or 'write failed'}")
    if failures:
        raise ZjError("; ".join(failures))

    # Wait for sync; retry panes whose shells were still initializing.
    retried_count = 0
    if completion_pane_refs:
        try:
            wait_for_cwd_sync(session, completion_pane_refs, str(target))
        except ZjError:
            for p in list_panes(session=session):
                pane_id = pane_ref(p)
                if pane_id in completion_pane_refs and p.get("pane_cwd") != str(target):
                    write_bytes_to_pane(pane_id, change_payload, session=session)
                    retried_count += 1
            if retried_count:
                wait_for_cwd_sync(session, completion_pane_refs, str(target), timeout=10.0)

    if current_pane_payload:
        write_bytes_to_pane(*current_pane_payload, session=session)

    rename_auto_named_tab(session, current_tab, target)
    return 0


def run_save_command(args: argparse.Namespace) -> int:
    return handle_layout_save(resolve_target(args.target), args.cache_session)


def run_load_command(args: argparse.Namespace) -> int:
    return handle_layout_load(resolve_target(args.target))


def run_restore_command(args: argparse.Namespace) -> int:
    return handle_layout_restore(args.session)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="zju pane",
        description=(
            "Manage terminal pane cwd sync and pane-centric layout snapshots."
        ),
    )
    sub = parser.add_subparsers(dest="pane_action", required=True)

    sync_parser = sub.add_parser(
        "sync",
        help="Sync terminal panes in the current tab.",
        description=(
            "Sync terminal panes in the current tab. Without a path argument it "
            "uses the cwd of the current pane, and it also clears the invoking pane."
        ),
    )
    sync_parser.add_argument(
        "path",
        nargs="?",
        help="Optional target directory. Defaults to the current pane cwd.",
    )
    sync_parser.set_defaults(handler=handle_sync)

    save_parser = sub.add_parser(
        "save",
        help="Save the active tab layout. Bare save uses my-layout.kdl.",
        description=(
            "Save the active tab layout to a reusable layout file. Bare save writes "
            "~/.config/zellij/layouts/my-layout.kdl and arms this session so plain "
            "NewTab tabs auto-load my-layout."
        ),
    )
    save_parser.add_argument(
        "target",
        nargs="?",
        help="Optional layout name or path. Bare names resolve under ~/.config/zellij/layouts/.",
    )
    save_parser.add_argument(
        "--from-session-cache",
        dest="cache_session",
        help="Read from a serialized session cache instead of a live session.",
    )
    save_parser.set_defaults(handler=run_save_command)

    load_parser = sub.add_parser(
        "load",
        help="Apply a saved layout to the active tab. Bare load uses my-layout.kdl.",
        description=(
            "Apply a saved layout to the active tab. Bare load reads "
            "~/.config/zellij/layouts/my-layout.kdl. The current tab keeps its "
            "existing name when the layout loads."
        ),
    )
    load_parser.add_argument(
        "target",
        nargs="?",
        help="Optional layout name or path. Bare names resolve under ~/.config/zellij/layouts/.",
    )
    load_parser.set_defaults(handler=run_load_command)

    restore_parser = sub.add_parser(
        "restore",
        help="Generate a full multi-tab restore layout from a cached session.",
        description="Generate a full multi-tab restore layout from a cached session.",
    )
    restore_parser.add_argument("session", metavar="SESSION", help="Serialized session name to restore.")
    restore_parser.set_defaults(handler=run_restore_command)

    return parser


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if len(argv) == 2 and argv[0] == "--watch-default-new-tabs":
        return watch_default_new_tabs(argv[1])

    parser = build_parser()
    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ZjError as exc:
        print(f"zju: {exc}", file=sys.stderr)
        raise SystemExit(1)
