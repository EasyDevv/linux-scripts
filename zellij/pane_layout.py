from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from common import (
    DEFAULT_LAYOUT_PATH,
    ZjError,
    active_tab_block,
    current_tab_context,
    dump_layout,
    ensure_parent_dir,
    find_matching_brace,
    find_named_pane_template,
    kdl_quote,
    list_panes,
    list_tabs,
    replace_range,
    require_session,
    root_blocks,
    trim_blank_edge_lines,
    with_trailing_newline,
    zellij_action,
)


SESSION_CACHE_ROOT = Path.home() / ".cache" / "zellij"
RESTORE_DIR = SESSION_CACHE_ROOT / "restore"
WATCHER_DIR = SESSION_CACHE_ROOT / "zju-watchers"
OVERRIDE_LAYOUT_DIR = SESSION_CACHE_ROOT / "override-layouts"
WATCH_INTERVAL_SECONDS = 0.5
WATCHER_MAX_TRANSIENT_ERRORS = 10


def default_layout_source() -> Path | None:
    source = DEFAULT_LAYOUT_PATH
    if source.exists():
        return source
    return None


def is_explicit_layout_path(raw_layout: str) -> bool:
    return "/" in raw_layout or raw_layout.startswith(".") or raw_layout.startswith("~")


def resolve_target(raw_target: str | None) -> Path:
    if not raw_target:
        return DEFAULT_LAYOUT_PATH
    default_layout_dir = DEFAULT_LAYOUT_PATH.parent
    if is_explicit_layout_path(raw_target):
        return Path(raw_target).expanduser()
    filename = raw_target if raw_target.endswith(".kdl") else f"{raw_target}.kdl"
    return default_layout_dir / filename


def resolve_layout_name(raw_layout: str) -> str:
    target = resolve_target(raw_layout)
    if is_explicit_layout_path(raw_layout):
        return str(target)
    if raw_layout.endswith(".kdl") or target.exists():
        return str(target)
    return raw_layout


def resolve_new_tab_layout(explicit_layout: str | None) -> str | None:
    if explicit_layout:
        return resolve_layout_name(explicit_layout)
    source = default_layout_source()
    if source:
        return str(source)
    return None


PANE_HEADER_RE = re.compile(r"^(?P<indent> +)pane\b(?P<attrs>[^\n{]*)(?P<brace>\s*\{)?$", re.MULTILINE)
RUNTIME_PANE_ATTR_RE = re.compile(r'\s(?:command|cwd)="[^"]*"')
RUNTIME_BODY_LINE_RE = re.compile(r"^\s*(?:args\b.*|start_suspended\b.*)$", re.MULTILINE)
EMPTY_PANE_BLOCK_RE = re.compile(
    r"^(?P<indent> +)(?P<header>pane\b[^\n{]*) \{\n(?:(?:[ \t]*\n)*)?(?P=indent)\}\n?",
    re.MULTILINE,
)
ROOT_CWD_RE = re.compile(r'^ {4}cwd (?P<cwd>"(?:[^"\\]|\\.)*")$', re.MULTILINE)
TAB_NAME_RE = re.compile(r'\bname=(?P<name>"(?:[^"\\]|\\.)*")')
TAB_NAME_ATTR_RE = re.compile(r'\sname=(?P<name>"(?:[^"\\]|\\.)*")')


def normalize_runtime_panes(tab_body: str) -> str:
    def sanitize_header(match: re.Match[str]) -> str:
        indent = match.group("indent")
        rest = f"pane{match.group('attrs')}"
        rest = RUNTIME_PANE_ATTR_RE.sub("", rest)
        rest = re.sub(r" {2,}", " ", rest).rstrip()
        if match.group("brace"):
            return f"{indent}{rest} {{"
        return f"{indent}{rest}"

    updated = PANE_HEADER_RE.sub(sanitize_header, tab_body)
    updated = RUNTIME_BODY_LINE_RE.sub("", updated)

    while True:
        collapsed, count = EMPTY_PANE_BLOCK_RE.subn(
            lambda match: f"{match.group('indent')}{match.group('header').rstrip()}\n",
            updated,
        )
        updated = collapsed
        if count == 0:
            return updated


