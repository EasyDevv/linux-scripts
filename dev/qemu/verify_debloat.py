#!/usr/bin/env python3
"""Fail if forced leftover apps are still installed on the guest."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cache_debloat import ensure
from lib import GUEST_SCRIPTS, require
from remote import push_guest_scripts, scp_to_guest, ssh_run

VERIFY = "verify-debloat.ps1"


def verify(instance: str, *, offline: bool = True, timeout: int = 120) -> int:
    rec = require(instance)
    info = ensure(offline=offline)
    alias = rec["ssh_alias"]
    dest = f"{GUEST_SCRIPTS}/Win11Debloat"
    ssh_run(
        alias,
        (
            "powershell -NoProfile -Command "
            f"\"New-Item -ItemType Directory -Path '{dest}' -Force | Out-Null\""
        ),
        timeout=30,
    )
    apps_file = Path(str(info["forced_apps_file"]))
    preset_file = Path(str(info["preset_file"]))
    scp_to_guest(alias, apps_file, f"{dest}/forced-apps.txt")
    scp_to_guest(alias, preset_file, f"{dest}/PRESET")
    push_guest_scripts(alias, [VERIFY])
    result = ssh_run(
        alias,
        (
            "powershell -NoProfile -ExecutionPolicy Bypass "
            f"-File {GUEST_SCRIPTS}/{VERIFY}"
        ),
        timeout=timeout,
        check=False,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    if result.returncode != 0:
        raise SystemExit("debloat leftover check failed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    return verify(args.instance, offline=args.offline, timeout=args.timeout)


if __name__ == "__main__":
    raise SystemExit(main())
