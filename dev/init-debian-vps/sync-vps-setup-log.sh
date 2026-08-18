#!/usr/bin/env bash
set -Eeuo pipefail

target=${1:?Usage: sync-vps-setup-log.sh SSH_TARGET}
script_dir=$(dirname "$(readlink -f "$0")")
log_dir=${VPS_SETUP_LOCAL_LOG_DIR:-${script_dir}/.log}

remote_log=$(ssh -o ConnectTimeout=10 "$target" \
    'if sudo test -s /var/lib/vps-setup/current-log; then sudo /usr/bin/awk '\''NR == 1 { print; exit }'\'' /var/lib/vps-setup/current-log; fi')

if [[ -z $remote_log ]]; then
    printf 'No VPS setup change log available on %s.\n' "$target"
    exit 0
fi
if [[ ! $remote_log =~ ^/var/lib/vps-setup/\.log/[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}\.log$ ]]; then
    printf 'Refusing unexpected remote log path: %s\n' "$remote_log" >&2
    exit 1
fi

target_dir=${target//[^[:alnum:]._-]/_}
local_dir=${log_dir}/${target_dir}
local_log=${local_dir}/${remote_log##*/}
temp_log=${local_log}.tmp
mkdir -p "$local_dir"
trap 'rm -f "$temp_log"' EXIT
ssh -o ConnectTimeout=10 "$target" "sudo /bin/cat -- '$remote_log'" >"$temp_log"
mv "$temp_log" "$local_log"
trap - EXIT
chmod 0600 "$local_log"
printf 'Local change log: %s\n' "$local_log"
