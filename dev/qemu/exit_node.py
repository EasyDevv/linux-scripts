#!/usr/bin/env python3
"""Restore the configured Tailscale exit-node on a Windows guest.

The exit-node name and optional host ISP baseline are loaded from the local
operator config (or WQ_EXIT_NODE/WQ_HOST_ISP_IP). No deployment identifiers
belong in this repository.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import DEFAULT_EXIT_NODE, HOST_ISP_IP, require


def ssh(alias: str, command: str, timeout: int = 40) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "ssh",
            "-4",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            alias,
            command,
        ],
        check=False,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def public_ip(alias: str) -> str:
    result = ssh(
        alias,
        "try { (Invoke-RestMethod -Uri https://api.ipify.org -TimeoutSec 20).ToString() } catch { $_.Exception.Message }",
        timeout=35,
    )
    return (result.stdout or result.stderr).strip().splitlines()[-1] if (result.stdout or result.stderr) else ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance")
    parser.add_argument("--exit-node", default=DEFAULT_EXIT_NODE or None)
    parser.add_argument("--check", action="store_true", help="report only; do not change prefs")
    args = parser.parse_args()
    if not args.exit_node:
        raise SystemExit(
            "missing exit node; set WQ_EXIT_NODE in "
            f"{Path.home() / '.config/windows-qemu/operator.env'} or pass --exit-node"
        )
    rec = require(args.instance)
    alias = rec["ssh_alias"]

    status = ssh(alias, "tailscale status --json")
    if status.returncode != 0:
        raise SystemExit(status.stderr.strip() or "tailscale status failed")
    data = json.loads(status.stdout)
    current = (data.get("ExitNodeStatus") or {}).get("ID") or ""
    online = bool((data.get("ExitNodeStatus") or {}).get("Online"))
    ip = public_ip(alias)
    print(f"alias: {alias}")
    print(f"exit_node_id: {current or '(none)'}")
    print(f"exit_node_online: {online}")
    print(f"public_ip: {ip}")

    if args.check:
        if not current or not online:
            return 1
        if HOST_ISP_IP and ip == HOST_ISP_IP:
            return 1
        return 0

    set_cmd = (
        f"tailscale set --exit-node={args.exit_node} --exit-node-allow-lan-access=true; "
        "tailscale debug prefs | Select-String -Pattern ExitNode"
    )
    applied = ssh(alias, set_cmd, timeout=40)
    if applied.returncode != 0:
        raise SystemExit(applied.stderr.strip() or "tailscale set failed")
    print(applied.stdout.strip())
    ip = public_ip(alias)
    print(f"public_ip: {ip}")
    if HOST_ISP_IP and ip == HOST_ISP_IP:
        print("public IP still matches the configured host ISP; exit node did not take over egress", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
