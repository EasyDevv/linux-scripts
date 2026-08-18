#!/usr/bin/env python3
"""Copy skill originals into Shared only when the dest is missing.

Shared is a pre-SSH drop. After SSH works, send files over SSH instead.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from lib import SETUP_DIR

HERE = Path(__file__).resolve().parent
GUEST_DIR = HERE / "guest"

PRE_SSH_FILES = (
    "setup-ssh.ps1",
    "setup-ssh.bat",
)


def copy_if_missing(src: Path, dest: Path, *, force: bool = False) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return False
    if src.is_dir():
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
        dest.chmod(0o644)
    return True


def stage_pre_ssh(*, force: bool = False) -> list[str]:
    copied: list[str] = []
    SETUP_DIR.mkdir(parents=True, exist_ok=True)
    for name in PRE_SSH_FILES:
        src = GUEST_DIR / name
        dest = SETUP_DIR / name
        if copy_if_missing(src, dest, force=force):
            copied.append(name)
    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="overwrite existing Shared copies")
    args = parser.parse_args()
    copied = stage_pre_ssh(force=args.force)
    print(f"setup_dir: {SETUP_DIR}")
    print("copied: " + (", ".join(copied) if copied else "(none, already present)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
