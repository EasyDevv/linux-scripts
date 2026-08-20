#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import select
import shutil
import signal
import stat
import sys
import termios
import tty
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TextIO

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / ".env.netbird"
KEYS_PATH = SCRIPT_DIR / ".env.netbird.setup-keys"
MSI_CACHE = SCRIPT_DIR / ".data" / "netbird_installer_windows_amd64.msi"
MSI_NAME = "netbird_installer_windows_amd64.msi"
MSI_URL = "https://pkgs.netbird.io/windows/msi/x64"
DEFAULT_MANAGEMENT_URL = "https://vps-a851fbbf.vps.ovh.us"
DEFAULT_AUTO_GROUP = "employees"
DEFAULT_EXPIRES_IN = 604800
DEFAULT_USAGE_LIMIT = 1
USB_PAYLOAD_DIR = "netbird-setup"
USB_KEYS_NAME = ".env.netbird.setup.keys"
WINDOWS_DIR = SCRIPT_DIR / "windows"
WINDOWS_PS1_NAME = "install-netbird.ps1"
WINDOWS_CMD_NAME = "install-netbird.cmd"
WINDOWS_README_NAME = "README.md"
NETBIRD_EXE = r"%ProgramFiles%\NetBird\netbird.exe"
WINGET_ID = "NetBird.NetBird"
KEY_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
ENV_LINE_RE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
RESERVED_NAMES = {
    "NETBIRD_API_KEY",
    "NETBIRD_MANAGEMENT_URL",
    "NETBIRD_AUTO_GROUP",
}
OLD_KEY_PREFIX = "NETBIRD_SETUP_KEY_"
MEDIA_PREFIXES = ("/run/media/", "/media/", "/mnt/")

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
CYAN = "\033[36m"
RED = "\033[31m"
HELP = """\
netbird-setup - issue NetBird setup keys and write a Windows USB installer

Usage:
  netbird-setup issue [NAME] [--replace]
  netbird-setup usb [--dest PATH]
  netbird-setup list
  netbird-setup --help

Keys are stored as NAME=value in .env.netbird.setup-keys (for example GREEN_HOME_PC=).
issue mints a one-off employees key (usage_limit 1, 7 days).
usb copies the key file and an interactive Windows installer onto a mounted USB.
The Windows script reads .env.netbird.setup.keys, lets you pick a key, then runs netbird up.

Non-TTY:
  issue requires NAME. Existing names need --replace.
  usb requires --dest.
"""


@dataclass(frozen=True)
class Config:
    api_key: str
    management_url: str
    auto_group: str
    config_path: Path
    keys_path: Path


@dataclass(frozen=True)
class Choice:
    id: str
    label: str
    detail: str = ""
    color: str = CYAN


@dataclass(frozen=True)
class UsbVolume:
    device: str
    mountpoint: Path
    label: str
    size: str
    model: str

    @property
    def choice_id(self) -> str:
        return str(self.mountpoint)

    @property
    def choice_label(self) -> str:
        name = self.label or self.mountpoint.name or self.device
        extra = "  ".join(part for part in (self.size, self.model) if part)
        return f"{name}  {self.mountpoint}" + (f"  {extra}" if extra else "")


class AppError(Exception):
    pass


def color_enabled(stream: TextIO) -> bool:
    return stream.isatty() and os.environ.get("NO_COLOR") is None


def paint(text: str, *styles: str, stream: TextIO = sys.stderr) -> str:
    if not styles or not color_enabled(stream):
        return text
    return f"{''.join(styles)}{text}{RESET}"


def strip_wrapping_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = ENV_LINE_RE.match(line)
        if match is None:
            continue
        values[match.group(1)] = strip_wrapping_quotes(match.group(2))
    return values


def load_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    return parse_env(path.read_text())


def env_header(management_url: str, auto_group: str) -> str:
    return (
        "# One-off setup keys. Do not commit. Do not print.\n"
        f"# management: {management_url}\n"
        f"# auto-group: {auto_group}\n"
        f"# type: one-off, usage_limit: {DEFAULT_USAGE_LIMIT}, "
        f"expires_in: {DEFAULT_EXPIRES_IN}\n"
    )


