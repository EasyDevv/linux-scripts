#!/usr/bin/env bash
set -Eeuo pipefail

mode=${1:-}
target=${2:-}
domain=${3:-}
script_dir=$(dirname "$(readlink -f "$0")")

if [[ $mode != --apply && $mode != --remove ]] || [[ -z $target || -z $domain ]]; then
    printf 'Usage: %s --apply SSH_TARGET DOMAIN [IPV4]\n' "$0" >&2
    printf '       %s --remove SSH_TARGET DOMAIN\n' "$0" >&2
    exit 2
fi

allowed_ip=
if [[ $mode == --apply ]]; then
    allowed_ip=${4:-$(curl -4 -fsS --max-time 10 https://api.ipify.org)}
fi

scp -q \
    "${script_dir}/setup-log.sh" \
    "${script_dir}/configure-netbird-setup-guard.sh" \
    "${script_dir}/netbird-setup-guard.sh" \
    "${target}:/tmp/"

ssh -o ConnectTimeout=10 "$target" \
    sudo /bin/bash /tmp/configure-netbird-setup-guard.sh "$mode" "$domain" "$allowed_ip"

"${script_dir}/sync-vps-setup-log.sh" "$target"
