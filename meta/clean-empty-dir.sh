#!/usr/bin/env bash

set -euo pipefail

usage() {
    printf 'Usage: %s [DIR ...]\n' "${0##*/}"
    printf 'Recursively remove empty directories under each DIR.\n'
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
    usage
    exit 0
fi

roots=("$@")
if (( ${#roots[@]} == 0 )); then
    roots=(.)
fi

for root in "${roots[@]}"; do
    if [[ ! -d $root ]]; then
        printf 'clean-empty-dir: not a directory: %s\n' "$root" >&2
        exit 1
    fi
done

find -- "${roots[@]}" -mindepth 1 -depth -type d -empty -delete
