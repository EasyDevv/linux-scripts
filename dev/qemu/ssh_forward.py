#!/usr/bin/env python3
"""DNAT pasta-published container TCP/22 to the Windows guest SSH port.

Host PublishPort maps 222x -> container:22. dockur tap/NAT does not listen
on container:22 unless passt is running, so host SSH resets until this
forward exists.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import require


def wait_container(container: str, timeout: int = 120) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        probe = subprocess.run(
            ["podman", "exec", container, "true"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if probe.returncode == 0:
            return
        time.sleep(2)
    raise SystemExit(f"container not ready: {container}")


def apply_forward(container: str, vm_ip: str) -> None:
    script = f"""
iptables -t nat -C PREROUTING -p tcp --dport 22 -j DNAT --to-destination {vm_ip}:22 2>/dev/null \\
  || iptables -t nat -I PREROUTING 1 -p tcp --dport 22 -j DNAT --to-destination {vm_ip}:22
iptables -t nat -C OUTPUT -p tcp --dport 22 -j DNAT --to-destination {vm_ip}:22 2>/dev/null \\
  || iptables -t nat -I OUTPUT 1 -p tcp --dport 22 -j DNAT --to-destination {vm_ip}:22
iptables -t nat -C POSTROUTING -p tcp -d {vm_ip} --dport 22 -j MASQUERADE 2>/dev/null \\
  || iptables -t nat -A POSTROUTING -p tcp -d {vm_ip} --dport 22 -j MASQUERADE
"""
    result = subprocess.run(
        ["podman", "exec", container, "sh", "-c", script],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "iptables failed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance", help="01, 02, windows-02, or windows@02")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    rec = require(args.instance)
    wait_container(rec["container"], args.timeout)
    apply_forward(rec["container"], rec["vm_net_ip"])
    print(f"ssh forward ready: {rec['container']}:22 -> {rec['vm_net_ip']}:22")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
