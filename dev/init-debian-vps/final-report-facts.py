#!/usr/bin/env python3
"""Host facts for the init-vps completion report. Stdin: probe JSON. No secrets."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def unit_active(name: str) -> bool:
    result = subprocess.run(
        ["systemctl", "is-active", "--quiet", name],
        check=False,
    )
    return result.returncode == 0


def listening(addr: str) -> bool:
    result = subprocess.run(
        ["ss", "-lnt"],
        check=False,
        capture_output=True,
        text=True,
    )
    return addr in (result.stdout or "")


def ipv4(dev: str) -> str:
    result = subprocess.run(
        ["ip", "-4", "-o", "addr", "show", "dev", dev],
        check=False,
        capture_output=True,
        text=True,
    )
    for token in result.stdout.split():
        if "/" in token and not token.startswith("inet"):
            return token.split("/", 1)[0]
    return ""


def public_ip() -> str:
    result = subprocess.run(
        ["ip", "-4", "-o", "route", "get", "1.1.1.1"],
        check=False,
        capture_output=True,
        text=True,
    )
    parts = result.stdout.split()
    for index, token in enumerate(parts):
        if token == "src" and index + 1 < len(parts):
            return parts[index + 1]
    return ""


def nft_drop() -> bool:
    result = subprocess.run(
        ["nft", "list", "chain", "ip", "crowdsec", "crowdsec-chain-input"],
        check=False,
        capture_output=True,
        text=True,
    )
    return "saddr @crowdsec-blacklists" in (result.stdout or "")


def main() -> int:
    if len(sys.argv) > 1:
        probe = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        probe = json.load(sys.stdin)
    paths = {path: Path(path).exists() for path in probe.get("paths") or []}
    units = {name: unit_active(name) for name in probe.get("units") or []}
    listens = {addr: listening(addr) for addr in probe.get("listens") or []}
    caddy = subprocess.run(
        ["stat", "-c", "%a %U:%G", "/etc/caddy"],
        check=False,
        capture_output=True,
        text=True,
    )
    facts = {
        "paths": paths,
        "units": units,
        "listens": listens,
        "nft_drop": nft_drop(),
        "wt0_ip": ipv4("wt0"),
        "public_ip": public_ip(),
        "caddy_dir": (caddy.stdout or "").strip(),
    }
    json.dump(facts, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
