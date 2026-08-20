#!/bin/bash
# Push early-warning files to a host and run install + verify.
# Usage: apply.sh ovh-vps
# Requires /etc/vps-alert/.env.sender already on the host (copy-sender.py).
set -euo pipefail

TARGET=${1:?usage: apply.sh HOST}
ROOT=$(cd "$(dirname "$0")" && pwd)
source "${ROOT}/../ssh-options.sh"

ssh "${SSH_CONTROL_OPTIONS[@]}" -o BatchMode=yes "$TARGET" \
  'sudo bash -c "if [[ -f /etc/vps-alert/sender.env && ! -f /etc/vps-alert/.env.sender ]]; then mv /etc/vps-alert/sender.env /etc/vps-alert/.env.sender; fi; test -f /etc/vps-alert/.env.sender"' \
  || { echo "missing /etc/vps-alert/.env.sender on $TARGET; run copy-sender.py first" >&2; exit 1; }

echo ":: push files"
tar -C "$ROOT" --exclude copy-webhook.py --exclude copy-sender.py -cf - . \
  | ssh "${SSH_CONTROL_OPTIONS[@]}" -o BatchMode=yes "$TARGET" 'mkdir -p /home/debian/vps-early-warning && tar -C /home/debian/vps-early-warning -xf -'
echo ":: install"
ssh "${SSH_CONTROL_OPTIONS[@]}" -o BatchMode=yes "$TARGET" 'sudo stdbuf -oL -eL bash /home/debian/vps-early-warning/install.sh'
echo ":: verify"
ssh "${SSH_CONTROL_OPTIONS[@]}" -o BatchMode=yes "$TARGET" 'sudo stdbuf -oL -eL bash /home/debian/vps-early-warning/verify.sh'
