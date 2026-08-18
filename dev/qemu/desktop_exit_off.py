#!/usr/bin/env python3
"""Copy tailscale-exit-node-off.bat to the guest desktop over SSH."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import GUEST_SCRIPTS, require
from remote import push_guest_scripts, ssh_run

FILES = [
    "apply-exit-node.ps1",
    "disable-exit-node-1h.ps1",
    "tailscale-exit-node-off.bat",
    "copy-exit-node-off.ps1",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance")
    args = parser.parse_args()
    rec = require(args.instance)
    push_guest_scripts(rec["ssh_alias"], FILES)
    result = ssh_run(
        rec["ssh_alias"],
        "powershell -NoProfile -ExecutionPolicy Bypass "
        f"-File {GUEST_SCRIPTS}/copy-exit-node-off.ps1",
        timeout=60,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
