#!/usr/bin/env python3
"""Apply or recover the Tailscale SSH forwarding kill switch.

Default mode only prints the plan. --apply and --recover restart tailscaled
when the drop-in actually changes. Host names stay in the gitignored host list.
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
import select
import signal
import subprocess
import sys
import termios
import tty
from dataclasses import dataclass
from pathlib import Path

DROPIN_PATH = Path("/etc/systemd/system/tailscaled.service.d/ssh-disable-forwarding.conf")
ENV_FILE = Path("/etc/default/tailscaled")
ENV_TOKEN = "TS_SSH_DISABLE_FORWARDING=1"
DROPIN_TEXT = """# Managed by ts-ssh-guard. Do not edit.
[Service]
Environment=TS_SSH_DISABLE_FORWARDING=1
"""
RESTART_DELAY = "5s"
VERIFY_WAIT = 7
def _tool_dir() -> Path:
    try:
        return Path(__file__).resolve().parent
    except NameError:
        return Path.cwd()


TOOL_DIR = _tool_dir()
DEFAULT_CONFIG = TOOL_DIR / ".hosts.json"
EXAMPLE_CONFIG = TOOL_DIR / ".hosts.example.json"
SSH_CONTROL = TOOL_DIR.parent / "init-server" / "host" / "ssh-control.py"

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
RED = "\033[31m"

APPLY_TEXT = {
    "install": "설치 후 재시작",
    "restart": "재시작",
    "noop": "이미 적용됨",
    "conflict": "다른 드롭인이 있어 중단",
    "blocked": "적용 불가",
}
RECOVER_TEXT = {
    "remove": "제거 후 재시작",
    "remove-only": "드롭인만 제거",
    "already": "이미 복구됨",
    "conflict": "다른 드롭인이 있어 중단",
    "blocked": "복구 불가",
    "still-set": "다른 설정에 변수가 남아 복구 불완전",
}
DROPIN_TEXT_KO = {
    "absent": "없음",
    "match": "일치",
    "other": "다름",
    "unreadable": "읽기 실패",
}


class AppError(Exception):
    pass


@dataclass(frozen=True)
class Host:
    name: str
    via: str
    target: str = ""


@dataclass(frozen=True)
class Facts:
    dropin: str
    unit: str
    unit_env: str
    live: str
    envfile: str
    version: str = ""
    started: str = ""
    error: str = ""


def color_enabled(stream) -> bool:
    return bool(getattr(stream, "isatty", lambda: False)()) and os.environ.get("NO_COLOR") is None


def paint(text: str, *styles: str, stream=None) -> str:
    target = stream if stream is not None else sys.stdout
    if not styles or not color_enabled(target):
        return text
    return f"{''.join(styles)}{text}{RESET}"


def split_keys(chunk: str) -> list[str]:
    keys: list[str] = []
    index = 0
    while index < len(chunk):
        rest = chunk[index:]
        if rest.startswith("\x1b"):
            sequence = _escape_sequence(rest)
            key = sequence if sequence else rest[0]
        else:
            key = rest[0]
        keys.append(key)
        index += len(key)
    return keys


def _escape_sequence(rest: str) -> str | None:
    if len(rest) < 2:
        return None
    if rest[1] == "O" and len(rest) >= 3 and rest[2].isalpha():
        return rest[:3]
    if rest[1] != "[":
        return None
    for end in range(2, len(rest)):
        if rest[end].isalpha() or rest[end] == "~":
            return rest[: end + 1]
    return None


def classify_key(chunk: str) -> str | None:
    mapping = {
        "\x1b[A": "UP",
        "\x1bOA": "UP",
        "k": "UP",
        "\x1b[B": "DOWN",
        "\x1bOB": "DOWN",
        "j": "DOWN",
        "g": "FIRST",
        "\x1b[H": "FIRST",
        "\x1bOH": "FIRST",
        "\x1b[1~": "FIRST",
        "G": "LAST",
        "\x1b[F": "LAST",
        "\x1bOF": "LAST",
        "\x1b[4~": "LAST",
        "\r": "ENTER",
        "\n": "ENTER",
        "q": "QUIT",
        "\x1b": "QUIT",
        "\x03": "QUIT",
    }
    return mapping.get(chunk)


def move_index(index: int, action: str | None, count: int) -> int:
    if count <= 0:
        return 0
    if action == "UP":
        return max(0, index - 1)
    if action == "DOWN":
        return min(count - 1, index + 1)
    if action == "FIRST":
        return 0
    if action == "LAST":
        return count - 1
    return index


def env_has_flag(raw: str) -> bool:
    return ENV_TOKEN in raw.split()


def classify_envfile(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        compact = stripped.replace(" ", "")
        if compact in {
            ENV_TOKEN,
            'TS_SSH_DISABLE_FORWARDING="1"',
            "TS_SSH_DISABLE_FORWARDING='1'",
        }:
            return "set"
    return "unset"


def classify_dropin(exists: bool, is_symlink: bool, text: str | None) -> str:
    if not exists:
        return "absent"
    if is_symlink or text is None:
        return "other" if is_symlink else "unreadable"
    return "match" if text == DROPIN_TEXT else "other"


def decide(facts: Facts, mode: str) -> str:
    if facts.error or facts.dropin == "unreadable":
        return "blocked"
    if mode == "apply":
        if facts.unit == "missing":
            return "blocked"
        if facts.dropin == "other":
            return "conflict"
        if facts.dropin == "match" and facts.unit_env == "set" and facts.live != "unset":
            return "noop"
        if facts.dropin == "match":
            return "restart"
        return "install"
    if mode == "recover":
        if facts.dropin == "other":
            return "conflict"
        if facts.dropin == "match":
            return "remove-only" if facts.unit == "missing" else "remove"
        if facts.envfile == "set" or facts.unit_env == "set" or facts.live == "set":
            return "still-set"
        return "already"
    raise ValueError(mode)


def load_hosts(path: Path) -> list[Host]:
    if not path.is_file():
        raise AppError(
            f"host list missing: {path}\n"
            f"copy {EXAMPLE_CONFIG.name} to {path.name} and set the ssh target"
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AppError(f"host list is not valid json: {path.name}") from exc
    rows = payload.get("hosts") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise AppError("host list needs a non-empty hosts array")
    hosts: list[Host] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise AppError("host entry must be an object")
        name = str(row.get("name") or "")
        via = str(row.get("via") or "")
        target = str(row.get("target") or "")
        if not _valid_name(name):
            raise AppError("host name must match [A-Za-z0-9][A-Za-z0-9._-]{0,31}")
        if name in seen:
            raise AppError(f"duplicate host name: {name}")
        seen.add(name)
        if via == "local":
            hosts.append(Host(name, "local"))
            continue
        if via != "ssh":
            raise AppError(f"{name}: via must be local or ssh")
        if not _valid_target(target):
            raise AppError(f"{name}: ssh target is missing or has an unsupported character")
        hosts.append(Host(name, "ssh", target))
    return hosts


def _valid_name(name: str) -> bool:
    if not name or len(name) > 32:
        return False
    if not (name[0].isalnum()):
        return False
    return all(char.isalnum() or char in "._-" for char in name)


def _valid_target(target: str) -> bool:
    if "@" not in target or target.count("@") != 1:
        return False
    user, host = target.split("@", 1)
    if not user or not host:
        return False
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._+-:")
    return all(char in allowed for char in target if char != "@")


def help_text(color: bool | None = None) -> str:
    enabled = color_enabled(sys.stdout) if color is None else color

    def styled(text: str, *styles: str) -> str:
        if not enabled or not styles:
            return text
        return f"{''.join(styles)}{text}{RESET}"

    rows = [
        styled("ts-ssh-guard", BOLD),
        "Tailscale SSH 포워딩 차단을 적용하거나, 이 도구가 만든 드롭인만 복구한다.",
        "",
        styled("동작", BOLD, CYAN),
        f"  {styled('(기본)', GREEN)}     계획만 출력한다. tailscaled를 재시작하지 않는다",
        f"  {styled('--apply', YELLOW)}    드롭인을 설치하고, 필요할 때만 tailscaled를 재시작한다",
        f"  {styled('--recover', RED)}  이 도구의 드롭인만 제거하고, 필요할 때만 재시작한다",
        "",
        styled("호스트", BOLD, CYAN),
        f"  {styled('--host NAME', GREEN)}    반복 가능. 없으면 설정의 모든 호스트",
        f"  {styled('--config PATH', GREEN)}  기본 {DEFAULT_CONFIG}",
        "",
        styled("안전", BOLD, CYAN),
        f"  {styled('--yes', YELLOW)}          터미널이 없을 때 적용·복구를 허용한다",
        "  드롭인 내용이 이 도구의 것과 다르면 적용과 복구를 중단한다",
        "  /etc/default/tailscaled 는 수정하지 않는다",
        f"  {styled('-h, --help', DIM)}    이 도움말",
    ]
    return "\n".join(rows)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--recover", action="store_true")
    parser.add_argument("--host", action="append", default=[])
    parser.add_argument("--config")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("-h", "--help", action="store_true")
    return parser


def select_hosts(hosts: list[Host], names: list[str]) -> list[Host]:
    if not names:
        return hosts
    by_name = {host.name: host for host in hosts}
    missing = [name for name in names if name not in by_name]
    if missing:
        known = ", ".join(host.name for host in hosts)
        raise AppError(f"unknown host: {', '.join(missing)} (known: {known})")
    return [by_name[name] for name in names]


def _run(argv: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _show_unit() -> dict[str, str]:
    completed = _run(
        [
            "systemctl",
            "show",
            "tailscaled",
            "-p",
            "LoadState",
            "-p",
            "ActiveState",
            "-p",
            "Environment",
            "-p",
            "ExecMainStartTimestamp",
            "-p",
            "MainPID",
            "--no-pager",
        ]
    )
    if completed.returncode != 0:
        raise AppError(completed.stderr.strip() or "systemctl show failed")
    values: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def inspect_host() -> Facts:
    try:
        unit = _show_unit()
    except AppError as exc:
        return Facts("unreadable", "missing", "unknown", "unknown", "unreadable", error=str(exc))
    load_state = unit.get("LoadState", "")
    if load_state == "not-found":
        unit_state = "missing"
    elif unit.get("ActiveState") == "active":
        unit_state = "active"
    else:
        unit_state = "inactive"
    try:
        text = DROPIN_PATH.read_text(encoding="utf-8") if DROPIN_PATH.exists() else None
        dropin = classify_dropin(DROPIN_PATH.exists(), DROPIN_PATH.is_symlink(), text)
    except OSError:
        dropin = "unreadable"
    envfile = "absent"
    if ENV_FILE.exists():
        try:
            envfile = classify_envfile(ENV_FILE.read_text(encoding="utf-8"))
        except OSError:
            envfile = "unreadable"
    version = ""
    completed = _run(["tailscale", "version"])
    if completed.returncode == 0:
        version = completed.stdout.splitlines()[0].strip() if completed.stdout else ""
    return Facts(
        dropin=dropin,
        unit=unit_state,
        unit_env="set" if env_has_flag(unit.get("Environment", "")) else "unset",
        live=_live_env(unit.get("MainPID", "")),
        envfile=envfile,
        version=version,
        started=unit.get("ExecMainStartTimestamp", ""),
    )


def _live_env(pid: str) -> str:
    if not pid or pid == "0":
        return "unset"
    path = Path(f"/proc/{pid}/environ")
    try:
        raw = path.read_bytes()
    except PermissionError:
        return "unknown"
    except FileNotFoundError:
        return "unset"
    return "set" if b"TS_SSH_DISABLE_FORWARDING=1" in raw.split(b"\0") else "unset"


def _write_dropin() -> None:
    if DROPIN_PATH.is_symlink():
        raise AppError("drop-in is a symlink")
    DROPIN_PATH.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    temporary = DROPIN_PATH.with_name(DROPIN_PATH.name + ".tmp")
    temporary.write_text(DROPIN_TEXT, encoding="utf-8")
    temporary.chmod(0o644)
    temporary.replace(DROPIN_PATH)


def _schedule_restart() -> None:
    _run(["systemctl", "stop", "ts-ssh-guard-restart.timer"])
    _run(["systemctl", "reset-failed", "ts-ssh-guard-restart.service", "ts-ssh-guard-restart.timer"])
    completed = _run(
        [
            "systemd-run",
            "--collect",
            "--on-active",
            RESTART_DELAY,
            "--unit",
            "ts-ssh-guard-restart",
            "--",
            "systemctl",
            "restart",
            "tailscaled",
        ]
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "systemd-run failed"
        raise AppError(detail)


def mutate(facts: Facts, mode: str, schedule: bool) -> dict:
    action = decide(facts, mode)
    payload = _payload(facts, mode, action)
    if action in {"noop", "already"}:
        payload["ok"] = True
        return payload
    if action in {"conflict", "blocked", "still-set"}:
        payload["ok"] = False
        payload["error"] = action
        return payload
    if os.geteuid() != 0:
        payload["ok"] = False
        payload["error"] = "root required"
        return payload
    if action == "install":
        _write_dropin()
    elif action in {"remove", "remove-only"}:
        if DROPIN_PATH.exists() or DROPIN_PATH.is_symlink():
            DROPIN_PATH.unlink()
    if facts.unit != "missing":
        completed = _run(["systemctl", "daemon-reload"], timeout=30)
        if completed.returncode != 0:
            raise AppError(completed.stderr.strip() or "daemon-reload failed")
    if action == "remove-only" or facts.unit == "missing":
        payload.update(_payload(inspect_host(), mode, action))
        payload["ok"] = True
        payload["restart"] = "none"
        return payload
    if schedule:
        _schedule_restart()
        payload["restart"] = "scheduled"
        payload["pending"] = True
        payload["ok"] = True
        return payload
    completed = _run(["systemctl", "restart", "tailscaled"], timeout=60)
    if completed.returncode != 0:
        raise AppError(completed.stderr.strip() or "restart failed")
    after = inspect_host()
    payload = _payload(after, mode, action)
    payload["restart"] = "done"
    payload["ok"] = _satisfied(mode, after)
    if not payload["ok"]:
        payload["error"] = "still-set" if mode == "recover" and after.envfile == "set" else "verify failed"
    return payload


def _satisfied(mode: str, facts: Facts) -> bool:
    if mode == "apply":
        return facts.dropin == "match" and facts.unit_env == "set" and facts.live == "set"
    if facts.envfile == "set" or facts.unit_env == "set" or facts.live == "set":
        return False
    return facts.dropin == "absent"


def _payload(facts: Facts, mode: str, action: str | None = None) -> dict:
    return {
        "ok": not facts.error,
        "mode": mode,
        "dropin": facts.dropin,
        "unit": facts.unit,
        "unit_env": facts.unit_env,
        "live": facts.live,
        "envfile": facts.envfile,
        "version": facts.version,
        "started": facts.started,
        "apply": decide(facts, "apply"),
        "recover": decide(facts, "recover"),
        "next": action or "",
        "restart": "none",
        "pending": False,
        "error": facts.error,
    }


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def agent_main(argv: list[str]) -> int:
    mode = "plan"
    if "--apply" in argv:
        mode = "apply"
    if "--mode" in argv:
        mode = argv[argv.index("--mode") + 1]
    schedule = "--schedule" in argv
    if mode not in {"plan", "apply", "recover"}:
        emit({"ok": False, "error": "unknown mode"})
        return 2
    facts = inspect_host()
    if mode == "plan":
        payload = _payload(facts, "plan")
        payload["ok"] = not facts.error
        emit(payload)
        return 0 if payload["ok"] else 1
    if os.geteuid() != 0:
        emit({"ok": False, "mode": mode, "error": "root required"})
        return 1
    try:
        payload = mutate(facts, mode, schedule)
    except AppError as exc:
        emit({"ok": False, "mode": mode, "error": str(exc)})
        return 1
    emit(payload)
    return 0 if payload.get("ok") else 1


def _ssh_options() -> list[str]:
    spec = importlib.util.spec_from_file_location("ssh_control", SSH_CONTROL)
    if spec is None or spec.loader is None:
        raise AppError(f"ssh control helper missing: {SSH_CONTROL.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return [
        *module.control_options(),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
    ]


def _remote_script(mode: str, schedule: bool, as_root: bool) -> str:
    encoded = base64.b64encode(Path(__file__).read_bytes()).decode()
    args = f"--agent --mode {mode}"
    if schedule:
        args += " --schedule"
    runner = "sudo -n python3" if as_root else "python3"
    return (
        "set -euo pipefail\n"
        f"printf %s {encoded} | base64 -d | exec {runner} - {args}\n"
    )


def run_remote(host: Host, mode: str, *, as_root: bool, schedule: bool) -> dict:
    script = _remote_script(mode, schedule, as_root)
    completed = subprocess.run(
        ["ssh", *_ssh_options(), host.target, "bash", "--noprofile", "--norc", "-s"],
        input=script,
        text=True,
        capture_output=True,
        timeout=50,
        check=False,
    )
    if completed.returncode != 0 and not completed.stdout.strip():
        detail = completed.stderr.strip().splitlines()
        message = detail[-1] if detail else f"exit {completed.returncode}"
        raise AppError(f"{host.name}: ssh failed ({message})")
    return _parse_result(host.name, completed.stdout)


def _parse_result(name: str, stdout: str) -> dict:
    for line in reversed(stdout.splitlines()):
        if line.startswith("{"):
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise AppError(f"{name}: agent returned invalid json") from exc
            if isinstance(payload, dict):
                return payload
    raise AppError(f"{name}: agent returned no result")


def ensure_sudo(host: Host, tty: bool) -> None:
    if host.via == "local":
        if _run(["sudo", "-n", "true"]).returncode == 0:
            return
        if not tty:
            raise AppError("sudo password required; run sudo -v in a terminal, then rerun with --yes")
        completed = subprocess.run(["sudo", "-v"], check=False)
        if completed.returncode != 0:
            raise AppError("sudo credential was not cached")
        return
    if _remote_sudo_cached(host):
        return
    if not tty:
        raise AppError(f"{host.name}: sudo password required; run from a terminal so sudo -v can prompt")
    completed = subprocess.run(
        ["ssh", "-t", *_ssh_options(), host.target, "sudo", "-v"],
        check=False,
    )
    if completed.returncode != 0 or not _remote_sudo_cached(host):
        raise AppError(f"{host.name}: sudo credential was not cached")


def _remote_sudo_cached(host: Host) -> bool:
    completed = subprocess.run(
        ["ssh", *_ssh_options(), host.target, "sudo", "-n", "true"],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    return completed.returncode == 0


def run_host(host: Host, mode: str, tty: bool) -> dict:
    if mode == "plan" and host.via == "local":
        facts = inspect_host()
        payload = _payload(facts, "plan")
        payload["ok"] = not facts.error
        return payload
    if mode != "plan":
        ensure_sudo(host, tty)
    if host.via == "local":
        completed = subprocess.run(
            ["sudo", "-n", sys.executable, str(Path(__file__).resolve()), "--agent", "--mode", mode],
            check=False,
            capture_output=True,
            text=True,
            timeout=80,
        )
        if completed.returncode != 0 and not completed.stdout.strip():
            raise AppError(completed.stderr.strip() or "local agent failed")
        return _parse_result(host.name, completed.stdout)
    schedule = mode != "plan"
    payload = run_remote(host, mode, as_root=mode != "plan", schedule=schedule)
    if payload.get("pending"):
        payload = _verify_remote(host, mode, payload)
    return payload


def _verify_remote(host: Host, mode: str, before: dict) -> dict:
    import time

    last = before
    for _attempt in range(2):
        time.sleep(VERIFY_WAIT)
        try:
            checked = run_remote(host, "plan", as_root=True, schedule=False)
        except AppError:
            checked = run_remote(host, "plan", as_root=False, schedule=False)
        last = _merge_verify(mode, before, checked)
        if last.get("ok"):
            return last
    return last


def _merge_verify(mode: str, before: dict, after: dict) -> dict:
    merged = dict(after)
    merged["mode"] = mode
    merged["restart"] = "done"
    restarted = after.get("started") not in {"", before.get("started")}
    if mode == "apply":
        merged["ok"] = (
            after.get("dropin") == "match"
            and after.get("unit_env") == "set"
            and (after.get("live") == "set" or (restarted and after.get("live") != "unset"))
        )
    else:
        merged["ok"] = (
            after.get("dropin") == "absent"
            and after.get("unit_env") != "set"
            and after.get("live") != "set"
            and after.get("envfile") != "set"
        )
    if not merged["ok"]:
        merged["error"] = after.get("error") or "verify failed"
    return merged


def render_report(title: str, rows: list[tuple[Host, dict]]) -> str:
    local = [(host, payload) for host, payload in rows if host.via == "local"]
    remote = [(host, payload) for host, payload in rows if host.via == "ssh"]
    lines = [paint(title, BOLD), ""]
    for label, group, color in (("로컬", local, GREEN), ("원격", remote, CYAN)):
        if not group:
            continue
        lines.append(paint(f"{label} ({len(group)})", BOLD, color))
        for host, payload in group:
            lines.extend(_host_lines(host, payload))
        lines.append("")
    failed = [host.name for host, payload in rows if not payload.get("ok", True)]
    if failed:
        lines.append(paint("실패 " + ", ".join(failed), RED))
    else:
        lines.append(paint(f"확인 {len(rows)}", DIM))
    return "\n".join(lines).rstrip() + "\n"


def _host_lines(host: Host, payload: dict) -> list[str]:
    if payload.get("error") and "dropin" not in payload:
        return [f"  {host.name}  {paint(str(payload['error']), RED)}"]
    dropin = DROPIN_TEXT_KO.get(str(payload.get("dropin")), str(payload.get("dropin")))
    dropin_color = {"match": GREEN, "other": RED, "unreadable": RED}.get(str(payload.get("dropin")), YELLOW)
    apply_code = str(payload.get("apply") or "")
    recover_code = str(payload.get("recover") or "")
    version = str(payload.get("version") or "")
    lines = [
        "  "
        + host.name
        + "  드롭인 "
        + paint(dropin, dropin_color)
        + "  적용: "
        + paint(APPLY_TEXT.get(apply_code, apply_code), _action_color(apply_code))
        + "  복구: "
        + paint(RECOVER_TEXT.get(recover_code, recover_code), _action_color(recover_code))
    ]
    if version:
        lines.append(paint(f"    tailscale {version}", DIM))
    if payload.get("envfile") == "set":
        lines.append(paint("    환경 파일에도 변수가 있음. 복구는 그 줄을 지우지 않음", YELLOW))
    if payload.get("live") == "unknown":
        lines.append(paint("    프로세스 환경은 root만 확인", DIM))
    if payload.get("restart") == "scheduled":
        lines.append(paint("    재시작을 예약함", CYAN))
    if payload.get("error") and not payload.get("ok", True):
        lines.append(paint(f"    {payload['error']}", RED))
    return lines


def _action_color(code: str) -> str:
    if code in {"noop", "already"}:
        return DIM
    if code in {"conflict", "blocked", "still-set"}:
        return RED
    if code in {"install", "restart", "remove", "remove-only"}:
        return YELLOW
    return CYAN


def pick(title: str, rows: list[tuple[str, str, str]], *, default: int = 0) -> int | None:
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise AppError("an interactive terminal is required")
    file_descriptor = sys.stdin.fileno()
    current = default
    previous = 0
    original = termios.tcgetattr(file_descriptor)
    sys.stderr.write("\033[?25l")
    sys.stderr.flush()

    def draw() -> None:
        nonlocal previous
        lines = [paint(title, BOLD, stream=sys.stderr), ""]
        for index, (label, detail, color) in enumerate(rows):
            marker = ">" if index == current else " "
            body = label if not detail else f"{label}  {detail}"
            styles = (BOLD, color) if index == current else (color,)
            lines.append(f"{marker} {paint(body, *styles, stream=sys.stderr)}")
        lines.append("")
        lines.append(paint("↑/↓ move  enter select  q abort", DIM, stream=sys.stderr))
        if previous:
            sys.stderr.write(f"\033[{previous}F")
        for index, line in enumerate(lines):
            sys.stderr.write("\r\033[2K")
            sys.stderr.write(line)
            if index < len(lines) - 1:
                sys.stderr.write("\r\n")
        sys.stderr.flush()
        previous = len(lines)

    def on_resize(_signum: int, _frame: object) -> None:
        draw()

    previous_handler = signal.getsignal(signal.SIGWINCH)
    signal.signal(signal.SIGWINCH, on_resize)
    selected: int | None = None
    try:
        tty.setraw(file_descriptor)
        draw()
        while True:
            ready, _, _ = select.select([file_descriptor], [], [], None)
            if not ready:
                continue
            chunk = os.read(file_descriptor, 64)
            if not chunk:
                break
            quit_now = False
            for key in split_keys(chunk.decode("utf-8", "replace")):
                action = classify_key(key)
                if action == "ENTER":
                    selected = current
                    quit_now = True
                    break
                if action == "QUIT":
                    quit_now = True
                    break
                current = move_index(current, action, len(rows))
            if quit_now:
                break
            draw()
    finally:
        termios.tcsetattr(file_descriptor, termios.TCSADRAIN, original)
        signal.signal(signal.SIGWINCH, previous_handler)
        sys.stderr.write("\033[?25h\r\n")
        sys.stderr.flush()
    return selected


def confirm_mutation(mode: str) -> bool:
    label = "적용" if mode == "apply" else "복구"
    chosen = pick(
        f"{label}: tailscaled를 재시작할 수 있습니다. 계속할까요?",
        [("아니오", "", DIM), ("예", "테일넷이 잠시 끊깁니다", RED)],
    )
    return chosen == 1


def choose_action() -> tuple[str, bool] | None:
    chosen = pick(
        "동작",
        [
            ("계획", "모든 호스트, 재시작하지 않음", GREEN),
            ("첫 호스트만", "계획만", GREEN),
            ("적용", "포워딩 차단", YELLOW),
            ("복구", "드롭인 제거", RED),
        ],
    )
    if chosen is None:
        return None
    if chosen == 0:
        return ("plan", False)
    if chosen == 1:
        return ("plan", True)
    if chosen == 2:
        return ("apply", False)
    return ("recover", False)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    if "--agent" in argv:
        return agent_main(argv)
    args = build_parser().parse_args(argv[1:])
    if args.help:
        print(help_text())
        return 0
    if args.apply and args.recover:
        print("error: --apply and --recover are mutually exclusive", file=sys.stderr)
        return 2
    mode = "apply" if args.apply else "recover" if args.recover else "plan"
    first_only = False
    interactive = len(argv) == 1 and sys.stdin.isatty() and sys.stderr.isatty()
    if interactive:
        picked = choose_action()
        if picked is None:
            return 2
        mode, first_only = picked
    if mode != "plan" and not args.yes and not (sys.stdin.isatty() and sys.stderr.isatty()):
        print("error: pass --yes to restart tailscaled without a terminal", file=sys.stderr)
        return 2
    if mode != "plan" and not args.yes and not confirm_mutation(mode):
        return 2
    config = Path(args.config).expanduser() if args.config else Path(
        os.environ.get("TS_SSH_GUARD_CONFIG", str(DEFAULT_CONFIG))
    ).expanduser()
    try:
        hosts = select_hosts(load_hosts(config), args.host)
        if first_only:
            hosts = hosts[:1]
        tty = sys.stdin.isatty() and sys.stderr.isatty()
        rows = [(host, run_host(host, mode, tty)) for host in hosts]
    except AppError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    title = {"plan": "계획", "apply": "적용", "recover": "복구"}[mode]
    sys.stdout.write(render_report(title, rows))
    return 0 if all(payload.get("ok", False) for _host, payload in rows) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("error: aborted", file=sys.stderr)
        raise SystemExit(2) from None
