#!/usr/bin/env python3
"""Copy a local Discord webhook to a VPS without printing the secret."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


def normalize_sender(values: dict[str, str]) -> dict[str, str]:
    hook = (
        values.get("DISCORD_WEBHOOK", "").strip()
        or values.get("DISCORD_OVH_VPS_WEBHOOK", "").strip()
    )
    return {"DISCORD_WEBHOOK": hook} if hook.startswith("https://") else {}


def has_channel(values: dict[str, str]) -> bool:
    return bool(values.get("DISCORD_WEBHOOK"))


def render_env(values: dict[str, str]) -> bytes:
    hook = values.get("DISCORD_WEBHOOK", "")
    return f"DISCORD_WEBHOOK={hook}\n".encode("utf-8") if hook else b""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()

    values = normalize_sender(parse_env(args.source.expanduser().read_text()))
    if not has_channel(values):
        raise SystemExit("sender env has no Discord webhook")
    data = render_env(values)
    subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            args.target,
            "sudo mkdir -p /etc/vps-alert && "
            "sudo install -o root -g root -m 640 /dev/stdin /etc/vps-alert/.env.sender",
        ],
        input=data,
        check=True,
    )
    print("sender_installed_bytes", len(data), "channels discord", file=sys.stderr)
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
