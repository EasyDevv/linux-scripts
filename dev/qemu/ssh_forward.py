#!/usr/bin/env python3
"""DNAT pasta-published container TCP/22 to passt on the QEMU tap.

Host PublishPort maps 222x -> container:22. passt listens on enp9s0:22 and
forwards into the guest. The guest slirp address (10.0.2.x) is not routable
from the container namespace, so DNATing there hangs the SSH banner.
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


def tap_ipv4(container: str) -> str:
    result = subprocess.run(
        [
            "podman",
            "exec",
            container,
            "sh",
            "-c",
            "ip -4 -o addr show dev enp9s0 | awk '/inet / {print $4; exit}'",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    ip = (result.stdout or "").split("/")[0].strip()
    if not ip:
        raise SystemExit(f"no enp9s0 ipv4 on {container}")
    return ip


def apply_forward(container: str, vm_ip: str | None = None) -> str:
    tap = tap_ipv4(container)
    stale = [ip for ip in (vm_ip,) if ip and ip != tap]
    drop = "\n".join(
        f"""
iptables -t nat -D PREROUTING -p tcp -m tcp --dport 22 -j DNAT --to-destination {ip}:22 2>/dev/null || true
iptables -t nat -D OUTPUT -p tcp -m tcp --dport 22 -j DNAT --to-destination {ip}:22 2>/dev/null || true
iptables -t nat -D POSTROUTING -d {ip}/32 -p tcp -m tcp --dport 22 -j MASQUERADE 2>/dev/null || true
"""
        for ip in stale
    )
    script = f"""
{drop}
iptables -t nat -C PREROUTING -p tcp --dport 22 -j DNAT --to-destination {tap}:22 2>/dev/null \\
  || iptables -t nat -I PREROUTING 1 -p tcp --dport 22 -j DNAT --to-destination {tap}:22
iptables -t nat -C OUTPUT -p tcp --dport 22 -j DNAT --to-destination {tap}:22 2>/dev/null \\
  || iptables -t nat -I OUTPUT 1 -p tcp --dport 22 -j DNAT --to-destination {tap}:22
"""
    result = subprocess.run(
        ["podman", "exec", container, "sh", "-c", script],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "iptables failed")
    return tap


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance", help="windows instance id, e.g. 01")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    rec = require(args.instance)
    wait_container(rec["container"], args.timeout)
    tap = apply_forward(rec["container"], rec.get("vm_net_ip"))
    print(f"ssh forward ready: {rec['container']}:22 -> {tap}:22")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