FLOATING_PANES_BLOCK_RE = re.compile(r"^ {8}floating_panes\b[^\n{]*\{", re.MULTILINE)


def strip_floating_panes(body: str) -> str:
    """Remove floating_panes blocks from a tab body."""
    while True:
        match = FLOATING_PANES_BLOCK_RE.search(body)
        if not match:
            return body
        open_brace = body.rfind("{", match.start(), match.end())
        close_brace = find_matching_brace(body, open_brace)
        end = close_brace + 1
        if end < len(body) and body[end] == "\n":
            end += 1
        body = body[:match.start()] + body[end:]


def parse_root_cwd(layout_text: str) -> Path | None:
    match = ROOT_CWD_RE.search(layout_text)
    if not match:
        return None
    return Path(json.loads(match.group("cwd")))


def parse_tab_name(header: str) -> str:
    match = TAB_NAME_RE.search(header)
    if not match:
        raise ZjError("could not determine tab name from layout header")
    return json.loads(match.group("name"))


def strip_loaded_tab_name(header: str) -> str:
    if not TAB_NAME_ATTR_RE.search(header):
        return header
    updated = TAB_NAME_ATTR_RE.sub("", header, count=1)
    indent = re.match(r"^\s*", updated).group(0)
    rest = re.sub(r" {2,}", " ", updated[len(indent) :]).rstrip()
    updated = f"{indent}{rest}"
    if TAB_NAME_ATTR_RE.search(updated):
        updated = TAB_NAME_ATTR_RE.sub(f' name={kdl_quote("loaded-tab")}', header, count=1)
    return updated


def latest_cached_layout(session_name: str) -> Path:
    candidates = []
    if SESSION_CACHE_ROOT.exists():
        for cache_dir in SESSION_CACHE_ROOT.iterdir():
            candidate = cache_dir / "session_info" / session_name / "session-layout.kdl"
            if candidate.is_file():
                candidates.append(candidate)
    if not candidates:
        raise ZjError(f"could not find a serialized layout cache for session {session_name!r}")
    return max(candidates, key=lambda candidate: candidate.stat().st_mtime_ns)


def extract_tab_snapshot(
    layout_text: str,
    *,
    active_position: int,
    cwd_fallback: Path,
) -> tuple[str, str, Path, bool]:
    tab_block = active_tab_block(layout_text, active_position)
    full_tab_body = trim_blank_edge_lines(normalize_runtime_panes(tab_block.body))
    hide_floating_panes = "hide_floating_panes=true" in tab_block.header
    cwd = parse_root_cwd(layout_text) or cwd_fallback
    return (
        parse_tab_name(tab_block.header),
        full_tab_body,
        cwd,
        hide_floating_panes,
    )


def build_snapshot_layout(tab_name: str, tab_body: str, cwd: Path, hide_floating_panes: bool) -> str:
    hide = " hide_floating_panes=true" if hide_floating_panes else ""
    body = trim_blank_edge_lines(tab_body)
    return (
        "layout {\n"
        f"    cwd {kdl_quote(str(cwd))}\n"
        "\n"
        f"    tab name={kdl_quote(tab_name)} focus=true{hide} {{\n"
        f"{body}"
        "    }\n"
        f"    new_tab_template{hide} {{\n"
        f"{body}"
        "    }\n"
        "}\n"
    )


