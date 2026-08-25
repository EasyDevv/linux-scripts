#!/usr/bin/env python3
"""Repair corrupt/stale known_hosts after an explicitly authorized disk wipe."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def resolved_hostname(target: str) -> str:
    result = subprocess.run(["ssh", "-G", target], text=True, capture_output=True, check=True)
    for line in result.stdout.splitlines():
        key, _, value = line.partition(" ")
        if key.lower() == "hostname":
            return value.strip()
    raise ValueError(f"ssh -G {target} returned no hostname")


def ovh_owns_ip(service: str, expected_ip: str) -> None:
    result = subprocess.run(
        ["ovhcloud", "vps", "ip", "list", service, "-o", "json"],
        text=True,
        capture_output=True,
        check=True,
    )
    data = json.loads(result.stdout)
    if expected_ip not in {item.get("ipAddress") for item in data}:
        raise ValueError(f"OVH service {service} does not own {expected_ip}")


def valid_entry(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return True
    with tempfile.NamedTemporaryFile("w") as handle:
        handle.write(line if line.endswith("\n") else line + "\n")
        handle.flush()
        result = subprocess.run(
            ["ssh-keygen", "-l", "-f", handle.name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return result.returncode == 0


def clean_invalid(text: str) -> tuple[str, list[int]]:
    kept: list[str] = []
    removed: list[int] = []
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        if valid_entry(line):
            kept.append(line)
        else:
            removed.append(number)
    return "".join(kept), removed


def remove_host(path: Path, host: str) -> None:
    result = subprocess.run(
        ["ssh-keygen", "-R", host, "-f", str(path)],
        text=True,
        capture_output=True,
    )
    if result.returncode not in (0, 1):
        raise ValueError(result.stderr.strip() or f"ssh-keygen -R {host} failed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True)
    parser.add_argument("--expected-ip", required=True)
    parser.add_argument("--ovh-service", required=True)
    parser.add_argument("--known-hosts", type=Path, default=Path.home() / ".ssh/known_hosts")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    actual = resolved_hostname(args.target)
    if actual != args.expected_ip:
        raise SystemExit(f"FAIL Host {args.target} resolves to {actual}, expected {args.expected_ip}")
    ovh_owns_ip(args.ovh_service, args.expected_ip)
    original = args.known_hosts.read_text(errors="replace") if args.known_hosts.exists() else ""
    cleaned, invalid = clean_invalid(original)
    print(
        f"PLAN target={args.target} ip={args.expected_ip} "
        f"invalid_lines={','.join(map(str, invalid)) or 'none'}"
    )
    if not args.apply:
        return 0

    args.known_hosts.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = args.known_hosts.with_suffix(args.known_hosts.suffix + ".pre-reinstall.bak")
    if args.known_hosts.exists():
        shutil.copy2(args.known_hosts, backup)
    fd, temp_name = tempfile.mkstemp(prefix="known_hosts.", dir=args.known_hosts.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(cleaned)
        os.chmod(temp, 0o600)
        for host in {args.expected_ip, args.ovh_service, args.target}:
            remove_host(temp, host)
        os.replace(temp, args.known_hosts)
    finally:
        temp.unlink(missing_ok=True)

    # Explicit --apply plus OVH ownership check authorizes accepting this new key.
    result = subprocess.run(
        [
            "ssh",
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=15",
            args.target,
            "whoami",
        ],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit("FAIL host key repaired but public-key login failed")
    print(f"PASS known_hosts repaired; login_user={result.stdout.strip()} backup={backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
