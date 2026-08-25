#!/usr/bin/env python3
"""Classify operator SSH after a wipe. Does not write ~/.ssh."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path


def ssh_g(target: str) -> dict[str, str]:
    result = subprocess.run(
        ["ssh", "-G", target],
        text=True,
        capture_output=True,
        check=True,
    )
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if " " not in line:
            continue
        key, value = line.split(None, 1)
        values[key.lower()] = value
    return values


def classify(err: str) -> str:
    low = err.lower()
    if (
        "host key verification failed" in low
        or "remote host identification has changed" in low
    ):
        return "hostkey"
    if "not a valid known_hosts file" in low or "invalid line" in low:
        return "invalid_known_hosts"
    if "permission denied (publickey)" in err:
        return "publickey"
    if (
        "connection timed out" in low
        or "connection refused" in low
        or "network is unreachable" in low
    ):
        return "unreachable"
    return "other"


def ssh_try(target: str, extra: list[str], err_path: Path, out_path: Path) -> bool:
    argv = [
        "ssh",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "RequestTTY=no",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        *extra,
        target,
        'printf "%s\\n" "$(whoami)"',
    ]
    result = subprocess.run(argv, text=True, capture_output=True)
    err_path.write_text(result.stderr)
    out_path.write_text(result.stdout)
    return result.returncode == 0


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"Usage: {argv[0]} TARGET", file=sys.stderr)
        return 2
    target = argv[1]
    values = ssh_g(target)
    hostname = values.get("hostname", "")
    user = values.get("user", "")
    print(f"target={target} user={user} hostname={hostname}")
    if hostname.startswith("100."):
        print(
            f"FAIL HostName is an overlay address. Set Host {target} HostName "
            "to the public IPv4, then rerun.",
            file=sys.stderr,
        )
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        isolated = Path(tmp) / "known_hosts"
        default_err = Path(tmp) / "default.err"
        isolated_err = Path(tmp) / "isolated.err"
        default_out = Path(tmp) / "default.out"
        isolated_out = Path(tmp) / "isolated.out"
        default_ok = ssh_try(target, [], default_err, default_out)
        default_class = "ok" if default_ok else classify(default_err.read_text())
        isolated_ok = ssh_try(
            target,
            [
                "-o",
                f"UserKnownHostsFile={isolated}",
                "-o",
                "GlobalKnownHostsFile=/dev/null",
                "-o",
                "StrictHostKeyChecking=accept-new",
            ],
            isolated_err,
            isolated_out,
        )
        isolated_class = "ok" if isolated_ok else classify(isolated_err.read_text())
        print(f"default={default_class} isolated={isolated_class}")

        if default_ok:
            who = default_out.read_text().replace("\r", "").strip()
            if who != user:
                print(
                    f"FAIL ssh {target} logged in as {who}, expected {user}.",
                    file=sys.stderr,
                )
                return 1
            print(f"PASS public key SSH as {user} on {hostname}")
            return 0

        if default_class in {"hostkey", "invalid_known_hosts"}:
            print("Host-key layer blocked the default known_hosts file.", file=sys.stderr)
            if default_class == "invalid_known_hosts":
                print(
                    "Fix the invalid line in ~/.ssh/known_hosts first, then remove the stale host key.",
                    file=sys.stderr,
                )
            print("Operator only (do not edit ~/.ssh from an agent vault):", file=sys.stderr)
            print(f"  ssh-keygen -R {hostname}", file=sys.stderr)
            if hostname != target:
                print(f"  ssh-keygen -R {target}", file=sys.stderr)
            print(f"Then rerun {argv[0]} {target}", file=sys.stderr)
            if isolated_ok:
                print(
                    "Isolated known_hosts already works. This is not a missing guest key.",
                    file=sys.stderr,
                )
                return 1
            if isolated_class == "publickey":
                print(
                    "After ssh-keygen -R, expect Permission denied (publickey) until authorized_keys has this key.",
                    file=sys.stderr,
                )
            return 1

        if default_class == "publickey" or isolated_class == "publickey":
            print(
                "FAIL guest rejected the operator key (authorized_keys). This is not a known_hosts problem.",
                file=sys.stderr,
            )
            print(
                "Do not start bootstrap. Use the VNC console, ovhcloud vps set-password, or reinstall with a verified pubkey.",
                file=sys.stderr,
            )
            return 1

        print(
            f"FAIL ssh {target}: default={default_class} isolated={isolated_class}",
            file=sys.stderr,
        )
        err = default_err.read_text().strip()
        if err:
            print("\n".join(err.splitlines()[-3:]), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
