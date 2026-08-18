#!/usr/bin/env python3
"""Restore the default Tailscale exit-node on a Windows guest.

windows-02 (and the same-role guests) must egress through redmi-note-3.
Turning Tailscale off for Shared, then back on, leaves ExitNodeID empty
and public IPs fall back to the host ISP 211.245.140.95.
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
    parser.add_argument("--exit-node", default=DEFAULT_EXIT_NODE)
    parser.add_argument("--check", action="store_true", help="report only; do not change prefs")
    args = parser.parse_args()
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
        if not current or ip == HOST_ISP_IP:
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
    if ip == HOST_ISP_IP:
        print(f"still on host ISP {HOST_ISP_IP}; exit node did not take over egress", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
