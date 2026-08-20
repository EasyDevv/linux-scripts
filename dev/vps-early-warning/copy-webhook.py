#!/usr/bin/python3
"""Copy the local Discord webhook to ovh-vps without printing it."""

from pathlib import Path
import subprocess
import sys

SRC = Path.home() / "dev/product/property-portal/.env.discord"
data = SRC.read_bytes()
if b"DISCORD_WEBHOOK=" not in data:
    raise SystemExit("webhook key missing")
subprocess.run(
    [
        "ssh",
        "-o",
        "BatchMode=yes",
        "ovh-vps",
        "sudo mkdir -p /etc/vps-alert && sudo install -o root -g root -m 640 /dev/stdin /etc/vps-alert/discord.env",
    ],
    input=data,
    check=True,
)
print("webhook_installed_bytes", len(data), file=sys.stderr)
print("ok")
