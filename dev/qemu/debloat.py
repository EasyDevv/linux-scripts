#!/usr/bin/env python3
"""Apply the cached Win11Debloat preset over SSH. Do not use Shared."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cache_debloat import ensure
from lib import GUEST_SCRIPTS, require
from remote import push_guest_scripts, scp_to_guest, ssh_run
from verify_debloat import verify

WRAPPER = "apply-debloat.ps1"


def push_debloat_tree(alias: str, cache: Path) -> None:
    dest = f"{GUEST_SCRIPTS}/Win11Debloat"
    ssh_run(
        alias,
        (
            "powershell -NoProfile -Command "
            f"\"if (Test-Path -LiteralPath '{dest}') {{ "
            f"Remove-Item -LiteralPath '{dest}' -Recurse -Force }}\""
        ),
        timeout=60,
    )
    result = subprocess.run(
        [
            "scp",
            "-4",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-r",
            str(cache),
            f"{alias}:{dest}",
        ],
        check=False,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout or "scp Win11Debloat failed")
    version = cache.parent / "VERSION"
    if not version.is_file():
        version = cache / "VERSION"
    if version.is_file():
        scp_to_guest(alias, version, f"{dest}/VERSION")


def apply(
    instance: str,
    *,
    force: bool = False,
    refresh: bool = False,
    offline: bool = False,
    timeout: int = 900,
) -> int:
    rec = require(instance)
    info = ensure(refresh=refresh, offline=offline)
    alias = rec["ssh_alias"]
    cache = Path(str(info["cache"]))
    push_guest_scripts(alias, [WRAPPER])
    push_debloat_tree(alias, cache)
    print(f"cache: {info['tag']} -> guest {GUEST_SCRIPTS}/Win11Debloat")
    print(f"preset: {info['preset']}")
    forced = info.get("forced_default_apps")
    if isinstance(forced, list) and forced:
        print("forced_default_apps: " + ", ".join(str(x) for x in forced))
    remote = (
        "powershell -NoProfile -ExecutionPolicy Bypass "
        f"-File {GUEST_SCRIPTS}/{WRAPPER}"
    )
    if force:
        remote += " -Force"
    applied = ssh_run(alias, remote, timeout=timeout, check=False)
    if applied.stdout:
        print(applied.stdout.rstrip())
    if applied.stderr:
        print(applied.stderr.rstrip(), file=sys.stderr)
    if applied.returncode != 0:
        return applied.returncode
    print("verify: leftover apps")
    return verify(instance, offline=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    return apply(
        args.instance,
        force=args.force,
        refresh=args.refresh,
        offline=args.offline,
        timeout=args.timeout,
    )


if __name__ == "__main__":
    raise SystemExit(main())
