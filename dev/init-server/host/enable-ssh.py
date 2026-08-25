#!/usr/bin/env python3
"""Enable the NetBird embedded SSH server on an already-joined host peer.

Does not close public TCP 22. Does not print setup keys.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

HOST_DIR = Path(__file__).resolve().parent
REMOTE = r"""
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
"""


def load_ssh_control():
    path = HOST_DIR / "ssh-control.py"
    spec = importlib.util.spec_from_file_location("ssh_control", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def usage(argv: list[str]) -> int:
    print(f"Usage: {argv[0]} --apply TARGET [--disable-ssh-auth]", file=sys.stderr)
    return 2


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] != "--apply" or not argv[2]:
        return usage(argv)
    target = argv[2]
    disable_ssh_auth = False
    if len(argv) == 4:
        if argv[3] != "--disable-ssh-auth":
            return usage(argv)
        disable_ssh_auth = True
    elif len(argv) != 3:
        return usage(argv)

    options = load_ssh_control().control_options()
    result = subprocess.run(
        [
            "ssh",
            *options,
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=20",
            target,
            f"sudo -n env DISABLE_SSH_AUTH={1 if disable_ssh_auth else 0} bash -s",
        ],
        input=REMOTE.lstrip("\n"),
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return result.returncode
    subprocess.run([str(HOST_DIR / "sync-log.py"), target], check=False)
    print(
        f"Enabled NetBird SSH server on {target}. Keep public TCP 22 open "
        "until overlay SSH is proven from an admin peer."
    )
    if disable_ssh_auth:
        print("JWT SSH auth is disabled. Access is machine ACL only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
