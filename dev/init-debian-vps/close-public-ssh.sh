#!/usr/bin/env bash
# Remove public TCP 22 after overlay SSH is already proven.
# Does not flush nftables. Does not stop sshd. Does not print secrets.
set -Eeuo pipefail

if [[ ${1:-} != --apply || -z ${2:-} ]]; then
    printf 'Usage: %s --apply TARGET\n' "$0" >&2
    exit 2
fi

target=$2
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Rollback path must still work over the current SSH config.
if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "$target" 'printf "rollback-ssh-ok\n"' >/dev/null; then
    printf 'Current ssh %s failed. Fix operator SSH before closing public 22.\n' "$target" >&2
    exit 1
fi

ssh -o BatchMode=yes -o ConnectTimeout=20 "$target" 'sudo -n bash -s' <<'REMOTE'
set -Eeuo pipefail
if ! command -v netbird >/dev/null || ! netbird status | grep -q 'SSH Server: Enabled'; then
    printf 'SSH Server is not Enabled. Refuse to close public 22.\n' >&2
    exit 1
fi
if ! systemctl is-active --quiet ssh && ! systemctl is-active --quiet sshd; then
    printf 'sshd is not active. Refuse to close public 22.\n' >&2
    exit 1
fi

conf=/etc/nftables.conf
if [[ ! -f $conf ]]; then
    printf 'missing %s\n' "$conf" >&2
    exit 1
fi
ts=$(date -u +%Y%m%dT%H%M%SZ)
cp -a "$conf" "$conf.bak.$ts"

python3 - <<'PY'
import re
from pathlib import Path
path = Path("/etc/nftables.conf")
text = path.read_text()
if "tcp dport { 80, 443 }" in text and "tcp dport { 22, 80, 443 }" not in text:
    print("nftables.conf already without public 22")
else:
    updated, n = re.subn(
        r'(\s*iifname "podman\*" meta l4proto \{ tcp, udp \} th dport 53 accept)\s*\n'
        r'(\s*)tcp dport \{ 22, 80, 443 \} ct state new accept\s*\n',
        r'\1\n\2iifname "wt0" accept\n\2tcp dport { 80, 443 } ct state new accept\n',
        text,
        count=1,
    )
    if n != 1:
        raise SystemExit("expected nftables public-port block not found")
    path.write_text(updated)
    print("nftables.conf updated")
PY

# Live cut only. Never `nft -f` here: the file starts with flush ruleset.
mapfile -t handles < <(nft -a list chain inet filter input | awk '/tcp dport \\{ 22, 80, 443 \\}/ {print $NF}')
if ((${#handles[@]})); then
    for handle in "${handles[@]}"; do
        nft replace rule inet filter input handle "$handle" tcp dport '{ 80, 443 }' ct state new accept
    done
    print_live=1
else
    print_live=0
    printf 'No live { 22, 80, 443 } rule; assuming already cut.\n'
fi
if ! nft list chain inet filter input | grep -q 'iifname "wt0"'; then
    nft insert rule inet filter input iifname wt0 accept
fi
nft list chain inet filter input
REMOTE

"${script_dir}/sync-vps-setup-log.sh" "$target"
printf 'Public TCP 22 removed on %s. Prove overlay SSH immediately. Leave sshd running.\n' "$target"
