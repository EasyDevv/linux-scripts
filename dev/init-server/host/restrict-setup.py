#!/usr/bin/env python3
"""Push and run the NetBird setup-guard helpers on a host."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

HOST_DIR = Path(__file__).resolve().parent
GUEST_DIR = HOST_DIR.parent / "guest"
GUARD_FILES = (
    "setup-log.sh",
    "configure-netbird-setup-guard.sh",
    "netbird-setup-guard.sh",
)


def load_ssh_control():
    path = HOST_DIR / "ssh-control.py"
    spec = importlib.util.spec_from_file_location("ssh_control", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def public_ipv4() -> str:
    with urlopen("https://api.ipify.org", timeout=10) as response:
        return response.read().decode().strip()


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    target = argv[2] if len(argv) > 2 else ""
    domain = argv[3] if len(argv) > 3 else ""
    if mode not in {"--apply", "--remove"} or not target or not domain:
        print(f"Usage: {argv[0]} --apply SSH_TARGET DOMAIN [IPV4]", file=sys.stderr)
        print(f"       {argv[0]} --remove SSH_TARGET DOMAIN", file=sys.stderr)
        return 2

    allowed_ip = ""
    if mode == "--apply":
        allowed_ip = argv[4] if len(argv) > 4 else public_ipv4()

    options = load_ssh_control().control_options()
    sources = [str(GUEST_DIR / name) for name in GUARD_FILES]
    subprocess.run(
        ["scp", "-q", *options, *sources, f"{target}:/tmp/"],
        check=True,
    )
    remote = [
        "ssh",
        *options,
        "-o",
        "ConnectTimeout=10",
        target,
        "sudo",
        "/bin/bash",
        "/tmp/configure-netbird-setup-guard.sh",
        mode,
        domain,
        allowed_ip,
    ]
    result = subprocess.run(remote, check=False)
    if result.returncode != 0:
        return result.returncode
    return subprocess.run([str(HOST_DIR / "sync-log.py"), target], check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
