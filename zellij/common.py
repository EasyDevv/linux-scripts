#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


class ZjError(RuntimeError):
    pass


DEFAULT_LAYOUT_DIR = Path.home() / ".config" / "zellij" / "layouts"
DEFAULT_LAYOUT_PATH = DEFAULT_LAYOUT_DIR / "my-layout.kdl"


@dataclass
class KdlBlock:
    kind: str
    start: int
    end: int
    open_brace: int
    close_brace: int
    header: str
    body: str
    text: str


def require_session() -> str:
    session = os.environ.get("ZELLIJ_SESSION_NAME")
    if not session:
        raise ZjError(
            "ZELLIJ_SESSION_NAME is not set. Run this from inside Zellij "
            "or export ZELLIJ_SESSION_NAME explicitly."
        )
    return session


def run_command(args: list[str], env: dict[str, str] | None = None) -> str:
    result = subprocess.run(
        args,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        stdout = result.stdout.strip()
        message = stderr or stdout or f"command failed: {' '.join(args)}"
        raise ZjError(message)
    return result.stdout


def zellij_action(*args: str, session: str | None = None) -> str:
    env = os.environ.copy()
    if session:
        env["ZELLIJ_SESSION_NAME"] = session
    return run_command(["zellij", "action", *args], env=env)


def zellij_action_parallel(
    commands: list[list[str]],
    session: str | None = None,
) -> None:
    """Run multiple zellij actions in parallel, raising on first failure."""
    if not commands:
        return
    env = os.environ.copy()
    if session:
        env["ZELLIJ_SESSION_NAME"] = session
    procs = [
        subprocess.Popen(
            ["zellij", "action", *cmd],
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for cmd in commands
    ]
    errors: list[str] = []
    for proc, cmd in zip(procs, commands):
        _, stderr = proc.communicate()
        if proc.returncode != 0:
            errors.append(stderr.strip() or f"failed: zellij action {' '.join(cmd)}")
    if errors:
        raise ZjError("; ".join(errors))


def current_tab_info(session: str | None = None) -> dict:
    return json.loads(zellij_action("current-tab-info", "--json", session=session))


def list_panes(session: str | None = None) -> list[dict]:
    return json.loads(zellij_action("list-panes", "--json", session=session))


def list_tabs(session: str | None = None) -> list[dict]:
    return json.loads(zellij_action("list-tabs", "--json", "--state", session=session))


def dump_layout(session: str | None = None) -> str:
    return zellij_action("dump-layout", session=session)


def write_bytes_to_pane(pane_id: str, payload: bytes, session: str | None = None) -> None:
    zellij_action(
        "write",
        "-p",
        pane_id,
        *[str(byte) for byte in payload],
        session=session,
    )


def pane_ref(pane: dict) -> str:
    prefix = "plugin" if pane["is_plugin"] else "terminal"
    return f"{prefix}_{pane['id']}"


def _pane_matches_env_id(pane: dict, env_pane_id: str) -> bool:
    if env_pane_id.startswith("terminal_") or env_pane_id.startswith("plugin_"):
        return pane_ref(pane) == env_pane_id
    return not pane["is_plugin"] and str(pane["id"]) == env_pane_id


def is_current_pane(pane: dict) -> bool:
    env_pane_id = os.environ.get("ZELLIJ_PANE_ID")
    return bool(env_pane_id) and _pane_matches_env_id(pane, env_pane_id)


def current_tab_context(session: str | None = None) -> dict:
    panes = list_panes(session=session)
    env_pane_id = os.environ.get("ZELLIJ_PANE_ID")
    if env_pane_id:
        for pane in panes:
            if _pane_matches_env_id(pane, env_pane_id):
                return {
                    "tab_id": pane["tab_id"],
                    "position": pane["tab_position"],
                    "name": pane["tab_name"],
                }
    info = current_tab_info(session=session)
    return {"tab_id": info["tab_id"], "position": info["position"], "name": info["name"]}


def current_tab_terminal_panes(session: str | None = None) -> tuple[dict, list[dict]]:
    all_panes = list_panes(session=session)
    env_pane_id = os.environ.get("ZELLIJ_PANE_ID")
    tab_info = None
    if env_pane_id:
        for pane in all_panes:
            if _pane_matches_env_id(pane, env_pane_id):
                tab_info = {
                    "tab_id": pane["tab_id"],
                    "position": pane["tab_position"],
                    "name": pane["tab_name"],
                }
                break
    if not tab_info:
        info = current_tab_info(session=session)
        tab_info = {"tab_id": info["tab_id"], "position": info["position"], "name": info["name"]}
    terminal_panes = [
        pane for pane in all_panes
        if not pane["is_plugin"] and pane["tab_id"] == tab_info["tab_id"] and not pane["is_floating"]
    ]
    return tab_info, terminal_panes


def kdl_quote(value: str) -> str:
    return json.dumps(value)


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def with_trailing_newline(text: str) -> str:
    return text if text.endswith("\n") else f"{text}\n"


def trim_blank_edge_lines(text: str) -> str:
    lines = text.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return with_trailing_newline("\n".join(lines))


def find_matching_brace(text: str, open_brace: int) -> int:
    depth = 0
    in_string = False
    in_comment = False
    escaping = False
    i = open_brace

    while i < len(text):
        char = text[i]
        next_char = text[i + 1] if i + 1 < len(text) else ""

        if in_comment:
            if char == "\n":
                in_comment = False
        elif in_string:
            if escaping:
                escaping = False
            elif char == "\\":
                escaping = True
            elif char == '"':
                in_string = False
        else:
            if char == "/" and next_char == "/":
                in_comment = True
                i += 1
            elif char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1

    raise ZjError("could not find matching closing brace")


ROOT_BLOCK_RE = re.compile(
    r'^(?P<indent> {4})(?P<kind>tab|new_tab_template|pane_template|default_tab_template|swap_tiled_layout|swap_floating_layout)\b[^\n{]*\{',
    re.MULTILINE,
)


def root_blocks(text: str, kind: str | None = None) -> list[KdlBlock]:
    blocks: list[KdlBlock] = []
    for match in ROOT_BLOCK_RE.finditer(text):
        block_kind = match.group("kind")
        if kind and block_kind != kind:
            continue
        line_end = text.find("\n", match.start())
        if line_end == -1:
            line_end = len(text)
        open_brace = text.find("{", match.start(), line_end + 1)
        close_brace = find_matching_brace(text, open_brace)
        end = close_brace + 1
        if end < len(text) and text[end] == "\n":
            end += 1
        blocks.append(
            KdlBlock(
                kind=block_kind,
                start=match.start(),
                end=end,
                open_brace=open_brace,
                close_brace=close_brace,
                header=text[match.start() : open_brace + 1],
                body=text[open_brace + 1 : close_brace],
                text=text[match.start() : end],
            )
        )
    return blocks


def find_named_pane_template(text: str, name: str) -> KdlBlock | None:
    pattern = re.compile(
        rf'^ {{4}}pane_template\b[^\n]*name={re.escape(kdl_quote(name))}[^\n{{]*\{{',
        re.MULTILINE,
    )
    match = pattern.search(text)
    if not match:
        return None
    line_end = text.find("\n", match.start())
    if line_end == -1:
        line_end = len(text)
    open_brace = text.find("{", match.start(), line_end + 1)
    close_brace = find_matching_brace(text, open_brace)
    end = close_brace + 1
    if end < len(text) and text[end] == "\n":
        end += 1
    return KdlBlock(
        kind="pane_template",
        start=match.start(),
        end=end,
        open_brace=open_brace,
        close_brace=close_brace,
        header=text[match.start() : open_brace + 1],
        body=text[open_brace + 1 : close_brace],
        text=text[match.start() : end],
    )


DIRECT_ENTRY_RE = re.compile(r"^ {8}\S.*$", re.MULTILINE)


def direct_children(body: str) -> list[str]:
    children: list[str] = []
    cursor = 0
    for match in DIRECT_ENTRY_RE.finditer(body):
        if match.start() < cursor:
            continue
        line_start = match.start()
        line_end = body.find("\n", line_start)
        if line_end == -1:
            line_end = len(body)
        line = body[line_start:line_end]
        if line.lstrip().startswith("//"):
            cursor = line_end + 1
            continue
        if "{" in line:
            open_brace = body.find("{", line_start, line_end + 1)
            close_brace = find_matching_brace(body, open_brace)
            end = close_brace + 1
            if end < len(body) and body[end] == "\n":
                end += 1
        else:
            end = line_end + 1 if line_end < len(body) else line_end
        children.append(body[line_start:end])
        cursor = end
    return children


def _has_plugin(entry: str, plugin_name: str) -> bool:
    return (
        f'plugin location="zellij:{plugin_name}"' in entry
        or f'plugin location="{plugin_name}"' in entry
    )


def split_tab_wrappers(tab_body: str) -> tuple[str, bool]:
    entries = direct_children(trim_blank_edge_lines(tab_body))
    if (
        len(entries) >= 3
        and _has_plugin(entries[0], "tab-bar")
        and _has_plugin(entries[-1], "status-bar")
    ):
        return "".join(entries[1:-1]), True
    return "".join(entries), False


def replace_range(text: str, start: int, end: int, replacement: str) -> str:
    return f"{text[:start]}{replacement}{text[end:]}"


def active_tab_block(layout_text: str, active_position: int) -> KdlBlock:
    tabs = root_blocks(layout_text, kind="tab")
    if 0 <= active_position < len(tabs):
        return tabs[active_position]
    for tab in tabs:
        if "focus=true" in tab.header:
            return tab
    raise ZjError("could not determine the active tab from dumped layout")