def upsert_env(text: str, name: str, value: str) -> str:
    assignment = f"{name}={value}"
    lines = text.splitlines()
    replaced = False
    out: list[str] = []
    for line in lines:
        match = ENV_LINE_RE.match(line.strip())
        if match is not None and match.group(1) == name:
            out.append(assignment)
            replaced = True
        else:
            out.append(line)
    if not replaced:
        if out and out[-1] != "":
            out.append("")
        out.append(assignment)
    return "\n".join(out) + "\n"


def atomic_write(path: Path, text: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text)
    tmp.chmod(mode)
    tmp.replace(path)
    path.chmod(mode)


def normalize_key_name(raw: str) -> str:
    name = raw.strip().upper()
    if name.startswith(OLD_KEY_PREFIX):
        name = name[len(OLD_KEY_PREFIX) :]
    if not KEY_NAME_RE.fullmatch(name):
        raise AppError(
            "key name must look like GREEN_USER_01 "
            "(uppercase letters, digits, underscore)"
        )
    if name in RESERVED_NAMES:
        raise AppError(f"key name is reserved: {name}")
    return name


def first_mount(device: dict[str, Any]) -> str | None:
    mountpoint = device.get("mountpoint")
    if isinstance(mountpoint, str) and mountpoint:
        return mountpoint
    mountpoints = device.get("mountpoints")
    if isinstance(mountpoints, list):
        for item in mountpoints:
            if isinstance(item, str) and item:
                return item
    return None


def is_usb_device(tran: str | None, rm: bool, mount: str | None) -> bool:
    if tran == "usb":
        return True
    if rm and mount is not None and mount.startswith(MEDIA_PREFIXES):
        return True
    return False


def parse_lsblk(payload: dict[str, Any]) -> list[UsbVolume]:
    found: list[UsbVolume] = []

    def walk(
        devices: list[dict[str, Any]],
        inherited_tran: str | None,
        inherited_rm: bool,
        inherited_model: str,
    ) -> None:
        for device in devices:
            if not isinstance(device, dict):
                continue
            tran = device.get("tran") or inherited_tran
            rm = bool(device.get("rm")) or inherited_rm
            model = str(device.get("model") or inherited_model or "").strip()
            children = device.get("children") or []
            mount = first_mount(device)
            kind = device.get("type")
            if (
                mount
                and is_usb_device(tran, rm, mount)
                and kind in {None, "part", "crypt", "lvm", "disk"}
            ):
                if kind == "disk" and children:
                    pass
                else:
                    found.append(
                        UsbVolume(
                            device=str(device.get("name") or ""),
                            mountpoint=Path(mount),
                            label=str(device.get("label") or "").strip(),
                            size=str(device.get("size") or "").strip(),
                            model=model,
                        )
                    )
            if isinstance(children, list) and children:
                walk(children, tran, rm, model)

    blockdevices = payload.get("blockdevices") or []
    if isinstance(blockdevices, list):
        walk(blockdevices, None, False, "")
    unique: list[UsbVolume] = []
    seen: set[str] = set()
    for volume in found:
        key = str(volume.mountpoint)
        if key in seen:
            continue
        seen.add(key)
        unique.append(volume)
    return unique


