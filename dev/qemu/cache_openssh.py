#!/usr/bin/env python3
"""Download OpenSSH-Win64.zip once and stage it into Shared only if missing."""
from __future__ import annotations

import argparse
import json
import shutil
import urllib.request
from pathlib import Path

from lib import SETUP_DIR
from stage import copy_if_missing

CACHE_ROOT = Path.home() / ".cache" / "windows-qemu" / "openssh"
PINNED_URL = (
    "https://github.com/PowerShell/Win32-OpenSSH/releases/download/"
    "10.0.0.0p2-Preview/OpenSSH-Win64.zip"
)
PINNED_TAG = "10.0.0.0p2-Preview"
USER_AGENT = "windows-qemu-openssh"
STAGED_NAME = "OpenSSH-Win64.zip"


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})


def cache_path(tag: str) -> Path:
    return CACHE_ROOT / tag / STAGED_NAME


def download(tag: str, url: str) -> Path:
    dest = cache_path(tag)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(_request(url), timeout=60) as resp, tmp.open("wb") as fh:
        shutil.copyfileobj(resp, fh)
    tmp.replace(dest)
    return dest


def ensure(refresh: bool = False, offline: bool = False) -> dict[str, str]:
    tag = PINNED_TAG
    cached = cache_path(tag)
    if refresh or not cached.is_file():
        if offline:
            raise SystemExit(f"offline and cache missing for {tag}")
        cached = download(tag, PINNED_URL)
    SETUP_DIR.mkdir(parents=True, exist_ok=True)
    staged = SETUP_DIR / STAGED_NAME
    copied = copy_if_missing(cached, staged, force=refresh)
    version = SETUP_DIR / "OpenSSH.version"
    if refresh or not version.is_file():
        version.write_text(tag + "\n", encoding="utf-8")
    return {
        "tag": tag,
        "cache": str(cached),
        "staged": str(staged),
        "copied": copied,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    print(json.dumps(ensure(refresh=args.refresh, offline=args.offline), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
