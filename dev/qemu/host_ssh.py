#!/usr/bin/env python3
"""Ensure the reusable host key and ~/.ssh/config alias for a Windows VM."""
from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import IDENTITY, SETUP_DIR, SSH_CONFIG, SSH_DIR, require
from stage import copy_if_missing

LEGACY_NAMES = ("windows-01",)


def ensure_identity() -> Path:
    SSH_DIR.mkdir(mode=0o700, exist_ok=True)
    if IDENTITY.exists():
        IDENTITY.chmod(0o600)
        pub = IDENTITY.with_suffix(".pub")
        if pub.exists():
            pub.chmod(0o644)
        return IDENTITY
    for name in LEGACY_NAMES:
        legacy = SSH_DIR / name
        if legacy.exists() and not IDENTITY.exists():
            shutil.move(str(legacy), IDENTITY)
            legacy_pub = SSH_DIR / f"{name}.pub"
            if legacy_pub.exists() and not IDENTITY.with_suffix(".pub").exists():
                shutil.move(str(legacy_pub), IDENTITY.with_suffix(".pub"))
            IDENTITY.chmod(0o600)
            if IDENTITY.with_suffix(".pub").exists():
                IDENTITY.with_suffix(".pub").chmod(0o644)
            return IDENTITY
    subprocess.run(
        [
            "ssh-keygen",
            "-t",
            "ed25519",
            "-f",
            str(IDENTITY),
            "-N",
            "",
            "-C",
            "windows-qemu",
        ],
        check=True,
    )
    IDENTITY.chmod(0o600)
    IDENTITY.with_suffix(".pub").chmod(0o644)
    return IDENTITY


def upsert_host_block(alias: str, port: str) -> None:
    SSH_DIR.mkdir(mode=0o700, exist_ok=True)
    if not SSH_CONFIG.exists():
        SSH_CONFIG.touch(mode=0o600)
    text = SSH_CONFIG.read_text(encoding="utf-8")
    block = (
        f"Host {alias}\n"
        f"    HostName 127.0.0.1\n"
        f"    Port {port}\n"
        f"    User Docker\n"
        f"    IdentityFile ~/.ssh/windows\n"
        f"    IdentitiesOnly yes\n"
    )
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    replaced = False
    while i < len(lines):
        line = lines[i]
        if line.lower().startswith("host ") and alias in line.split()[1:]:
            replaced = True
            i += 1
            while i < len(lines) and not lines[i].lower().startswith("host "):
                i += 1
            if out and out[-1].strip():
                out.append("\n")
            out.append(block if block.endswith("\n") else block + "\n")
            if i < len(lines) and out and not out[-1].endswith("\n\n"):
                out.append("\n")
            continue
        out.append(line)
        i += 1
    body = "".join(out)
    if not replaced:
        if body and not body.endswith("\n"):
            body += "\n"
        if body and not body.endswith("\n\n"):
            body += "\n"
        body += block
        if not body.endswith("\n"):
            body += "\n"
    SSH_CONFIG.write_text(body)
    os.chmod(SSH_CONFIG, stat.S_IRUSR | stat.S_IWUSR)


def copy_pubkey_to_shared() -> Path:
    dest = SETUP_DIR / "windows.pub"
    copy_if_missing(IDENTITY.with_suffix(".pub"), dest)
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance", help="windows instance id")
    args = parser.parse_args()
    rec = require(args.instance)
    ensure_identity()
    upsert_host_block(rec["ssh_alias"], rec["ssh_port"])
    pub = copy_pubkey_to_shared()
    print(f"identity: {IDENTITY}")
    print(f"alias: {rec['ssh_alias']} 127.0.0.1:{rec['ssh_port']}")
    print(f"pubkey: {pub}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
