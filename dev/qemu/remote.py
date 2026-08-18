#!/usr/bin/env python3
"""SSH/SCP helpers for guests that already have OpenSSH."""
from __future__ import annotations

import subprocess
from pathlib import Path

from lib import GUEST_SCRIPTS


def ssh_run(
    alias: str,
    command: str,
    *,
    timeout: int = 60,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "ssh",
            "-4",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            alias,
            command,
        ],
        check=check,
        text=True,
        timeout=timeout,
    )


def scp_to_guest(alias: str, src: Path, dest: str, *, timeout: int = 120) -> None:
    result = subprocess.run(
        [
            "scp",
            "-4",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            str(src),
            f"{alias}:{dest}",
        ],
        check=False,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or f"scp failed: {src} -> {alias}:{dest}")


def ensure_guest_scripts(alias: str) -> None:
    cmd = (
        "powershell -NoProfile -Command "
        f"\"New-Item -ItemType Directory -Path '{GUEST_SCRIPTS}' -Force | Out-Null\""
    )
    result = ssh_run(alias, cmd, timeout=30)
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or "failed to create guest Scripts")


def push_guest_scripts(alias: str, names: list[str], *, src_dir: Path | None = None) -> None:
    root = src_dir or (Path(__file__).resolve().parent / "guest")
    ensure_guest_scripts(alias)
    for name in names:
        src = root / name
        if not src.exists():
            raise SystemExit(f"missing skill original: {src}")
        scp_to_guest(alias, src, f"{GUEST_SCRIPTS}/{name}")