def handle_restore(session_name: str) -> int:
    """Generate a full multi-tab restore layout from a cached session."""
    cache_path = latest_cached_layout(session_name)
    cached_text = cache_path.read_text()

    tabs = root_blocks(cached_text, kind="tab")
    if not tabs:
        raise ZjError(f"no tabs found in cached layout for session {session_name!r}")

    cwd = parse_root_cwd(cached_text) or Path.home()

    parts = [f"layout {{\n    cwd {kdl_quote(str(cwd))}\n\n"]

    # pane_template definitions from the template layout (for new_tab_template references)
    template_source = default_layout_source()
    template_text = template_source.read_text() if template_source else None
    if template_text is not None:
        for block in root_blocks(template_text, kind="pane_template"):
            parts.append(f"{block.text}\n")

    # All tabs from cache, normalized (runtime attrs stripped, floating_panes removed)
    for tab in tabs:
        body = strip_floating_panes(normalize_runtime_panes(tab.body))
        body = trim_blank_edge_lines(body)
        parts.append(f"{tab.header}\n{body}    }}\n")

    # new_tab_template from template layout (for future new tabs)
    if template_text is not None:
        for block in root_blocks(template_text, kind="new_tab_template"):
            parts.append(f"{block.text}")

    # Swap layouts from cached session
    for block in root_blocks(cached_text, kind="swap_tiled_layout"):
        parts.append(f"{block.text}")
    for block in root_blocks(cached_text, kind="swap_floating_layout"):
        parts.append(f"{block.text}")

    parts.append("}\n")

    restore_path = RESTORE_DIR / f"{session_name}.kdl"
    ensure_parent_dir(restore_path)
    restore_path.write_text("".join(parts))

    # Path on stdout (captured by zj function), info on stderr
    print(restore_path)
    tab_names = [parse_tab_name(t.header) for t in tabs]
    print(
        f"Restore layout for session {session_name!r}: "
        f"{len(tabs)} tab(s) [{', '.join(tab_names)}]",
        file=sys.stderr,
    )
    return 0


def with_root_cwd(layout_text: str, cwd: Path) -> str:
    cwd_line = f"    cwd {kdl_quote(str(cwd))}"
    if ROOT_CWD_RE.search(layout_text):
        return with_trailing_newline(ROOT_CWD_RE.sub(cwd_line, layout_text, count=1))
    prefix = "layout {\n"
    if not layout_text.startswith(prefix):
        raise ZjError("layout file does not start with a layout block")
    return with_trailing_newline(layout_text.replace(prefix, f"{prefix}{cwd_line}\n", 1))


def watcher_pid_path(session: str) -> Path:
    safe_session = re.sub(r"[^A-Za-z0-9_.-]+", "_", session)
    return WATCHER_DIR / f"{safe_session}.pid"


def pid_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def ensure_default_new_tab_watcher(session: str) -> None:
    pid_path = watcher_pid_path(session)
    if pid_path.exists():
        try:
            existing_pid = int(pid_path.read_text().strip())
        except ValueError:
            existing_pid = 0
        if existing_pid and pid_is_running(existing_pid):
            return
        pid_path.unlink(missing_ok=True)

    ensure_parent_dir(pid_path)
    env = os.environ.copy()
    env["ZELLIJ_SESSION_NAME"] = session
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve().with_name("zju.py")), "pane", "--watch-default-new-tabs", session],
        cwd=str(Path(__file__).resolve().parent),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def arm_default_new_tab_policy(session: str, target: Path) -> None:
    if target == DEFAULT_LAYOUT_PATH:
        ensure_default_new_tab_watcher(session)


def active_tab_entry(session: str) -> dict | None:
    for tab in list_tabs(session=session):
        if tab.get("active"):
            return tab
    return None


def should_auto_load_active_tab(active_tab: dict, panes: list[dict]) -> bool:
    tab_panes = [pane for pane in panes if pane.get("tab_id") == active_tab.get("tab_id")]
    selectable_terminals = [
        pane
        for pane in tab_panes
        if pane.get("is_selectable") and not pane.get("is_plugin")
    ]
    tiled = [pane for pane in selectable_terminals if not pane.get("is_floating")]
    floating = [pane for pane in selectable_terminals if pane.get("is_floating")]
    return len(tiled) == 1 and len(floating) == 0


