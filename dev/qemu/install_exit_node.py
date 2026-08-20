#!/usr/bin/env python3
"""Install the guest boot/logon exit-node hook over SSH. Does not use Shared."""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import DEFAULT_EXIT_NODE, GUEST_SCRIPTS, require
from remote import push_guest_scripts, scp_to_guest, ssh_run

FILES = [
    "apply-exit-node.ps1",
    "disable-exit-node-1h.ps1",
    "tailscale-exit-node-off.bat",
    "install-exit-node.ps1",
    "copy-exit-node-off.ps1",
]


def push_exit_node_config(alias: str, exit_node: str) -> None:
    if not exit_node or any(char in exit_node for char in "\r\n"):
        raise SystemExit("exit node must be a non-empty single line")
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
        handle.write(exit_node + "\n")
        path = Path(handle.name)
    try:
        scp_to_guest(alias, path, f"{GUEST_SCRIPTS}/exit-node.txt")
    finally:
        path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance")
    parser.add_argument("--exit-node", default=DEFAULT_EXIT_NODE or None)
    args = parser.parse_args()
    if not args.exit_node:
        raise SystemExit(
            "missing exit node; set WQ_EXIT_NODE in "
            f"{Path.home() / '.config/windows-qemu/operator.env'} or pass --exit-node"
        )
    rec = require(args.instance)
    push_guest_scripts(rec["ssh_alias"], FILES)
    push_exit_node_config(rec["ssh_alias"], args.exit_node)
    result = ssh_run(
        rec["ssh_alias"],
        "powershell -NoProfile -ExecutionPolicy Bypass "
        f"-File {GUEST_SCRIPTS}/install-exit-node.ps1",
        timeout=120,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
