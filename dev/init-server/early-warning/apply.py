#!/usr/bin/env python3
"""Push early-warning files to a host and run install + verify.

Usage: apply.py HOST
Requires /etc/vps-alert/.env.sender already on the host (copy-sender.py).
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST_DIR = ROOT.parent / "host"
EXCLUDE = {
    "apply.py",
    "copy-sender.py",
    "copy-webhook.py",
    "send-test.py",
    "__pycache__",
}


def load_ssh_control():
    path = HOST_DIR / "ssh-control.py"
    spec = importlib.util.spec_from_file_location("ssh_control", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} HOST", file=sys.stderr)
        return 2
    target = argv[1]
    options = load_ssh_control().control_options()
    check = subprocess.run(
        [
            "ssh",
            *options,
            "-o",
            "BatchMode=yes",
            target,
            'sudo bash -c "if [[ -f /etc/vps-alert/sender.env && ! -f /etc/vps-alert/.env.sender ]]; then '
            "mv /etc/vps-alert/sender.env /etc/vps-alert/.env.sender; fi; "
            'test -f /etc/vps-alert/.env.sender"',
        ],
        check=False,
    )
    if check.returncode != 0:
        print(
            f"missing /etc/vps-alert/.env.sender on {target}; run copy-sender.py first",
            file=sys.stderr,
        )
        return 1

    print(":: push files")
    tar_cmd = subprocess.Popen(
        [
            "ssh",
            *options,
            "-o",
            "BatchMode=yes",
            target,
            "mkdir -p /home/debian/vps-early-warning && tar -C /home/debian/vps-early-warning -xf -",
        ],
        stdin=subprocess.PIPE,
    )
    assert tar_cmd.stdin is not None
    with tarfile.open(fileobj=tar_cmd.stdin, mode="w|") as archive:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT)
            if any(part in EXCLUDE for part in rel.parts):
                continue
            archive.add(path, arcname=str(rel))
    tar_cmd.stdin.close()
    if tar_cmd.wait() != 0:
        return tar_cmd.returncode or 1

    print(":: install")
    install = subprocess.run(
        [
            "ssh",
            *options,
            "-o",
            "BatchMode=yes",
            target,
            "sudo stdbuf -oL -eL bash /home/debian/vps-early-warning/install.sh",
        ],
        check=False,
    )
    if install.returncode != 0:
        return install.returncode
    print(":: verify")
    verify = subprocess.run(
        [
            "ssh",
            *options,
            "-o",
            "BatchMode=yes",
            target,
            "sudo stdbuf -oL -eL bash /home/debian/vps-early-warning/verify.sh",
        ],
        check=False,
    )
    return verify.returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
