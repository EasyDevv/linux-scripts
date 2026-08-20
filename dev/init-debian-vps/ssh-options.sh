#!/usr/bin/env bash
# Shared client-side SSH multiplexing options. Source this file; do not execute it.

ssh_control_dir=${SSH_CONTROL_DIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}/easydev-ssh-control}
mkdir -p -- "$ssh_control_dir"
chmod 0700 -- "$ssh_control_dir"

SSH_CONTROL_OPTIONS=(
    -o ControlMaster=auto
    -o ControlPersist=120
    -o "ControlPath=${ssh_control_dir}/%C"
)