def list_usb_volumes(lsblk_json: str | None = None) -> list[UsbVolume]:
    if lsblk_json is None:
        proc = shutil.which("lsblk")
        if proc is None:
            raise AppError("lsblk is required to discover USB volumes")
        import subprocess

        completed = subprocess.run(
            [
                proc,
                "-J",
                "-o",
                "NAME,LABEL,SIZE,MOUNTPOINT,MOUNTPOINTS,TRAN,RM,TYPE,MODEL",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            raise AppError("failed to list block devices")
        lsblk_json = completed.stdout
    try:
        payload = json.loads(lsblk_json)
    except json.JSONDecodeError as error:
        raise AppError("failed to parse lsblk json") from error
    if not isinstance(payload, dict):
        raise AppError("failed to parse lsblk json")
    return parse_lsblk(payload)


def classify_key(first: bytes, rest: bytes = b"") -> str | None:
    if not first or first in {b"\x03", b"\x04", b"q", b"Q"}:
        return "QUIT"
    if first in {b"\r", b"\n"}:
        return "ENTER"
    if first in {b"j", b"J"}:
        return "DOWN"
    if first in {b"k", b"K"}:
        return "UP"
    if first == b"g":
        return "FIRST"
    if first == b"G":
        return "LAST"
    if first != b"\x1b":
        return None
    if not rest:
        return "QUIT"
    if rest in {b"[A", b"OA"}:
        return "UP"
    if rest in {b"[B", b"OB"}:
        return "DOWN"
    if rest in {b"[H", b"[1~", b"OH"}:
        return "FIRST"
    if rest in {b"[F", b"[4~", b"OF"}:
        return "LAST"
    return "QUIT"


def read_key(file_descriptor: int) -> str | None:
    first = os.read(file_descriptor, 1)
    rest = b""
    if first == b"\x1b":
        while True:
            ready, _, _ = select.select([file_descriptor], [], [], 0.05)
            if not ready:
                break
            rest += os.read(file_descriptor, 1)
    return classify_key(first, rest)


def pick(
    title: str,
    choices: list[Choice],
    *,
    stdin: TextIO = sys.stdin,
    stderr: TextIO = sys.stderr,
) -> Choice | None:
    if not stdin.isatty() or not stderr.isatty():
        raise AppError("an interactive terminal is required")
    if not choices:
        raise AppError("nothing to select")

    file_descriptor = stdin.fileno()
    current = 0
    previous_lines = 0
    original = termios.tcgetattr(file_descriptor)
    stderr.write("\033[?25l")
    stderr.flush()

    def draw() -> None:
        nonlocal previous_lines
        width = shutil.get_terminal_size(fallback=(80, 24)).columns
        lines = [
            paint(title, BOLD, stream=stderr),
            "",
        ]
        for index, choice in enumerate(choices):
            marker = ">" if index == current else " "
            body = choice.label
            if choice.detail:
                body = f"{body}  {choice.detail}"
            styles = (BOLD, choice.color) if index == current else (choice.color,)
            line = f"{marker} {paint(body, *styles, stream=stderr)}"
            lines.append(line[: max(1, width - 1)])
        lines.append("")
        lines.append(
            paint("↑/↓ move  enter select  q abort", DIM, stream=stderr)
        )
        if previous_lines > 1:
            stderr.write(f"\033[{previous_lines - 1}F")
        elif previous_lines == 1:
            stderr.write("\r")
        for index, line in enumerate(lines):
            stderr.write("\r\033[2K")
            stderr.write(line)
            if index < len(lines) - 1:
                stderr.write("\r\n")
        stderr.flush()
        previous_lines = len(lines)

    def on_resize(_signum: int, _frame: object) -> None:
        draw()

    previous_handler = signal.getsignal(signal.SIGWINCH)
    signal.signal(signal.SIGWINCH, on_resize)
    selected: Choice | None = None
    try:
        tty.setraw(file_descriptor)
        draw()
        while True:
            action = read_key(file_descriptor)
            if action == "UP":
                current = (current - 1) % len(choices)
            elif action == "DOWN":
                current = (current + 1) % len(choices)
            elif action == "FIRST":
                current = 0
            elif action == "LAST":
                current = len(choices) - 1
            elif action == "ENTER":
                selected = choices[current]
                break
            elif action == "QUIT":
                break
            else:
                continue
            draw()
    finally:
        signal.signal(signal.SIGWINCH, previous_handler)
        termios.tcsetattr(file_descriptor, termios.TCSADRAIN, original)
        stderr.write("\033[?25h\r\n")
        stderr.flush()
    return selected


def confirm_no(
    question: str,
    *,
    stdin: TextIO = sys.stdin,
    stderr: TextIO = sys.stderr,
) -> bool:
    choice = pick(
        question,
        [
            Choice(id="no", label="No", color=DIM),
            Choice(id="yes", label="Yes", color=RED),
        ],
        stdin=stdin,
        stderr=stderr,
    )
    return choice is not None and choice.id == "yes"


def load_config(
    environ: dict[str, str] | None = None,
    config_path: Path = CONFIG_PATH,
    keys_path: Path = KEYS_PATH,
    require_api_key: bool = True,
) -> Config:
    env = dict(os.environ if environ is None else environ)
    file_values = load_env_file(config_path)
    api_key = env.get("NETBIRD_API_KEY") or file_values.get("NETBIRD_API_KEY", "")
    management_url = (
        env.get("NETBIRD_MANAGEMENT_URL")
        or file_values.get("NETBIRD_MANAGEMENT_URL")
        or DEFAULT_MANAGEMENT_URL
    ).rstrip("/")
    auto_group = (
        env.get("NETBIRD_AUTO_GROUP")
        or file_values.get("NETBIRD_AUTO_GROUP")
        or DEFAULT_AUTO_GROUP
    )
    if require_api_key and not api_key:
        raise AppError(
            f"NETBIRD_API_KEY is required; copy {config_path.name}.example "
            f"to {config_path.name} and set the PAT"
        )
    return Config(
        api_key=api_key,
        management_url=management_url,
        auto_group=auto_group,
        config_path=config_path,
        keys_path=keys_path,
    )


def api_request(
    management_url: str,
    token: str,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> Any:
    url = f"{management_url.rstrip('/')}{path}"
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Authorization": f"Token {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise AppError("NetBird API token invalid (401)") from error
        raise AppError(f"NetBird API {method} {path} failed ({error.code})") from error
    except urllib.error.URLError as error:
        raise AppError("NetBird API request failed") from error
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise AppError("NetBird API returned invalid JSON") from error


def resolve_group_id(config: Config, request: Callable[..., Any] = api_request) -> str:
    payload = request(
        config.management_url,
        config.api_key,
        "GET",
        f"/api/groups?name={config.auto_group}",
    )
    groups = payload if isinstance(payload, list) else []
    if not groups:
        payload = request(config.management_url, config.api_key, "GET", "/api/groups")
        groups = payload if isinstance(payload, list) else []
    for group in groups:
        if isinstance(group, dict) and group.get("name") == config.auto_group:
            group_id = group.get("id")
            if isinstance(group_id, str) and group_id:
                return group_id
    raise AppError(f"NetBird group not found: {config.auto_group}")


def create_setup_key(
    config: Config,
    name: str,
    request: Callable[..., Any] = api_request,
) -> str:
    group_id = resolve_group_id(config, request=request)
    payload = request(
        config.management_url,
        config.api_key,
        "POST",
        "/api/setup-keys",
        {
            "name": name,
            "type": "one-off",
            "expires_in": DEFAULT_EXPIRES_IN,
            "auto_groups": [group_id],
            "usage_limit": DEFAULT_USAGE_LIMIT,
            "ephemeral": False,
        },
    )
    if not isinstance(payload, dict):
        raise AppError("NetBird API did not return a setup key")
    key = payload.get("key")
    if not isinstance(key, str) or not key:
        raise AppError("NetBird API did not return a setup key")
    return key


def save_setup_key(config: Config, name: str, key: str) -> Path:
    existing = ""
    if config.keys_path.is_file():
        existing = config.keys_path.read_text()
    if not existing.strip():
        existing = env_header(config.management_url, config.auto_group)
    updated = upsert_env(existing, name, key)
    try:
        atomic_write(config.keys_path, updated)
    except OSError:
        rescue = config.keys_path.with_name(f"{config.keys_path.name}.{name}.rescue")
        atomic_write(rescue, upsert_env(env_header(config.management_url, config.auto_group), name, key))
        raise AppError(
            f"failed to write {config.keys_path.name}; saved a rescue file next to it"
        )
    return config.keys_path


def list_key_names(keys_path: Path = KEYS_PATH) -> list[str]:
    values = load_env_file(keys_path)
    return [name for name in values if values[name] and name not in RESERVED_NAMES]


def read_setup_key(keys_path: Path, name: str) -> str:
    values = load_env_file(keys_path)
    key = values.get(name, "")
    if not key:
        raise AppError(f"setup key not found: {name}")
    return key


def render_windows_ps1() -> str:
    path = WINDOWS_DIR / WINDOWS_PS1_NAME
    if not path.is_file():
        raise AppError(f"missing {WINDOWS_PS1_NAME}")
    return path.read_text()


def render_windows_cmd() -> str:
    path = WINDOWS_DIR / WINDOWS_CMD_NAME
    if not path.is_file():
        raise AppError(f"missing {WINDOWS_CMD_NAME}")
    return path.read_text()


def render_windows_readme() -> str:
    path = SCRIPT_DIR / WINDOWS_README_NAME
    if not path.is_file():
        raise AppError(f"missing {WINDOWS_README_NAME}")
    return path.read_text()


def write_usb_payload(dest: Path, keys_path: Path) -> tuple[Path, Path, Path, Path]:
    env_dest = dest / USB_KEYS_NAME
    ps1_dest = dest / WINDOWS_PS1_NAME
    cmd_dest = dest / WINDOWS_CMD_NAME
    readme_dest = dest / WINDOWS_README_NAME
    shutil.copy2(keys_path, env_dest)
    atomic_write(ps1_dest, render_windows_ps1(), mode=0o644)
    atomic_write(cmd_dest, render_windows_cmd(), mode=0o644)
    atomic_write(readme_dest, render_windows_readme(), mode=0o644)
    return env_dest, ps1_dest, cmd_dest, readme_dest


def download_msi(dest: Path, url: str = MSI_URL) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "netbird-setup"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, tmp.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        if tmp.exists():
            tmp.unlink()
        raise AppError("failed to download the NetBird Windows MSI") from error
    tmp.replace(dest)


def ensure_msi(
    dest_dir: Path,
    cache: Path = MSI_CACHE,
    download: Callable[[Path], None] | None = None,
) -> Path | None:
    target = dest_dir / MSI_NAME
    if cache.is_file() and cache.stat().st_size > 0:
        shutil.copy2(cache, target)
        return target
    fetch = download or download_msi
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        fetch(cache)
    except AppError:
        return None
    if cache.is_file() and cache.stat().st_size > 0:
        shutil.copy2(cache, target)
        return target
    return None


def payload_dir(dest: Path) -> Path:
    if dest.name == USB_PAYLOAD_DIR:
        return dest
    return dest / USB_PAYLOAD_DIR


def is_writable_dir(path: Path) -> bool:
    try:
        if not path.is_dir():
            return False
        mode = path.stat().st_mode
        if stat.S_ISBLK(mode) or stat.S_ISCHR(mode):
            return False
        return os.access(path, os.W_OK)
    except OSError:
        return False


def resolve_name(
    raw: str | None,
    names: list[str] | None = None,
    *,
    stdin: TextIO = sys.stdin,
    stderr: TextIO = sys.stderr,
    prompt: bool = True,
) -> str:
    if raw:
        return normalize_key_name(raw)
    if not prompt or not stdin.isatty() or not stderr.isatty():
        raise AppError("NAME is required when stdin is not a TTY")
    if names:
        choice = pick(
            "Select setup key",
            [Choice(id=name, label=name, color=CYAN) for name in names],
            stdin=stdin,
            stderr=stderr,
        )
        if choice is None:
            raise AppError("aborted")
        return choice.id
    stderr.write("Key name (e.g. GREEN_USER_01): ")
    stderr.flush()
    typed = stdin.readline().strip()
    if not typed:
        raise AppError("key name is required")
    return normalize_key_name(typed)


def resolve_usb_dest(
    raw: str | None,
    *,
    stdin: TextIO = sys.stdin,
    stderr: TextIO = sys.stderr,
    volumes: list[UsbVolume] | None = None,
) -> Path:
    if raw:
        dest = Path(raw).expanduser().resolve()
        if not is_writable_dir(dest):
            raise AppError(f"destination is not a writable directory: {dest}")
        return dest
    if not stdin.isatty() or not stderr.isatty():
        raise AppError("--dest is required when stdin is not a TTY")
    found = list_usb_volumes() if volumes is None else volumes
    if not found:
        raise AppError("no mounted USB storage; mount one or pass --dest PATH")
    choice = pick(
        "Select USB storage",
        [
            Choice(id=volume.choice_id, label=volume.choice_label, color=GREEN)
            for volume in found
        ],
        stdin=stdin,
        stderr=stderr,
    )
    if choice is None:
        raise AppError("aborted")
    dest = Path(choice.id)
    if not is_writable_dir(dest):
        raise AppError(f"destination is not a writable directory: {dest}")
    return dest


def cmd_issue(
    args: argparse.Namespace,
    *,
    config: Config | None = None,
    create: Callable[[Config, str], str] = create_setup_key,
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
) -> int:
    loaded = config or load_config()
    name = resolve_name(args.name, stdin=stdin, stderr=stderr, prompt=True)
    existing = load_env_file(loaded.keys_path)
    if existing.get(name) and not args.replace:
        if stdin.isatty() and stderr.isatty():
            if not confirm_no(
                f"{name} already exists. Replace it?",
                stdin=stdin,
                stderr=stderr,
            ):
                raise AppError("aborted")
        else:
            raise AppError(f"{name} already exists; pass --replace")
    key = create(loaded, name)
    saved = save_setup_key(loaded, name, key)
    stdout.write(
        f"issued {name} (one-off, {loaded.auto_group}, 7d) -> {saved}\n"
    )
    return 0


def cmd_usb(
    args: argparse.Namespace,
    *,
    config: Config | None = None,
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
    volumes: list[UsbVolume] | None = None,
    ensure: Callable[..., Path | None] = ensure_msi,
) -> int:
    loaded = config or load_config(require_api_key=False)
    names = list_key_names(loaded.keys_path)
    if not names:
        raise AppError("no setup keys; run netbird-setup issue NAME first")
    dest_root = resolve_usb_dest(
        args.dest,
        stdin=stdin,
        stderr=stderr,
        volumes=volumes,
    )
    dest = payload_dir(dest_root)
    dest.mkdir(parents=True, exist_ok=True)
    env_dest, ps1_dest, cmd_dest, readme_dest = write_usb_payload(
        dest, loaded.keys_path
    )
    installer = ensure(dest)
    if installer is None:
        stderr.write(
            "warning: Windows MSI download failed; the USB script will use winget\n"
        )
    stdout.write(f"wrote {env_dest}\n")
    stdout.write(f"wrote {ps1_dest}\n")
    stdout.write(f"wrote {cmd_dest}\n")
    stdout.write(f"wrote {readme_dest}\n")
    if installer is not None:
        stdout.write(f"wrote {installer}\n")
    return 0


def cmd_list(
    args: argparse.Namespace,
    *,
    keys_path: Path = KEYS_PATH,
    stdout: TextIO = sys.stdout,
) -> int:
    del args
    names = list_key_names(keys_path)
    if not names:
        stdout.write("no setup keys\n")
        return 0
    for name in names:
        stdout.write(f"{name}\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="netbird-setup",
        description="Issue NetBird setup keys and write a Windows USB installer.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=HELP,
    )
    sub = parser.add_subparsers(dest="command")

    issue = sub.add_parser("issue", help="mint a one-off setup key")
    issue.add_argument("name", nargs="?", help="env name, e.g. GREEN_USER_01")
    issue.add_argument(
        "--replace",
        action="store_true",
        help="overwrite an existing NAME without prompting",
    )
    issue.set_defaults(func=cmd_issue)

    usb = sub.add_parser("usb", help="write a Windows installer script to USB")
    usb.add_argument("--dest", help="USB mount or destination directory")
    usb.set_defaults(func=cmd_usb)

    listed = sub.add_parser("list", help="list stored key names")
    listed.set_defaults(func=cmd_list)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help(sys.stderr)
        return 2
    try:
        return int(args.func(args))
    except AppError as error:
        sys.stderr.write(f"error: {error}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
