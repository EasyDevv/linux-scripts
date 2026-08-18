#!/usr/bin/env python3
"""Probe host, container, and guest SSH without printing secrets."""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import require


def tcp_banner(host: str, port: int, timeout: float = 3.0) -> dict:
    info = {"host": host, "port": port, "ok": False, "banner": None, "error": None}
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            data = sock.recv(64)
        info["ok"] = True
        info["banner"] = data.decode("latin1", "replace").strip()
    except Exception as exc:  # noqa: BLE001 - probe surface
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


def guest_ssh(container: str, vm_ip: str) -> dict:
    result = subprocess.run(
        ["podman", "exec", container, "nc", "-w2", vm_ip, "22"],
        input=b"",
        capture_output=True,
        timeout=5,
        check=False,
    )
    banner = result.stdout.decode("latin1", "replace").strip()
    return {
        "ok": banner.startswith("SSH-"),
        "banner": banner or None,
        "error": None if banner.startswith("SSH-") else (result.stderr.decode("latin1", "replace").strip() or "no banner"),
    }


def ssh_alias(alias: str) -> dict:
    result = subprocess.run(
        [
            "ssh",
            "-4",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            "-o",
            "StrictHostKeyChecking=accept-new",
            alias,
            "echo ssh_ok; hostname; whoami",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "ok": result.returncode == 0 and "ssh_ok" in result.stdout,
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance")
    args = parser.parse_args()
    rec = require(args.instance)
    host = tcp_banner("127.0.0.1", int(rec["ssh_port"]))
    guest = guest_ssh(rec["container"], rec["vm_net_ip"])
    alias = ssh_alias(rec["ssh_alias"])
    report = {
        "instance": rec["instance"],
        "container": rec["container"],
        "alias": rec["ssh_alias"],
        "host_port": rec["ssh_port"],
        "vm_net_ip": rec["vm_net_ip"],
        "host_listen": host,
        "guest_listen": guest,
        "ssh": alias,
    }
    print(json.dumps(report, indent=2))
    return 0 if alias["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
