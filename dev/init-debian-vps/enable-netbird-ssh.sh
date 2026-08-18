#!/usr/bin/env bash
# Enable the NetBird embedded SSH server on an already-joined host peer.
# Does not close public TCP 22. Does not print setup keys.
set -Eeuo pipefail

usage() {
    printf 'Usage: %s --apply TARGET [--disable-ssh-auth]\n' "$0" >&2
    exit 2
}

if [[ ${1:-} != --apply || -z ${2:-} ]]; then
    usage
fi

target=$2
disable_ssh_auth=0
if [[ ${3:-} == --disable-ssh-auth ]]; then
    disable_ssh_auth=1
elif [[ -n ${3:-} ]]; then
    usage
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A connected daemon ignores a second `netbird up`. Down first, then up with flags.
ssh -o BatchMode=yes -o ConnectTimeout=20 "$target" "sudo -n env DISABLE_SSH_AUTH=$disable_ssh_auth bash -s" <<'REMOTE'
set -Eeuo pipefail
if ! command -v netbird >/dev/null; then
    printf 'netbird client is not installed.\n' >&2
    exit 1
fi
if ! netbird status 2>/dev/null | grep -q 'Management: Connected'; then
    printf 'NetBird client is not connected. Join the host before enabling SSH.\n' >&2
    exit 1
fi
up_args=(--allow-server-ssh --no-browser)
if [[ ${DISABLE_SSH_AUTH:-0} == 1 ]]; then
    up_args+=(--disable-ssh-auth)
fi
netbird down
netbird up "${up_args[@]}"
sleep 2
netbird status | awk '/Management:|Signal:|FQDN:|NetBird IP:|SSH/'
ip -4 -br addr show wt0
if ! netbird status | grep -q 'SSH Server: Enabled'; then
    printf 'SSH Server is still Disabled after down/up. Do not close public 22.\n' >&2
    exit 1
fi
REMOTE

"${script_dir}/sync-vps-setup-log.sh" "$target"
printf 'Enabled NetBird SSH server on %s. Keep public TCP 22 open until overlay SSH is proven from an admin peer.\n' "$target"
if [[ $disable_ssh_auth -eq 1 ]]; then
    printf 'JWT SSH auth is disabled. Access is machine ACL only.\n'
fi
