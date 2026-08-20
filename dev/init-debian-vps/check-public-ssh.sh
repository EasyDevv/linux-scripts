#!/usr/bin/env bash
# Classify operator SSH after a wipe. Does not write ~/.ssh.
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
    printf 'Usage: %s TARGET\n' "$0" >&2
    exit 2
fi

target=$1
hostname=$(ssh -G "$target" | awk 'tolower($1) == "hostname" { print $2; exit }')
user=$(ssh -G "$target" | awk 'tolower($1) == "user" { print $2; exit }')
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
isolated=$tmp_dir/known_hosts
default_err=$tmp_dir/default.err
isolated_err=$tmp_dir/isolated.err
default_out=$tmp_dir/default.out
isolated_out=$tmp_dir/isolated.out

printf 'target=%s user=%s hostname=%s\n' "$target" "$user" "$hostname"

if [[ $hostname == 100.* ]]; then
    printf 'FAIL HostName is an overlay address. Set Host %s HostName to the public IPv4, then rerun.\n' "$target" >&2
    exit 1
fi

ssh_try() {
    local err=$1 out=$2
    shift 2
    ssh -T -o BatchMode=yes -o RequestTTY=no -o ConnectTimeout=10 -o ConnectionAttempts=1 \
        -o ControlMaster=no -o ControlPath=none \
        "$@" "$target" 'printf "%s\n" "$(whoami)"' >"$out" 2>"$err" && return 0
    return 1
}

classify() {
    local err=$1
    if grep -q 'Host key verification failed\|REMOTE HOST IDENTIFICATION HAS CHANGED\|WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED' "$err"; then
        printf 'hostkey'
    elif grep -qi 'not a valid known_hosts file\|invalid line' "$err"; then
        printf 'invalid_known_hosts'
    elif grep -q 'Permission denied (publickey)' "$err"; then
        printf 'publickey'
    elif grep -q 'Connection timed out\|Connection refused\|Network is unreachable' "$err"; then
        printf 'unreachable'
    else
        printf 'other'
    fi
}

default_ok=0
isolated_ok=0
if ssh_try "$default_err" "$default_out"; then
    default_ok=1
    default_class=ok
else
    default_class=$(classify "$default_err")
fi
if ssh_try "$isolated_err" "$isolated_out" \
    -o UserKnownHostsFile="$isolated" \
    -o GlobalKnownHostsFile=/dev/null \
    -o StrictHostKeyChecking=accept-new; then
    isolated_ok=1
    isolated_class=ok
else
    isolated_class=$(classify "$isolated_err")
fi

printf 'default=%s isolated=%s\n' "$default_class" "$isolated_class"

if [[ $default_ok -eq 1 ]]; then
    who=$(tr -d '\r' <"$default_out")
    if [[ $who != "$user" ]]; then
        printf 'FAIL ssh %s logged in as %s, expected %s.\n' "$target" "$who" "$user" >&2
        exit 1
    fi
    printf 'PASS public key SSH as %s on %s\n' "$user" "$hostname"
    exit 0
fi

if [[ $default_class == hostkey || $default_class == invalid_known_hosts ]]; then
    printf 'Host-key layer blocked the default known_hosts file.\n' >&2
    if [[ $default_class == invalid_known_hosts ]]; then
        printf 'Fix the invalid line in ~/.ssh/known_hosts first, then remove the stale host key.\n' >&2
    fi
    printf 'Operator only (do not edit ~/.ssh from an agent vault):\n' >&2
    printf '  ssh-keygen -R %s\n' "$hostname" >&2
    if [[ $hostname != "$target" ]]; then
        printf '  ssh-keygen -R %s\n' "$target" >&2
    fi
    printf 'Then rerun %s %s\n' "$0" "$target" >&2
    if [[ $isolated_ok -eq 1 ]]; then
        printf 'Isolated known_hosts already works. This is not a missing guest key.\n' >&2
        exit 1
    fi
    if [[ $isolated_class == publickey ]]; then
        printf 'After ssh-keygen -R, expect Permission denied (publickey) until authorized_keys has this key.\n' >&2
    fi
    exit 1
fi

if [[ $default_class == publickey || $isolated_class == publickey ]]; then
    printf 'FAIL guest rejected the operator key (authorized_keys). This is not a known_hosts problem.\n' >&2
    printf 'Do not start bootstrap. Use the VNC console, ovhcloud vps set-password, or reinstall with a verified pubkey.\n' >&2
    exit 1
fi

printf 'FAIL ssh %s: default=%s isolated=%s\n' "$target" "$default_class" "$isolated_class" >&2
if [[ -s $default_err ]]; then
    tail -n 3 "$default_err" >&2
fi
exit 1
