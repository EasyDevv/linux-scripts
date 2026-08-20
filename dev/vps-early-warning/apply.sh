#!/bin/bash
# Push early-warning files to a host and run install + verify.
# Usage: apply.sh ovh-vps
# Requires /etc/vps-alert/discord.env already on the host (copy-webhook.py).
set -euo pipefail

TARGET=${1:?usage: apply.sh HOST}
ROOT=$(cd "$(dirname "$0")" && pwd)

ssh -o BatchMode=yes "$TARGET" 'test -f /etc/vps-alert/discord.env' \
  || { echo "missing /etc/vps-alert/discord.env on $TARGET; run copy-webhook.py first" >&2; exit 1; }

tar -C "$ROOT" --exclude copy-webhook.py -cf - . \
  | ssh -o BatchMode=yes "$TARGET" 'mkdir -p /home/debian/vps-early-warning && tar -C /home/debian/vps-early-warning -xf -'
ssh -o BatchMode=yes "$TARGET" 'sudo bash /home/debian/vps-early-warning/install.sh'
ssh -o BatchMode=yes "$TARGET" 'sudo bash /home/debian/vps-early-warning/verify.sh'