def apply_default_layout_to_active_tab(session: str) -> None:
    source = default_layout_source()
    if not source:
        return
    source_text = source.read_text()
    cwd = parse_root_cwd(source_text) or Path.home()
    active_tab = active_tab_entry(session)
    if active_tab is None:
        return
    replace_tab_with_layout(
        session=session,
        source=source,
        cwd=cwd,
        target_tab_id=int(active_tab["tab_id"]),
        target_position=int(active_tab["position"]),
        target_name=active_tab["name"],
    )


def watch_default_new_tabs(session: str) -> int:
    pid_path = watcher_pid_path(session)
    ensure_parent_dir(pid_path)
    pid_path.write_text(str(os.getpid()))
    seen_tab_ids: set[int] = set()
    consecutive_errors = 0
    try:
        initial_active = active_tab_entry(session)
    except ZjError:
        initial_active = None
    if initial_active is not None:
        seen_tab_ids.add(int(initial_active["tab_id"]))

    try:
        while True:
            try:
                active_tab = active_tab_entry(session)
                panes = list_panes(session=session)
                consecutive_errors = 0
            except ZjError:
                consecutive_errors += 1
                if consecutive_errors >= WATCHER_MAX_TRANSIENT_ERRORS:
                    return 0
                time.sleep(WATCH_INTERVAL_SECONDS)
                continue

            if active_tab is not None:
                tab_id = int(active_tab["tab_id"])
                if tab_id not in seen_tab_ids:
                    if should_auto_load_active_tab(active_tab, panes):
                        apply_default_layout_to_active_tab(session)
                    seen_tab_ids.add(tab_id)

            time.sleep(WATCH_INTERVAL_SECONDS)
    finally:
        try:
            if pid_path.exists() and pid_path.read_text().strip() == str(os.getpid()):
                pid_path.unlink()
        except OSError:
            pass


def strip_first_tab_name(layout_text: str) -> str:
    tabs = root_blocks(layout_text, kind="tab")
    if not tabs:
        return layout_text
    first = tabs[0]
    updated_header = strip_loaded_tab_name(first.header)
    if updated_header == first.header:
        return layout_text
    return with_trailing_newline(
        replace_range(layout_text, first.start, first.open_brace + 1, updated_header)
    )


def materialize_load_layout(source: Path, cwd: Path, *, stem: str) -> Path:
    path = OVERRIDE_LAYOUT_DIR / f"{stem}-{os.getpid()}.kdl"
    ensure_parent_dir(path)
    path.write_text(build_load_layout(source, cwd))
    return path


def move_active_tab_to_position(session: str, target_position: int) -> None:
    for _ in range(64):
        active_tab = active_tab_entry(session)
        if active_tab is None:
            raise ZjError("could not determine active tab while moving replacement tab")
        current_position = int(active_tab["position"])
        if current_position == target_position:
            return
        direction = "left" if current_position > target_position else "right"
        zellij_action("move-tab", direction, session=session)
    raise ZjError(f"timed out moving replacement tab to position {target_position}")


def replace_tab_with_layout(
    *,
    session: str,
    source: Path,
    cwd: Path,
    target_tab_id: int,
    target_position: int,
    target_name: str,
) -> int:
    layout_path = materialize_load_layout(source, cwd, stem="zj-layout-load")
    try:
        new_tab_output = zellij_action(
            "new-tab",
            "--layout",
            str(layout_path),
            "--name",
            target_name,
            session=session,
        ).strip()
        try:
            new_tab_id = int(new_tab_output)
        except ValueError as exc:
            raise ZjError(f"unexpected tab id from new-tab: {new_tab_output!r}") from exc
        zellij_action("close-tab-by-id", str(target_tab_id), session=session)
        move_active_tab_to_position(session, target_position)
        zellij_action("rename-tab-by-id", str(new_tab_id), target_name, session=session)
        return new_tab_id
    finally:
        layout_path.unlink(missing_ok=True)


