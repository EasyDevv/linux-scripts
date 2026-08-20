#!/usr/bin/env python3
"""One-way Debian VPS bring-up: SSH, bootstrap, NetBird/Podman, early-warning.

Resumes from the first unhealthy stage. Human input only for reinstall
confirm, SSH key unlock, first PAT, operator netbird up, and a missing
Discord webhook file.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

SCRIPT_DIR = Path(__file__).resolve().parent
NETBIRD_DIR = SCRIPT_DIR.parent / "netbird"
for extra in (SCRIPT_DIR, NETBIRD_DIR):
    if str(extra) not in sys.path:
        sys.path.insert(0, str(extra))

from netbird_setup import (  # noqa: E402
    AppError,
    atomic_write,
    confirm_no,
    load_config,
    paint,
    upsert_env,
)
from netbird_setup import BOLD, CYAN, DIM, GREEN, RED  # noqa: E402
from final_report import probe_request, render_report  # noqa: E402

STAGE_IDS = (
    "preflight",
    "reinstall",
    "public_hostname",
    "ssh_agent",
    "wait_sshd",
    "repair_known_hosts",
    "public_ssh",
    "audit",
    "bootstrap",
    "control_plane",
    "verify_control_plane",
    "reboot",
    "owner_pat",
    "operator_up",
    "host_join",
    "image_join",
    "employee_keys",
    "early_warning",
    "overlay_alias",
    "final",
)

PARALLEL_GROUPS = (frozenset({"early_warning", "overlay_alias"}),)

SECTIONS = {
    "preflight": "Local",
    "reinstall": "OVH",
    "public_hostname": "SSH",
    "ssh_agent": "SSH",
    "wait_sshd": "SSH",
    "repair_known_hosts": "SSH",
    "public_ssh": "SSH",
    "audit": "Host",
    "bootstrap": "Host",
    "control_plane": "NetBird",
    "verify_control_plane": "NetBird",
    "reboot": "Host",
    "owner_pat": "NetBird",
    "operator_up": "NetBird",
    "host_join": "NetBird",
    "image_join": "NetBird",
    "employee_keys": "NetBird",
    "early_warning": "Security",
    "overlay_alias": "SSH",
    "final": "Final",
}

PASSPHRASE_MARKERS = (
    "incorrect passphrase",
    "enter passphrase",
    "passphrase supplied",
)
HOSTKEY_MARKERS = (
    "host key verification failed",
    "remote host identification has changed",
)
INVALID_KNOWN_HOSTS_MARKERS = (
    "not a valid known_hosts file",
    "invalid line",
)
PUBLICKEY_MARKERS = ("permission denied (publickey)",)
UNREACHABLE_MARKERS = (
    "connection timed out",
    "connection refused",
    "network is unreachable",
    "no route to host",
)

HELP = """\
init-vps - unattended Debian VPS bring-up (NetBird, Podman, CrowdSec early-warning)

Usage:
  init-vps [--profile ovh-vps] [--apply] [--reinstall] [--yes]
  init-vps status
  init-vps --from STAGE --apply
  init-vps --reset

--reinstall is ovhcloud vps reinstall. It does not SSH first. Login starts
only after OVH --wait returns. Without --reinstall, the disk is assumed
already wiped and public SSH is the first host step.

Plan-only unless --apply is present. Rerun after a failure; completed
healthy stages are skipped. Public TCP 22 is never closed.

Human gates (TTY only, unless the value already exists):
  --reinstall     confirm ovhcloud vps reinstall (destroys the guest)
  ssh-add         unlock the operator IdentityFile
  owner PAT       first NETBIRD_API_KEY after /setup
  netbird up      this PC: netbird up --management-url https://DOMAIN
  sender env      Discord webhook

