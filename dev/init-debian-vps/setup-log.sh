#!/usr/bin/env bash

VPS_SETUP_STATE_DIR=${VPS_SETUP_STATE_DIR:-/var/lib/vps-setup}
VPS_SETUP_LOG_DIR=${VPS_SETUP_LOG_DIR:-${VPS_SETUP_STATE_DIR}/.log}
VPS_SETUP_CURRENT_LOG=${VPS_SETUP_CURRENT_LOG:-${VPS_SETUP_STATE_DIR}/current-log}
declare -Ag VPS_SETUP_FILE_STATE=()

setup_log_init() {
    local mode=${1:-continue} stamp log

    install -d -o root -g root -m 0750 "$VPS_SETUP_LOG_DIR"
    if [[ $mode == new || ! -s $VPS_SETUP_CURRENT_LOG ]]; then
        stamp=$(date -u +%Y-%m-%d_%H-%M-%S)
        log="${VPS_SETUP_LOG_DIR}/${stamp}.log"
        while [[ -e $log ]]; do
            sleep 1
            stamp=$(date -u +%Y-%m-%d_%H-%M-%S)
            log="${VPS_SETUP_LOG_DIR}/${stamp}.log"
        done
        printf '%s\n' "$log" >"$VPS_SETUP_CURRENT_LOG"
        chmod 0640 "$VPS_SETUP_CURRENT_LOG"
        printf '# VPS setup change log\nstarted_at=%s\nhost=%s\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname -f)" >"$log"
        chmod 0640 "$log"
    fi

    VPS_SETUP_LOG=$(<"$VPS_SETUP_CURRENT_LOG")
    if [[ $VPS_SETUP_LOG != "$VPS_SETUP_LOG_DIR"/*.log ]]; then
        printf 'Invalid VPS setup log path: %s\n' "$VPS_SETUP_LOG" >&2
        return 1
    fi
    export VPS_SETUP_LOG
}

setup_log_before() {
    local path=$1
    if [[ -e $path || -L $path ]]; then
        VPS_SETUP_FILE_STATE["$path"]=MODIFIED
    else
        VPS_SETUP_FILE_STATE["$path"]=ADDED
    fi
}

setup_log_after() {
    local path=$1 action=${VPS_SETUP_FILE_STATE[$1]:-MODIFIED}
    printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$path" >>"$VPS_SETUP_LOG"
    unset 'VPS_SETUP_FILE_STATE[$path]'
}

setup_log_removed() {
    local path=$1
    printf '%s\tREMOVED\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$path" >>"$VPS_SETUP_LOG"
    unset 'VPS_SETUP_FILE_STATE[$path]'
}

setup_log_action() {
    printf '%s\tACTION\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >>"$VPS_SETUP_LOG"
}