def apply_override_layout(
    session: str,
    layout_text: str,
    *,
    apply_only_to_active_tab: bool,
    retain_existing_terminal_panes: bool = False,
    retain_existing_plugin_panes: bool = False,
) -> None:
    tmp_path = OVERRIDE_LAYOUT_DIR / f"zj-layout-load-{os.getpid()}.kdl"
    try:
        ensure_parent_dir(tmp_path)
        tmp_path.write_text(layout_text)
        args = ["override-layout", str(tmp_path)]
        if apply_only_to_active_tab:
            args.append("--apply-only-to-active-tab")
        if retain_existing_terminal_panes:
            args.append("--retain-existing-terminal-panes")
        if retain_existing_plugin_panes:
            args.append("--retain-existing-plugin-panes")
        zellij_action(*args, session=session)
    finally:
        tmp_path.unlink(missing_ok=True)


def build_legacy_load_layout(source: Path, cwd: Path) -> str:
    """Build a single-tab layout from a legacy pane_template-based layout file."""
    text = source.read_text()
    base_template = find_named_pane_template(text, "base")
    if not base_template:
        raise ZjError(
            f"{source} does not contain a saved tab snapshot or pane_template name=\"base\"; "
            "cannot load layout."
        )
    body = trim_blank_edge_lines(base_template.body)
    hide = ""
    new_tab_templates = root_blocks(text, kind="new_tab_template")
    if new_tab_templates and "hide_floating_panes=true" in new_tab_templates[0].header:
        hide = " hide_floating_panes=true"
    return (
        "layout {\n"
        f"    cwd {kdl_quote(str(cwd))}\n"
        "\n"
        f"    tab focus=true{hide} {{\n"
        "        pane size=1 borderless=true {\n"
        '            plugin location="zellij:tab-bar"\n'
        "        }\n"
        f"{body}"
        "        pane size=1 borderless=true {\n"
        '            plugin location="zellij:status-bar"\n'
        "        }\n"
        "    }\n"
        "}\n"
    )


def build_load_layout(source: Path, cwd: Path) -> str:
    """Build a loadable single-tab layout from a saved layout file."""
    text = source.read_text()
    if root_blocks(text, kind="tab"):
        return with_root_cwd(strip_first_tab_name(text), cwd)
    return build_legacy_load_layout(source, cwd)


def handle_load(target: Path) -> int:
    """Load a saved layout into the active tab by replacing that tab."""
    session = require_session()
    source = target
    if not source.exists():
        raise ZjError(f"layout file not found: {source}")

    cwd = Path(os.getcwd())
    current_tab = current_tab_context(session=session)
    arm_default_new_tab_policy(session, source)
    replace_tab_with_layout(
        session=session,
        source=source,
        cwd=cwd,
        target_tab_id=int(current_tab["tab_id"]),
        target_position=int(current_tab["position"]),
        target_name=current_tab["name"],
    )

    print(f"Loaded layout from {source} into active tab.")
    return 0


def handle_save(target: Path, cache_session: str | None) -> int:
    """Save the current tab layout as a reusable snapshot."""
    session: str | None = None
    if cache_session:
        cache_path = latest_cached_layout(cache_session)
        (
            tab_name,
            full_tab_body,
            snapshot_cwd,
            hide_floating_panes,
        ) = extract_tab_snapshot(
            cache_path.read_text(),
            active_position=-1,
            cwd_fallback=Path.home(),
        )
        source = f"cached session {cache_session!r} ({cache_path})"
    else:
        session = require_session()
        tab_info = current_tab_context(session=session)
        (
            tab_name,
            full_tab_body,
            snapshot_cwd,
            hide_floating_panes,
        ) = extract_tab_snapshot(
            dump_layout(session=session),
            active_position=tab_info["position"],
            cwd_fallback=Path(os.getcwd()),
        )
        source = f"active tab {tab_info['name']!r}"

    ensure_parent_dir(target)
    snapshot = build_snapshot_layout(
        tab_name=tab_name,
        tab_body=full_tab_body,
        cwd=snapshot_cwd,
        hide_floating_panes=hide_floating_panes,
    )
    target.write_text(snapshot)
    if session:
        arm_default_new_tab_policy(session, target)
    print(f"Wrote tab snapshot from {source} to {target}.")
    return 0