Non-TTY --apply needs --yes for --reinstall, a loaded ssh-agent,
a working NETBIRD_API_KEY in ~/.local/share/scripts/dev/.env.netbird, and --sender-env or .env.sender.
"""


class Fail(Exception):
    pass


def fail_detail(blob: str, fallback: str) -> str:
    """Last useful error line. Ignore success noise like caddy validate."""
    lines = [line.strip() for line in blob.splitlines() if line.strip()]
    if not lines:
        return fallback
    for line in reversed(lines):
        if line.startswith(":: "):
            continue
        low = line.lower()
        if any(
            token in low
            for token in ("error", "fail", "denied", "inactive", "missing", "refusing")
        ):
            return line
        if low.startswith("bad "):
            return line
    last = lines[-1]
    if last.lower() == "valid configuration" or last.lower().startswith("ok "):
        return fallback
    return last


SPIN_FRAMES = ("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")


class Spinner:
    """TTY braille heartbeat so long remote stages do not look hung."""

    def __init__(self, label: str) -> None:
        self.label = label
        self.detail = ""
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._started = time.monotonic()
        self.enabled = sys.stderr.isatty() and os.environ.get("NO_COLOR") is None

    def set_detail(self, detail: str) -> None:
        cleaned = " ".join(detail.split())
        if len(cleaned) > 64:
            cleaned = cleaned[:61] + "..."
        with self._lock:
            if cleaned == self.detail:
                return
            self.detail = cleaned
        if not self.enabled:
            say(f"{self.label}  {cleaned}", DIM)

    def _line(self, frame: str, elapsed: int) -> str:
        with self._lock:
            detail = self.detail
        extra = f"  {detail}" if detail else ""
        return f"{frame} {self.label}{extra}  {elapsed}s"

    def __enter__(self) -> Spinner:
        if not self.enabled:
            say(f"{self.label} ...", DIM)
            return self
        sys.stderr.write("\033[?25l")
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def _run(self) -> None:
        index = 0
        while not self._stop.wait(0.08):
            elapsed = int(time.monotonic() - self._started)
            frame = SPIN_FRAMES[index % len(SPIN_FRAMES)]
            sys.stderr.write(f"\r\033[K{self._line(frame, elapsed)}")
            sys.stderr.flush()
            index += 1

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)
        if self.enabled:
            sys.stderr.write("\r\033[K\033[?25h")
            sys.stderr.flush()


def normalize_management_url(url: str) -> str:
    text = url.strip().rstrip("/")
    text = re.sub(r":443$", "", text)
    return text.lower()


def local_netbird_connected(expected: str) -> bool:
    if shutil.which("netbird") is None:
        return False
    result = subprocess.run(
        ["netbird", "status", "--json"],
        text=True,
        capture_output=True,
        timeout=10,
    )
    if result.returncode != 0:
        return False
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return False
    mgmt = data.get("management") if isinstance(data, dict) else None
    if not isinstance(mgmt, dict) or mgmt.get("connected") is not True:
        return False
    got = normalize_management_url(str(mgmt.get("url") or ""))
    want = normalize_management_url(expected)
    return got == want


@dataclass
class Profile:
    name: str
    target: str
    admin_user: str
    domain: str
    ovh_service: str
    ovh_cli_profile: str
    expected_public_ip: str
    image_id: str
    pubkey: Path
    host_selector: str
    host_group: str
    admin_group: str
    admin_peer: str
    overlay_alias: str
    early_warning: bool
    reboot: bool
    sender_env_candidates: tuple[Path, ...]
    access_spec: Path | None = None
    image_target: str = ""
    image_selector: str = ""
    image_group: str = "image-servers"
    image_user: str = ""
    employee_roster: Path | None = None
    setup_source_ip: str = ""
    sender_env: Path | None = None


@dataclass
class Probe:
    hostname: str
    user: str
    identity: Path | None
    default_class: str
    isolated_class: str
    whoami: str = ""
    detail: str = ""


@dataclass
class State:
    profile: str
    target: str
    completed: list[str] = field(default_factory=list)
    failed_stage: str = ""
    failed_error: str = ""
    did_reinstall: bool = False
    did_bootstrap: bool = False
    did_control_plane: bool = False
    rebooted: bool = False
    overlay_ip: str = ""
    updated_at: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "profile": self.profile,
            "target": self.target,
            "completed": self.completed,
            "failed_stage": self.failed_stage,
            "failed_error": self.failed_error,
            "did_reinstall": self.did_reinstall,
            "did_bootstrap": self.did_bootstrap,
            "did_control_plane": self.did_control_plane,
            "rebooted": self.rebooted,
            "overlay_ip": self.overlay_ip,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> State:
        return cls(
            profile=str(data.get("profile") or ""),
            target=str(data.get("target") or ""),
            completed=[str(item) for item in data.get("completed") or []],
            failed_stage=str(data.get("failed_stage") or ""),
            failed_error=str(data.get("failed_error") or ""),
            did_reinstall=bool(data.get("did_reinstall")),
            did_bootstrap=bool(data.get("did_bootstrap")),
            did_control_plane=bool(data.get("did_control_plane")),
            rebooted=bool(data.get("rebooted")),
            overlay_ip=str(data.get("overlay_ip") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def expand(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def state_path(target: str) -> Path:
    return SCRIPT_DIR / ".log" / target / "state.json"


def load_state(target: str, profile: str) -> State:
    path = state_path(target)
    if not path.is_file():
        return State(profile=profile, target=target)
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return State(profile=profile, target=target)
    if not isinstance(data, dict):
        return State(profile=profile, target=target)
    state = State.from_json(data)
    if state.target != target:
        return State(profile=profile, target=target)
    return state


_STATE_LOCK = threading.Lock()


def save_state(state: State) -> None:
    with _STATE_LOCK:
        state.updated_at = utc_now()
        path = state_path(state.target)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, json.dumps(state.to_json(), indent=2) + "\n", mode=0o600)


def mark_done(state: State, stage: str) -> None:
    if stage not in state.completed:
        state.completed.append(stage)
    if state.failed_stage == stage:
        state.failed_stage = ""
        state.failed_error = ""
    save_state(state)


def mark_failed(state: State, stage: str, error: str) -> None:
    state.failed_stage = stage
    state.failed_error = error
    save_state(state)


def load_profile(name: str) -> Profile:
    path = SCRIPT_DIR / "profiles" / f"{name}.json"
    if not path.is_file():
        raise Fail(f"profile not found: {path}")
    raw = json.loads(path.read_text())
    raw_candidates = raw.get("sender_env_candidates") or raw.get("discord_env_candidates") or []
    candidates = tuple(expand(item) for item in raw_candidates)
    spec_name = raw.get("access_spec")
    access_spec = None
    if spec_name:
        access_spec = path.parent / str(spec_name)
        if not access_spec.is_file():
            raise Fail(f"access spec not found: {access_spec}")
    roster_name = raw.get("employee_roster")
    employee_roster = None
    if roster_name:
        employee_roster = path.parent / str(roster_name)
        if not employee_roster.is_file():
            raise Fail(f"employee roster not found: {employee_roster}")
    return Profile(
        name=str(raw["name"]),
        target=str(raw["target"]),
        admin_user=str(raw["admin_user"]),
        domain=str(raw["domain"]),
        ovh_service=str(raw["ovh_service"]),
        ovh_cli_profile=str(raw.get("ovh_cli_profile") or "owner-offline"),
        expected_public_ip=str(raw["expected_public_ip"]),
        image_id=str(raw["image_id"]),
        pubkey=expand(raw["pubkey"]),
        host_selector=str(raw["host_selector"]),
        host_group=str(raw["host_group"]),
        admin_group=str(raw["admin_group"]),
        admin_peer=str(raw["admin_peer"]),
        overlay_alias=str(raw["overlay_alias"]),
        early_warning=bool(raw.get("early_warning", True)),
        reboot=bool(raw.get("reboot", True)),
        sender_env_candidates=candidates,
        access_spec=access_spec,
        image_target=str(raw.get("image_target") or ""),
        image_selector=str(raw.get("image_selector") or raw.get("image_target") or ""),
        image_group=str(raw.get("image_group") or "image-servers"),
        image_user=str(raw.get("image_user") or ""),
        employee_roster=employee_roster,
    )


def resolve_sender_env(profile: Profile, explicit: Path | None) -> Path | None:
    if explicit is not None:
        path = expand(explicit)
        return path if path.is_file() else None
    for path in profile.sender_env_candidates:
        if path.is_file():
            return path
    return None


def sender_present(path: Path) -> bool:
    try:
        text = path.read_text()
    except OSError:
        return False
    found: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        found[key.strip()] = value.strip().strip("'\"" )
    hook = found.get("DISCORD_WEBHOOK") or found.get("DISCORD_OVH_VPS_WEBHOOK") or ""
    return hook.startswith("https://")


def classify_ssh_error(text: str) -> str:
    lowered = text.lower()
    if any(marker in lowered for marker in PASSPHRASE_MARKERS):
        return "passphrase"
    if any(marker in lowered for marker in HOSTKEY_MARKERS):
        return "hostkey"
    if any(marker in lowered for marker in INVALID_KNOWN_HOSTS_MARKERS):
        return "invalid_known_hosts"
    if any(marker in lowered for marker in PUBLICKEY_MARKERS):
        return "publickey"
    if any(marker in lowered for marker in UNREACHABLE_MARKERS):
        return "unreachable"
    return "other"


def parse_ssh_g(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        key, _, value = line.partition(" ")
        values[key.lower()] = value.strip()
    return values


def identity_from_ssh_g(values: dict[str, str]) -> Path | None:
    raw = values.get("identityfile")
    if not raw:
        return None
    path = expand(raw)
    return path if path.is_file() else None


def host_blocks(text: str) -> list[tuple[int, int, list[str], dict[str, str]]]:
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if re.match(r"^\s*Host\s+", line, re.I)]
    result: list[tuple[int, int, list[str], dict[str, str]]] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(lines)
        names = lines[start].strip().split()[1:]
        options: dict[str, str] = {}
        for line in lines[start + 1 : end]:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or " " not in stripped:
                continue
            key, value = stripped.split(None, 1)
            options[key.lower()] = value
        result.append((start, end, names, options))
    return result


def ensure_public_hostname(text: str, host: str, public_ip: str) -> tuple[str, str]:
    matches = [block for block in host_blocks(text) if block[2] == [host]]
    if len(matches) != 1:
        raise Fail(f"expected one exact Host {host} block")
    start, end, _names, options = matches[0]
    current = options.get("hostname", "")
    if current == public_ip:
        return text, "noop"
    lines = text.splitlines(keepends=True)
    body: list[str] = []
    replaced = False
    for line in lines[start + 1 : end]:
        if re.match(r"^\s*HostName\s+", line, re.I):
            indent = line[: len(line) - len(line.lstrip())]
            body.append(f"{indent}HostName {public_ip}\n")
            replaced = True
        else:
            body.append(line)
    if not replaced:
        body.insert(0, f"    HostName {public_ip}\n")
    return "".join([*lines[: start + 1], *body, *lines[end:]]), "replace"


def parse_agent_env(text: str) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^(SSH_AUTH_SOCK|SSH_AGENT_PID)=([^;]+)", line)
        if match:
            env[match.group(1)] = match.group(2)
    return env


def fingerprint(path: Path) -> str | None:
    result = subprocess.run(
        ["ssh-keygen", "-lf", str(path)],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    parts = result.stdout.split()
    return parts[1] if len(parts) > 1 else None


def agent_has_key(env: dict[str, str], key: Path) -> bool:
    wanted = fingerprint(key)
    result = subprocess.run(
        ["ssh-add", "-l"],
        text=True,
        capture_output=True,
        env=env,
    )
    if result.returncode != 0:
        return False
    if wanted and wanted in result.stdout:
        return True
    return str(key) in result.stdout


def run_parallel(jobs: list[tuple[str, Callable[[], Any]]]) -> dict[str, Any]:
    """Run independent jobs. Wait for all; raise Fail with every error."""
    if not jobs:
        return {}
    if len(jobs) == 1:
        name, fn = jobs[0]
        return {name: fn()}
    results: dict[str, Any] = {}
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futs = {pool.submit(fn): name for name, fn in jobs}
        for fut in as_completed(futs):
            name = futs[fut]
            try:
                results[name] = fut.result()
            except Fail as exc:
                errors.append(f"{name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{name}: {exc}")
    if errors:
        raise Fail("; ".join(errors))
    return results


def pending_stages(
    completed: list[str],
    *,
    failed_stage: str = "",
    start_from: str | None = None,
) -> list[str]:
    """Stages still to run. Completed work is skipped; failed_stage is retried."""
    if start_from and start_from not in STAGE_IDS:
        raise Fail(f"unknown stage: {start_from}")
    done = set(completed)
    pending: list[str] = []
    for stage in STAGE_IDS:
        if start_from and STAGE_IDS.index(stage) < STAGE_IDS.index(start_from):
            continue
        if stage in done and stage != failed_stage:
            continue
        pending.append(stage)
    return pending


def parallel_peers(stage: str, start_from: str | None) -> tuple[str, ...]:
    group = next((item for item in PARALLEL_GROUPS if stage in item), None)
    if not group:
        return (stage,)
    peers: list[str] = []
    for item in STAGE_IDS:
        if item not in group:
            continue
        if STAGE_IDS.index(item) < STAGE_IDS.index(stage):
            continue
        if start_from and STAGE_IDS.index(item) < STAGE_IDS.index(start_from):
            continue
        peers.append(item)
    return tuple(peers or [stage])


def next_stage(completed: list[str], start_from: str | None) -> str | None:
    pending = pending_stages(completed, start_from=start_from)
    return pending[0] if pending else None


def ssh_control_options(env: dict[str, str] | None = None) -> list[str]:
    values = os.environ if env is None else env
    runtime = values.get("XDG_RUNTIME_DIR")
    path = (
        Path(runtime) / "easydev-ssh-control"
        if runtime
        else Path.home() / ".cache/easydev-ssh-control"
    )
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return [
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPersist=120",
        "-o",
        f"ControlPath={path}/%C",
    ]


def tty_io() -> bool:
    return sys.stdin.isatty() and sys.stderr.isatty()


def say(message: str, *styles: str) -> None:
    print(paint(message, *styles, stream=sys.stderr), file=sys.stderr)


def section(name: str) -> None:
    say(f"\n== {name} ==", BOLD, CYAN)


class Runner:
    def __init__(self, profile: Profile, args: argparse.Namespace) -> None:
        self.profile = profile
        self.args = args
        self.env = dict(os.environ)
        self.state = load_state(profile.target, profile.name)
        self.ssh_config = Path.home() / ".ssh" / "config"
        self.ssh_control_options = ssh_control_options(self.env)
        self._planned = False
        self._tls = threading.local()

    @property
    def apply(self) -> bool:
        return bool(self.args.apply)

    def run_cmd(
        self,
        argv: list[str],
        *,
        check: bool = True,
        capture: bool = False,
        input_text: str | None = None,
        timeout: int | None = None,
        spinner: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        if spinner:
            return self._run_cmd_spin(
                argv,
                check=check,
                input_text=input_text,
                timeout=timeout,
                spinner=spinner,
            )
        result = subprocess.run(
            argv,
            text=True,
            input=input_text,
            capture_output=capture,
            env=self.env,
            timeout=timeout,
        )
        if check and result.returncode != 0:
            blob = (result.stderr or "") + (result.stdout or "")
            detail = fail_detail(blob, f"command failed: {argv[0]}") if capture else ""
            raise Fail(detail or f"command failed: {argv[0]}")
        return result

    def _run_cmd_spin(
        self,
        argv: list[str],
        *,
        check: bool,
        input_text: str | None,
        timeout: int | None,
        spinner: str,
    ) -> subprocess.CompletedProcess[str]:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE if input_text is not None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=self.env,
        )
        chunks: list[str] = []
        ctx = Spinner(spinner)
        ctx.__enter__()
        start = time.monotonic()
        try:
            if input_text is not None and proc.stdin is not None:
                proc.stdin.write(input_text)
                proc.stdin.close()
            assert proc.stdout is not None
            for line in proc.stdout:
                chunks.append(line)
                stripped = line.strip()
                if stripped.startswith(":: "):
                    ctx.set_detail(stripped[3:])
                if timeout is not None and time.monotonic() - start > timeout:
                    proc.kill()
                    raise subprocess.TimeoutExpired(argv, timeout)
            rc = proc.wait(timeout=30)
        finally:
            ctx.__exit__(None, None, None)
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
        result = subprocess.CompletedProcess(argv, rc, "".join(chunks), "")
        if check and result.returncode != 0:
            blob = result.stdout or ""
            if blob.strip():
                for line in blob.strip().splitlines()[-8:]:
                    say(line, DIM)
            raise Fail(fail_detail(blob, f"command failed: {argv[0]}"))
        return result

    def ssh_g(self) -> dict[str, str]:
        result = self.run_cmd(["ssh", "-G", self.profile.target], capture=True)
        return parse_ssh_g(result.stdout)

    def ssh(
        self,
        command: str,
        *,
        extra: list[str] | None = None,
        check: bool = True,
        timeout: int = 20,
    ) -> subprocess.CompletedProcess[str]:
        argv = [
            "ssh",
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "RequestTTY=no",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ConnectionAttempts=1",
            *self.ssh_control_options,
        ]
        if extra:
            argv.extend(extra)
        argv.extend([self.profile.target, command])
        return self.run_cmd(argv, check=check, capture=True, timeout=timeout)

    def ssh_long(
        self,
        command: str,
        *,
        spinner: str,
        log_name: str,
    ) -> subprocess.CompletedProcess[str]:
        argv = [
            "ssh",
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "RequestTTY=no",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ConnectionAttempts=1",
            *self.ssh_control_options,
            self.profile.target,
            command,
        ]
        result = self.run_cmd(argv, capture=True, timeout=1800, spinner=spinner)
        log_path = state_path(self.profile.target).with_name(log_name)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text((result.stdout or "") + (result.stderr or ""))
        return result

    def remote_ok(self, command: str) -> bool:
        result = self.ssh(command, check=False)
        return result.returncode == 0

    def probe_ssh(self) -> Probe:
        values = self.ssh_g()
        hostname = values.get("hostname", "")
        user = values.get("user", "")
        identity = identity_from_ssh_g(values)
        isolated = Path(tempfile.mkdtemp()) / "known_hosts"

        def try_login(extra: list[str]) -> tuple[str, str, str]:
            result = self.ssh(
                'printf "%s\\n" "$(whoami)"',
                extra=extra,
                check=False,
            )
            err = (result.stderr or "") + (result.stdout or "")
            if result.returncode == 0:
                return "ok", result.stdout.strip(), err
            return classify_ssh_error(err), "", err

        probe_opts = ["-o", "ControlMaster=no", "-o", "ControlPath=none"]
        isolated_opts = [
            *probe_opts,
            "-o",
            f"UserKnownHostsFile={isolated}",
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "StrictHostKeyChecking=accept-new",
        ]
        probed = run_parallel(
            [
                ("default", lambda: try_login(probe_opts)),
                ("isolated", lambda: try_login(isolated_opts)),
            ]
        )
        default_class, whoami, default_err = probed["default"]
        isolated_class, _who, isolated_err = probed["isolated"]
        detail = default_err.strip() or isolated_err.strip()
        return Probe(
            hostname=hostname,
            user=user,
            identity=identity,
            default_class=default_class,
            isolated_class=isolated_class,
            whoami=whoami,
            detail=detail.splitlines()[-1] if detail else "",
        )

    def public_ipify(self) -> str:
        if self.profile.setup_source_ip:
            return self.profile.setup_source_ip
        try:
            with urllib.request.urlopen("https://api.ipify.org", timeout=10) as response:
                ip = response.read().decode().strip()
        except (urllib.error.URLError, TimeoutError) as error:
            raise Fail("could not detect workstation IPv4") from error
        if not re.fullmatch(r"(\d{1,3}\.){3}\d{1,3}", ip):
            raise Fail("workstation IPv4 lookup returned a non-IPv4 value")
        self.profile.setup_source_ip = ip
        return ip

    def confirm_reinstall(self) -> bool:
        if self.args.yes:
            return True
        if not tty_io():
            raise Fail("reinstall requires --yes when stdin is not a TTY")
        say(
            f"This wipes {self.profile.ovh_service} ({self.profile.expected_public_ip}).",
            RED,
            BOLD,
        )
        try:
            return confirm_no("Reinstall the OVH VPS now?")
        except AppError as error:
            raise Fail(str(error)) from error

    def ask_secret(self, prompt: str) -> str:
        if not tty_io():
            raise Fail(f"{prompt} required; provide it in the env file")
        value = getpass.getpass(f"{prompt}: ")
        if not value.strip():
            raise Fail(f"{prompt} was empty")
        return value.strip()

    def open_url(self, url: str) -> None:
        opener = shutil.which("xdg-open")
        if opener:
            subprocess.Popen(
                [opener, url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=self.env,
            )
        say(f"open {url}", CYAN)

    def plan(self, message: str) -> None:
        self._planned = True
        self._tls.planned = True
        say(f"PLAN {message}", CYAN)

    def consume_planned(self) -> bool:
        planned = bool(getattr(self._tls, "planned", False) or self._planned)
        self._tls.planned = False
        self._planned = False
        return planned

    def skip(self, stage: str, reason: str) -> None:
        say(f"PASS {stage} ({reason})", DIM)
        if self.apply:
            mark_done(self.state, stage)

    def guest_ready(self) -> bool:
        """False while --reinstall is pending: do not log into the old guest."""
        return not (self.args.reinstall and not self.state.did_reinstall)

    def after_wipe(self, message: str) -> bool:
        """Plan and skip remote work until ovhcloud reinstall has finished."""
        if self.guest_ready():
            return False
        self.plan(f"after ovhcloud reinstall: {message}")
        return True

    # --- stages ---

    def stage_preflight(self) -> None:
        for binary in ("ssh", "scp", "ovhcloud", "python3", "curl"):
            if shutil.which(binary) is None:
                raise Fail(f"missing local command: {binary}")
        if not self.profile.pubkey.is_file():
            raise Fail(f"missing pubkey: {self.profile.pubkey}")
        values = self.ssh_g()
        hostname = values.get("hostname", "")
        if hostname.startswith("100."):
            say(
                f"Host {self.profile.target} HostName is overlay {hostname}; "
                "will restore the public IPv4 after reinstall",
                RED,
            )
        say(f"target {self.profile.target}  ip {self.profile.expected_public_ip}")
        say(f"domain {self.profile.domain}")
        if self.args.reinstall:
            say("reinstall=ovhcloud vps reinstall; no SSH login until after --wait", CYAN)

    def stage_ssh_agent(self) -> None:
        values = self.ssh_g()
        identity = identity_from_ssh_g(values)
        if identity is None:
            raise Fail("no usable IdentityFile for the SSH target")
        sock = self.env.get("SSH_AUTH_SOCK", "")
        if not sock or not Path(sock).exists():
            result = self.run_cmd(["ssh-agent", "-s"], capture=True)
            self.env.update(parse_agent_env(result.stdout))
        if agent_has_key(self.env, identity):
            say(f"ssh-agent already has {identity.name}", DIM)
            return
        if not tty_io():
            raise Fail(
                f"load {identity} into ssh-agent (ssh-add) before non-TTY --apply"
            )
        say(f"ssh-add {identity} (passphrase prompt is local)", CYAN)
        added = self.run_cmd(["ssh-add", str(identity)], check=False)
        if added.returncode != 0 or not agent_has_key(self.env, identity):
            raise Fail("ssh-add failed; unlock the operator key and rerun")

    def stage_reinstall(self) -> None:
        if not self.args.reinstall:
            self.skip("reinstall", "not requested")
            return
        if self.state.did_reinstall:
            self.skip("reinstall", "already recorded")
            return
        if not self.apply:
            self.plan(
                f"ovhcloud vps reinstall {self.profile.ovh_service} "
                f"--image-id {self.profile.image_id}"
            )
            return
        if not self.confirm_reinstall():
            raise Fail("reinstall declined")
        pubkey = self.profile.pubkey.read_text().strip()
        argv = [
            "ovhcloud",
            "--profile",
            self.profile.ovh_cli_profile,
            "vps",
            "reinstall",
            self.profile.ovh_service,
            "--image-id",
            self.profile.image_id,
            "--public-ssh-key",
            pubkey,
            "--do-not-send-password",
            "--wait",
        ]
        say("OVH reinstall started; waiting for the task (not SSH)", CYAN)
        self.run_cmd(argv, timeout=1200, spinner="ovhcloud vps reinstall --wait")
        self.state.did_reinstall = True
        self.state.did_bootstrap = False
        self.state.did_control_plane = False
        self.state.rebooted = False
        self.state.overlay_ip = ""
        self.state.completed = [
            item for item in self.state.completed if item in {"preflight", "reinstall"}
        ]
        save_state(self.state)

    def stage_public_hostname(self) -> None:
        if not self.ssh_config.is_file():
            raise Fail(f"missing {self.ssh_config}")
        text = self.ssh_config.read_text()
        updated, action = ensure_public_hostname(
            text, self.profile.target, self.profile.expected_public_ip
        )
        if action == "noop":
            self.skip("public_hostname", self.profile.expected_public_ip)
            return
        if not self.apply:
            self.plan(
                f"set Host {self.profile.target} HostName {self.profile.expected_public_ip}"
            )
            return
        backup = self.ssh_config.with_name(f"config.bak-init-vps-{int(time.time())}")
        shutil.copy2(self.ssh_config, backup)
        atomic_write(self.ssh_config, updated, mode=0o600)
        say(f"HostName restored; backup {backup.name}", GREEN)

    def stage_wait_sshd(self) -> None:
        if self.after_wipe("wait until public sshd answers"):
            return
        if not self.apply:
            self.plan("wait until public sshd answers")
            return
        deadline = time.time() + (900 if self.state.did_reinstall else 180)
        last = "unreachable"
        with Spinner("waiting for public sshd"):
            while time.time() < deadline:
                probe = self.probe_ssh()
                last = probe.default_class
                if probe.hostname.startswith("100."):
                    raise Fail("HostName is still an overlay address")
                if last in {"ok", "hostkey", "invalid_known_hosts", "publickey", "passphrase"}:
                    break
                time.sleep(8)
            else:
                raise Fail(f"sshd did not become reachable ({last})")
        say(f"sshd reachable ({last})", GREEN)

    def stage_repair_known_hosts(self) -> None:
        if self.after_wipe("repair-known-hosts.py"):
            return
        if not self.apply:
            self.plan("repair-known-hosts.py --apply")
            return
        probe = self.probe_ssh()
        needed = probe.default_class in {"hostkey", "invalid_known_hosts"} or (
            self.state.did_reinstall and probe.default_class != "ok"
        )
        if not needed and not self.args.repair_known_hosts:
            self.skip("repair_known_hosts", probe.default_class)
            return
        argv = [
            sys.executable,
            str(SCRIPT_DIR / "repair-known-hosts.py"),
            "--target",
            self.profile.target,
            "--expected-ip",
            self.profile.expected_public_ip,
            "--ovh-service",
            self.profile.ovh_service,
            "--apply",
        ]
        self.run_cmd(argv)

    def stage_public_ssh(self) -> None:
        if self.after_wipe("check-public-ssh.sh"):
            return
        argv = [str(SCRIPT_DIR / "check-public-ssh.sh"), self.profile.target]
        if not self.apply:
            self.plan("check-public-ssh.sh")
            return
        result = self.run_cmd(argv, check=False)
        if result.returncode == 0:
            return
        probe = self.probe_ssh()
        if probe.default_class == "passphrase":
            raise Fail("operator key still locked; rerun after ssh-add")
        if probe.default_class == "publickey":
            raise Fail(
                "guest rejected the operator key; use VNC, set-password, "
                "or --reinstall with the verified pubkey"
            )
        raise Fail(f"public SSH failed ({probe.default_class})")

    def stage_audit(self) -> None:
        if self.after_wipe("audit-vps.sh"):
            return
        argv = [str(SCRIPT_DIR / "audit-vps.sh"), self.profile.target]
        if self.apply:
            self.run_cmd(argv)
        else:
            self.plan("audit-vps.sh")

    def stage_bootstrap(self) -> None:
        if self.after_wipe("bootstrap-debian.sh"):
            return
        if self.remote_ok(
            "sudo test -s /etc/ssh/sshd_config.d/99-vps-hardening.conf && "
            "id svc-public >/dev/null 2>&1 && id svc-internal >/dev/null 2>&1 && "
            "systemctl is-active --quiet nftables caddy"
        ):
            self.skip("bootstrap", "already applied")
            return
        if not self.apply:
            self.plan("bootstrap-debian.sh --apply")
            return
        self.run_cmd(
            [
                "scp",
                "-q",
                *self.ssh_control_options,
                str(SCRIPT_DIR / "bootstrap-debian.sh"),
                str(SCRIPT_DIR / "setup-log.sh"),
                f"{self.profile.target}:/tmp/",
            ]
        )
        self.ssh_long(
            "sudo bash /tmp/bootstrap-debian.sh --apply "
            f"--admin-user {self.profile.admin_user}",
            spinner="bootstrap (apt + hardening)",
            log_name="bootstrap.out",
        )
        run_parallel(
            [
                (
                    "public-ssh",
                    lambda: self.run_cmd(
                        [str(SCRIPT_DIR / "check-public-ssh.sh"), self.profile.target]
                    ),
                ),
                (
                    "setup-log",
                    lambda: self.run_cmd(
                        [str(SCRIPT_DIR / "sync-vps-setup-log.sh"), self.profile.target]
                    ),
                ),
            ]
        )
        self.state.did_bootstrap = True
        save_state(self.state)

    def stage_control_plane(self) -> None:
        if self.after_wipe("install-netbird-podman.sh"):
            return
        if self.remote_ok(
            "sudo test -s /opt/netbird/config.yaml && "
            "systemctl is-active --quiet caddy netbird-podman"
        ):
            self.skip("control_plane", "already installed")
            return
        if not self.apply:
            self.plan("install-netbird-podman.sh --apply")
            return
        detected: dict[str, str] = {}
        run_parallel(
            [
                ("setup-ip", lambda: detected.update(ip=self.public_ipify())),
                (
                    "scp",
                    lambda: self.run_cmd(
                        [
                            "scp",
                            "-q",
                            *self.ssh_control_options,
                            str(SCRIPT_DIR / "install-netbird-podman.sh"),
                            str(SCRIPT_DIR / "setup-log.sh"),
                            str(SCRIPT_DIR / "configure-netbird-setup-guard.sh"),
                            str(SCRIPT_DIR / "netbird-setup-guard.sh"),
                            f"{self.profile.target}:/tmp/",
                        ]
                    ),
                ),
            ]
        )
        setup_ip = detected["ip"]
        self.ssh_long(
            "sudo bash /tmp/install-netbird-podman.sh --apply "
            f"{self.profile.domain} --setup-source-ip {setup_ip}",
            spinner="install NetBird/Podman",
            log_name="control-plane.out",
        )
        self.run_cmd([str(SCRIPT_DIR / "sync-vps-setup-log.sh"), self.profile.target])
        self.state.did_control_plane = True
        save_state(self.state)

    def stage_verify_control_plane(self) -> None:
        if self.after_wipe("verify-netbird.sh"):
            return
        argv = [
            str(SCRIPT_DIR / "verify-netbird.sh"),
            self.profile.target,
            self.profile.domain,
        ]
        if not self.apply:
            self.plan("verify-netbird.sh")
            return
        deadline = time.time() + 300
        last = 1
        with Spinner("waiting for ACME / verify-netbird"):
            while time.time() < deadline:
                result = self.run_cmd(argv, check=False, capture=True)
                last = result.returncode
                if last == 0:
                    break
                time.sleep(15)
            else:
                raise Fail("verify-netbird.sh failed after waiting for ACME")

    def stage_reboot(self) -> None:
        if self.after_wipe("reboot and re-verify"):
            return
        want = self.profile.reboot and not self.args.no_reboot
        if not want:
            self.skip("reboot", "disabled")
            return
        if self.state.rebooted:
            self.skip("reboot", "already rebooted")
            return
        mutated = self.state.did_bootstrap or self.state.did_control_plane or self.state.did_reinstall
        if not mutated:
            self.skip("reboot", "no host mutation this run")
            return
        if not self.apply:
            self.plan("reboot once and re-verify public SSH + NetBird")
            return
        self.ssh("sudo reboot", check=False)
        deadline = time.time() + 360
        with Spinner("waiting for reboot"):
            while time.time() < deadline:
                time.sleep(8)
                if self.ssh("true", check=False).returncode == 0:
                    break
            else:
                raise Fail("host did not return after reboot")
        run_parallel(
            [
                (
                    "public-ssh",
                    lambda: self.run_cmd(
                        [str(SCRIPT_DIR / "check-public-ssh.sh"), self.profile.target]
                    ),
                ),
                (
                    "verify-netbird",
                    lambda: self.run_cmd(
                        [
                            str(SCRIPT_DIR / "verify-netbird.sh"),
                            self.profile.target,
                            self.profile.domain,
                        ]
                    ),
                ),
            ]
        )
        self.state.rebooted = True
        save_state(self.state)

    def pat_ok(self) -> bool:
        try:
            config = load_config()
        except AppError:
            return False
        if not config.api_key:
            return False
        from netbird_setup import api_request

        try:
            api_request(config.management_url, config.api_key, "GET", "/api/groups")
        except AppError:
            return False
        return True

    def stage_owner_pat(self) -> None:
        if self.after_wipe("owner PAT at /setup"):
            return
        if self.pat_ok():
            self.skip("owner_pat", "NETBIRD_API_KEY works")
            return
        if not self.apply:
            self.plan("create owner at /setup and store NETBIRD_API_KEY")
            return
        url = f"https://{self.profile.domain}/setup"
        say("First owner + PAT are required. The token is not printed.", CYAN)
        say("Dashboard → create owner → Personal Access Tokens → create", CYAN)
        say(f"Meanwhile on this PC: {self.operator_up_command()}", CYAN)
        self.open_url(url)
        env_path = SCRIPT_DIR.parent / ".env.netbird"
        example = NETBIRD_DIR / ".env.netbird.example"
        if not env_path.is_file() and example.is_file():
            atomic_write(env_path, example.read_text(), mode=0o600)
        existing = env_path.read_text() if env_path.is_file() else ""
        token = self.ask_secret("NETBIRD_API_KEY")
        atomic_write(
            env_path,
            upsert_env(existing or "NETBIRD_MANAGEMENT_URL=\n", "NETBIRD_API_KEY", token),
            mode=0o600,
        )
        os.environ["NETBIRD_API_KEY"] = token
        if not self.pat_ok():
            raise Fail("PAT did not authenticate GET /api/groups")

    def operator_up_command(self) -> str:
        return f"netbird up --management-url https://{self.profile.domain}"

    def stage_operator_up(self) -> None:
        if self.after_wipe("operator netbird up"):
            return
        url = f"https://{self.profile.domain}"
        command = self.operator_up_command()
        if local_netbird_connected(url):
            self.skip("operator_up", f"connected to {url}")
            return
        say("This PC is not on the new management URL yet.", CYAN)
        say(f"Run:  {command}", BOLD, CYAN)
        say(
            f"Admin peer {self.profile.admin_peer or 'this host'} must then "
            "appear connected in the dashboard.",
            DIM,
        )
        if not self.apply:
            self.plan(command)
            return
        if not tty_io():
            raise Fail(f"connect this PC first: {command}")
        while not local_netbird_connected(url):
            say("Press Enter after that command succeeds, or Ctrl-C to abort", CYAN)
            try:
                input()
            except EOFError as error:
                raise Fail(f"connect this PC first: {command}") from error
            if local_netbird_connected(url):
                break
            say(f"still not connected to {url}", RED)
        say(f"PASS operator NetBird connected to {url}", GREEN)

    def stage_host_join(self) -> None:
        if self.after_wipe("netbird_host_reconcile.py"):
            return
        if self.apply and not local_netbird_connected(f"https://{self.profile.domain}"):
            raise Fail(
                "this PC is not on the new management; "
                f"run {self.operator_up_command()} then rerun"
            )
        argv = [
            sys.executable,
            str(NETBIRD_DIR / "netbird_host_reconcile.py"),
            "--target",
            self.profile.target,
            "--host-selector",
            self.profile.host_selector,
            "--host-group",
            self.profile.host_group,
            "--admin-group",
            self.profile.admin_group,
            "--enable-ssh",
        ]
        if self.profile.admin_peer:
            argv.extend(
                ["--admin-peer", self.profile.admin_peer, "--disable-default"]
            )
        if self.profile.access_spec:
            argv.extend(["--spec", str(self.profile.access_spec)])
        if self.apply:
            argv.append("--apply")
        self.run_netbird_reconcile(argv, "host-reconcile.out", save_overlay=True)

    def stage_image_join(self) -> None:
        if not self.profile.image_target:
            self.skip("image_join", "no image_target")
            return
        argv = [
            sys.executable,
            str(NETBIRD_DIR / "netbird_host_reconcile.py"),
            "--target",
            self.profile.image_target,
            "--host-selector",
            self.profile.image_selector or self.profile.image_target,
            "--host-group",
            self.profile.image_group,
            "--admin-group",
            self.profile.admin_group,
            "--key-name",
            "image-join",
        ]
        if self.profile.image_user:
            argv.extend(["--ssh-user", self.profile.image_user])
        if self.apply:
            argv.append("--apply")
        self.run_netbird_reconcile(argv, "image-reconcile.out", save_overlay=False)

    def stage_employee_keys(self) -> None:
        if not self.profile.employee_roster:
            self.skip("employee_keys", "no employee_roster")
            return
        argv = [
            sys.executable,
            str(NETBIRD_DIR / "netbird_setup.py"),
            "employees",
            "--roster",
            str(self.profile.employee_roster),
        ]
        if self.apply:
            argv.append("--apply")
        log_path = state_path(self.profile.target).with_name("employee-keys.out")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as handle:
            result = subprocess.run(
                argv,
                text=True,
                env=self.env,
                stdout=handle,
                stderr=subprocess.STDOUT,
            )
        output = log_path.read_text(encoding="utf-8")
        if "NETBIRD_API_KEY=" in output or "discord.com/api/webhooks" in output.lower():
            raise Fail("employee key log would contain a secret")
        sys.stderr.write(output)
        if result.returncode != 0:
            fail_line = ""
            for line in reversed(output.splitlines()):
                if line.startswith("error:") or line.startswith("FAIL "):
                    fail_line = line
                    break
            raise Fail(fail_line or "employee key mint failed")

    def run_netbird_reconcile(
        self, argv: list[str], log_name: str, *, save_overlay: bool
    ) -> None:
        log_path = state_path(self.profile.target).with_name(log_name)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as handle:
            result = subprocess.run(
                argv,
                text=True,
                env=self.env,
                stdout=handle,
                stderr=subprocess.STDOUT,
            )
        output = log_path.read_text(encoding="utf-8")
        sys.stderr.write(output)
        if result.returncode != 0:
            fail_line = ""
            for line in reversed(output.splitlines()):
                if line.startswith("FAIL "):
                    fail_line = line[5:].strip()
                    break
            hint = ""
            lowered = (fail_line or output).lower()
            if "admin peer" in lowered or "data-plane" in lowered or "netbird ssh" in lowered:
                hint = f"; on this PC run {self.operator_up_command()}"
            raise Fail((fail_line or "netbird_host_reconcile.py failed") + hint)
        if not save_overlay:
            return
        overlay = ""
        for line in output.splitlines():
            if line.startswith("RESULT overlay_ip="):
                overlay = line.split("=", 1)[1].strip()
        if overlay:
            self.state.overlay_ip = overlay
            save_state(self.state)

    def stage_early_warning(self) -> None:
        if self.after_wipe("early-warning/apply.sh"):
            return
        if not self.profile.early_warning:
            self.skip("early_warning", "disabled")
            return
        if self.remote_ok(
            "sudo test -x /home/debian/vps-early-warning/verify.sh && "
            "sudo bash /home/debian/vps-early-warning/verify.sh >/dev/null"
        ):
            self.skip("early_warning", "already healthy")
            return
        sender = resolve_sender_env(self.profile, self.profile.sender_env)
        if sender is None or not sender_present(sender):
            if not self.apply:
                self.plan("copy Discord webhook and apply early-warning")
                return
            if not tty_io():
                raise Fail("missing sender env; pass --sender-env")
            raw = self.ask_secret("path to sender env file")
            sender = expand(raw)
            if not sender_present(sender):
                raise Fail("Discord webhook missing in that file")
        if not self.apply:
            self.plan(f"copy sender env from {sender} without printing secrets")
            self.plan("early-warning/apply.sh")
            return
        self.run_cmd(
            [
                sys.executable,
                str(SCRIPT_DIR / "early-warning" / "copy-sender.py"),
                "--target",
                self.profile.target,
                "--source",
                str(sender),
            ]
        )
        self.run_cmd(
            [str(SCRIPT_DIR / "early-warning" / "apply.sh"), self.profile.target],
            spinner="early-warning apply",
        )

    def stage_overlay_alias(self) -> None:
        if self.after_wipe("manage-ssh-alias.py"):
            return
        overlay = self.state.overlay_ip
        if not overlay and not self.apply:
            self.plan("read wt0 and manage-ssh-alias.py")
            return
        if not overlay:
            result = self.ssh(
                "ip -4 -o addr show wt0 | awk '{split($4,a,\"/\"); print a[1]; exit}'",
                check=False,
            )
            overlay = result.stdout.strip()
        if not overlay.startswith("100."):
            raise Fail("joined host has no wt0 IPv4")
        argv = [
            sys.executable,
            str(SCRIPT_DIR / "manage-ssh-alias.py"),
            "--source",
            self.profile.target,
            "--alias",
            self.profile.overlay_alias,
            "--hostname",
            overlay,
        ]
        if self.apply:
            argv.append("--apply")
            self.run_cmd(argv)
            self.run_cmd(
                [
                    "ssh",
                    "-T",
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=10",
                    *self.ssh_control_options,
                    self.profile.overlay_alias,
                    "whoami",
                ]
            )
        else:
            self.plan(f"manage-ssh-alias.py {self.profile.overlay_alias} {overlay}")
        self.state.overlay_ip = overlay
        save_state(self.state)

    def stage_final(self) -> None:
        if self.after_wipe("final verify"):
            return
        report = state_path(self.profile.target).with_name("report.md")
        if not self.apply:
            self.plan("check-public-ssh + verify-netbird + early-warning")
            self.plan(f"write {report}")
            return
        jobs: list[tuple[str, Callable[[], Any]]] = [
            (
                "public-ssh",
                lambda: self.run_cmd(
                    [str(SCRIPT_DIR / "check-public-ssh.sh"), self.profile.target]
                ),
            ),
            (
                "verify-netbird",
                lambda: self.run_cmd(
                    [
                        str(SCRIPT_DIR / "verify-netbird.sh"),
                        self.profile.target,
                        self.profile.domain,
                    ]
                ),
            ),
            (
                "setup-log",
                lambda: self.run_cmd(
                    [str(SCRIPT_DIR / "sync-vps-setup-log.sh"), self.profile.target]
                ),
            ),
        ]
        if self.profile.early_warning:
            jobs.append(
                (
                    "early-warning",
                    lambda: self.ssh(
                        "sudo bash /home/debian/vps-early-warning/verify.sh"
                    ),
                )
            )
        run_parallel(jobs)
        written = self.write_completion_report(report)
        say(
            "PASS reconciliation complete; public TCP 22 remains the outage path",
            GREEN,
            BOLD,
        )
        say("no application was deployed", DIM)
        say(f"wrote {written}", GREEN)

    def write_completion_report(self, path: Path) -> Path:
        probe = probe_request()
        self.run_cmd(
            [
                "scp",
                "-q",
                *self.ssh_control_options,
                str(SCRIPT_DIR / "final-report-facts.py"),
                f"{self.profile.target}:/tmp/init-vps-report-facts.py",
            ]
        )
        result = self.run_cmd(
            [
                "ssh",
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "RequestTTY=no",
                *self.ssh_control_options,
                self.profile.target,
                "cat > /tmp/init-vps-report-probe.json && "
                "sudo python3 /tmp/init-vps-report-facts.py /tmp/init-vps-report-probe.json",
            ],
            capture=True,
            input_text=json.dumps(probe) + "\n",
        )
        blob = (result.stdout or "") + "\n" + (result.stderr or "")
        facts = None
        for line in reversed(blob.splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                facts = json.loads(line)
                break
        if not isinstance(facts, dict):
            raise Fail("final-report-facts.py produced no JSON")
        text = render_report(
            {
                "target": self.profile.target,
                "generated": utc_now(),
                "domain": self.profile.domain,
                "public_ip": self.profile.expected_public_ip,
                "overlay_ip": self.state.overlay_ip,
                "early_warning": self.profile.early_warning,
            },
            facts,
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path


STAGES: dict[str, Callable[[Runner], None]] = {
    "preflight": Runner.stage_preflight,
    "ssh_agent": Runner.stage_ssh_agent,
    "reinstall": Runner.stage_reinstall,
    "public_hostname": Runner.stage_public_hostname,
    "wait_sshd": Runner.stage_wait_sshd,
    "repair_known_hosts": Runner.stage_repair_known_hosts,
    "public_ssh": Runner.stage_public_ssh,
    "audit": Runner.stage_audit,
    "bootstrap": Runner.stage_bootstrap,
    "control_plane": Runner.stage_control_plane,
    "verify_control_plane": Runner.stage_verify_control_plane,
    "reboot": Runner.stage_reboot,
    "owner_pat": Runner.stage_owner_pat,
    "operator_up": Runner.stage_operator_up,
    "host_join": Runner.stage_host_join,
    "image_join": Runner.stage_image_join,
    "employee_keys": Runner.stage_employee_keys,
    "early_warning": Runner.stage_early_warning,
    "overlay_alias": Runner.stage_overlay_alias,
    "final": Runner.stage_final,
}


def print_status(state: State) -> None:
    say(f"target {state.target}  updated {state.updated_at or '-'}", BOLD)
    if state.failed_stage:
        say(f"failed {state.failed_stage}: {state.failed_error}", RED)
    current_section = ""
    for stage in STAGE_IDS:
        sect = SECTIONS[stage]
        if sect != current_section:
            say(f"{sect}", BOLD, CYAN)
            current_section = sect
        if stage in state.completed:
            flag = paint("done", GREEN, stream=sys.stderr)
        elif stage == state.failed_stage:
            flag = paint("fail", RED, stream=sys.stderr)
        else:
            flag = paint("todo", DIM, stream=sys.stderr)
        print(f"  {flag}  {stage}", file=sys.stderr)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="init-vps",
        description=HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("command", nargs="?", choices=("status",))
    parser.add_argument("--profile", default="ovh-vps")
    parser.add_argument("--target")
    parser.add_argument("--admin-user")
    parser.add_argument("--domain")
    parser.add_argument("--setup-source-ip")
    parser.add_argument("--host-selector")
    parser.add_argument("--host-group")
    parser.add_argument("--admin-group")
    parser.add_argument("--admin-peer")
    parser.add_argument("--overlay-alias")
    parser.add_argument("--ovh-service")
    parser.add_argument("--expected-public-ip")
    parser.add_argument("--image-id")
    parser.add_argument("--pubkey", type=Path)
    parser.add_argument("--sender-env", type=Path)
    parser.add_argument("--discord-env", type=Path, help="alias of --sender-env")
    parser.add_argument("--from", dest="start_from", metavar="STAGE")
    parser.add_argument("--repair-known-hosts", action="store_true")
    parser.add_argument("--reinstall", action="store_true")
    parser.add_argument("--early-warning", action="store_true")
    parser.add_argument("--no-early-warning", action="store_true")
    parser.add_argument("--reboot", action="store_true")
    parser.add_argument("--no-reboot", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--reset", action="store_true")
    return parser.parse_args(argv)


def apply_overrides(profile: Profile, args: argparse.Namespace) -> Profile:
    if args.target:
        profile.target = args.target
    if args.admin_user:
        profile.admin_user = args.admin_user
    if args.domain:
        profile.domain = args.domain
    if args.setup_source_ip:
        profile.setup_source_ip = args.setup_source_ip
    if args.host_selector:
        profile.host_selector = args.host_selector
    if args.host_group:
        profile.host_group = args.host_group
    if args.admin_group:
        profile.admin_group = args.admin_group
    if args.admin_peer:
        profile.admin_peer = args.admin_peer
    if args.overlay_alias:
        profile.overlay_alias = args.overlay_alias
    if args.ovh_service:
        profile.ovh_service = args.ovh_service
    if args.expected_public_ip:
        profile.expected_public_ip = args.expected_public_ip
    if args.image_id:
        profile.image_id = args.image_id
    if args.pubkey:
        profile.pubkey = expand(args.pubkey)
    if args.no_early_warning:
        profile.early_warning = False
    elif args.early_warning:
        profile.early_warning = True
    if args.no_reboot:
        profile.reboot = False
    elif args.reboot:
        profile.reboot = True
    sender = args.sender_env or args.discord_env
    if sender:
        profile.sender_env = expand(sender)
    return profile


def run_pipeline(runner: Runner) -> int:
    start_from = runner.args.start_from
    if start_from:
        if start_from not in STAGE_IDS:
            raise Fail(f"unknown stage: {start_from}")
        before = list(STAGE_IDS[: STAGE_IDS.index(start_from)])
        runner.state.completed = [
            item for item in runner.state.completed if item in before
        ]
        for item in before:
            if item not in runner.state.completed:
                runner.state.completed.append(item)
        save_state(runner.state)

    mode = "APPLY" if runner.apply else "PLAN"
    say(f"init-vps  {runner.profile.name} → {runner.profile.expected_public_ip}", BOLD)
    say(f"mode {mode}", CYAN if not runner.apply else GREEN)
    if runner.state.failed_stage:
        say(
            f"resume after {runner.state.failed_stage}: {runner.state.failed_error}",
            RED,
        )

    current_section = ""
    seen: set[str] = set()
    pending = pending_stages(
        runner.state.completed,
        failed_stage=runner.state.failed_stage,
        start_from=start_from,
    )
    for stage in pending:
        if stage in seen:
            continue
        peers = tuple(
            item for item in parallel_peers(stage, start_from) if item in pending
        ) or (stage,)
        seen.update(peers)
        sect = SECTIONS[stage]
        if sect != current_section:
            section(sect)
            current_section = sect
        label = " + ".join(peers)
        say(f"-- {label}", BOLD)
        if len(peers) == 1:
            code = run_one_stage(runner, stage)
            if code:
                return code
            continue
        code = run_peer_stages(runner, peers)
        if code:
            return code
    return 0


def run_one_stage(runner: Runner, stage: str) -> int:
    runner._tls.planned = False
    runner._planned = False
    try:
        STAGES[stage](runner)
    except Fail as error:
        mark_failed(runner.state, stage, str(error))
        say(f"FAIL {stage}: {error}", RED, BOLD)
        say("rerun init-vps --apply to resume", DIM)
        return 1
    except subprocess.TimeoutExpired:
        mark_failed(runner.state, stage, "timeout")
        say(f"FAIL {stage}: timeout", RED, BOLD)
        return 1
    except KeyboardInterrupt:
        mark_failed(runner.state, stage, "interrupted")
        say(f"FAIL {stage}: interrupted", RED)
        return 130
    if runner.apply and not runner.consume_planned():
        mark_done(runner.state, stage)
    return 0


def run_peer_stages(runner: Runner, peers: tuple[str, ...]) -> int:
    planned: dict[str, bool] = {}
    errors: dict[str, BaseException] = {}

    def run(name: str) -> None:
        runner._tls.planned = False
        try:
            STAGES[name](runner)
            planned[name] = bool(getattr(runner._tls, "planned", False))
        except BaseException as exc:  # noqa: BLE001
            errors[name] = exc

    with ThreadPoolExecutor(max_workers=len(peers)) as pool:
        list(pool.map(run, peers))
    if errors:
        name, exc = next(iter(errors.items()))
        if isinstance(exc, KeyboardInterrupt):
            mark_failed(runner.state, name, "interrupted")
            say(f"FAIL {name}: interrupted", RED)
            return 130
        detail = "timeout" if isinstance(exc, subprocess.TimeoutExpired) else str(exc)
        mark_failed(runner.state, name, detail)
        say(f"FAIL {name}: {detail}", RED, BOLD)
        say("rerun init-vps --apply to resume", DIM)
        return 1
    if runner.apply:
        for name in peers:
            if not planned.get(name):
                mark_done(runner.state, name)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        profile = apply_overrides(load_profile(args.profile), args)
        if args.reset:
            path = state_path(profile.target)
            if path.exists():
                path.unlink()
            say(f"reset {path}", GREEN)
            if args.command != "status" and not args.apply and not args.reinstall:
                return 0
        if args.command == "status":
            print_status(load_state(profile.target, profile.name))
            return 0
        return run_pipeline(Runner(profile, args))
    except Fail as error:
        say(f"error: {error}", RED)
        return 1
    except AppError as error:
        say(f"error: {error}", RED)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
