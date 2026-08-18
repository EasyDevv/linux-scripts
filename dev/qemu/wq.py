#!/usr/bin/env python3
"""windows-qemu operator CLI."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import list_instances, require, resolve

PASSTHROUGH = {
    "keys": "qemu_keys.py",
    "host-ssh": "host_ssh.py",
    "ssh-forward": "ssh_forward.py",
    "ssh-setup": "setup_ssh.py",
    "ssh-probe": "ssh_probe.py",
    "exit-node": "exit_node.py",
    "install-exit-node": "install_exit_node.py",
    "desktop-exit-off": "desktop_exit_off.py",
    "debloat": "debloat.py",
    "verify-debloat": "verify_debloat.py",
    "cache-debloat": "cache_debloat.py",
    "stage": "stage.py",
    "doctor": "doctor.py",
}


def cmd_resolve(args: argparse.Namespace) -> int:
    if args.all or not args.instance:
        print(json.dumps([resolve(i) for i in list_instances()], indent=2))
        return 0
    rec = require(args.instance)
    print(json.dumps(rec, indent=2))
    return 0


def cmd_restart(args: argparse.Namespace) -> int:
    rec = require(args.instance)
    result = subprocess.run(["systemctl", "--user", "restart", rec["unit"]], check=False)
    return result.returncode


def cmd_status(args: argparse.Namespace) -> int:
    rec = require(args.instance)
    result = subprocess.run(
        ["systemctl", "--user", "status", rec["unit"], "--no-pager"],
        check=False,
    )
    return result.returncode


def dispatch_script(name: str, argv: list[str]) -> int:
    script = Path(__file__).resolve().parent / name
    result = subprocess.run([sys.executable, str(script), *argv], check=False)
    return result.returncode


def main() -> int:
    argv = sys.argv[1:]
    if argv and argv[0] in PASSTHROUGH:
        return dispatch_script(PASSTHROUGH[argv[0]], argv[1:])

    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_resolve = sub.add_parser("resolve", help="print instance ports and paths")
    p_resolve.add_argument("instance", nargs="?")
    p_resolve.add_argument("--all", action="store_true")
    p_resolve.set_defaults(func=cmd_resolve)

    p_restart = sub.add_parser("restart", help="systemctl --user restart windows@{id}")
    p_restart.add_argument("instance")
    p_restart.set_defaults(func=cmd_restart)

    p_status = sub.add_parser("status", help="systemctl --user status windows@{id}")
    p_status.add_argument("instance")
    p_status.set_defaults(func=cmd_status)

    for name, help_text in (
        ("keys", "send QEMU monitor keys"),
        ("host-ssh", "ensure ~/.ssh/windows and config alias"),
        ("ssh-forward", "DNAT container:22 to guest SSH"),
        ("ssh-setup", "unattended host+guest SSH bootstrap, then debloat"),
        ("ssh-probe", "probe host/guest/alias SSH"),
        ("exit-node", "restore default Tailscale exit-node"),
        ("install-exit-node", "install guest boot/logon exit-node hook"),
        ("desktop-exit-off", "copy tailscale-exit-node-off.bat to guest desktop"),
        ("debloat", "apply cached Win11Debloat over SSH"),
        ("verify-debloat", "fail if leftover forced apps remain"),
        ("cache-debloat", "download Win11Debloat once on the host"),
        ("stage", "copy missing pre-SSH files into Shared/scripts/windows-setup"),
        ("doctor", "check operator home, drop-in, and nginx tmpfs"),
    ):
        sub.add_parser(name, help=help_text)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
