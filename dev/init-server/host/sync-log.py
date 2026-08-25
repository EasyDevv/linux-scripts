#!/usr/bin/env python3
"""Copy the VPS setup change log to the local .log directory."""
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
from pathlib import Path

HOST_DIR = Path(__file__).resolve().parent
ROOT = HOST_DIR.parent
LOG_RE = re.compile(
    r"^/var/lib/vps-setup/\.log/[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}\.log$"
)


def load_ssh_control():
    path = HOST_DIR / "ssh-control.py"
    spec = importlib.util.spec_from_file_location("ssh_control", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_target_dir(target: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", target)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"Usage: {argv[0]} SSH_TARGET", file=sys.stderr)
        return 2
    target = argv[1]
    ssh_control = load_ssh_control()
    options = ssh_control.control_options()
    log_dir = Path(os.environ.get("VPS_SETUP_LOCAL_LOG_DIR") or ROOT / ".log")
    result = subprocess.run(
        [
            "ssh",
            *options,
            "-o",
            "ConnectTimeout=10",
            target,
            "if sudo test -s /var/lib/vps-setup/current-log; then "
            "sudo /usr/bin/awk 'NR == 1 { print; exit }' /var/lib/vps-setup/current-log; fi",
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    remote_log = (result.stdout or "").strip()
    if not remote_log:
        print(f"No VPS setup change log available on {target}.")
        return 0
    if not LOG_RE.match(remote_log):
        print(f"Refusing unexpected remote log path: {remote_log}", file=sys.stderr)
        return 1
    local_dir = log_dir / safe_target_dir(target)
    local_log = local_dir / Path(remote_log).name
    temp_log = local_log.with_suffix(local_log.suffix + ".tmp")
    local_dir.mkdir(parents=True, exist_ok=True)
    try:
        pulled = subprocess.run(
            [
                "ssh",
                *options,
                "-o",
                "ConnectTimeout=10",
                target,
                f"sudo /bin/cat -- '{remote_log}'",
            ],
            check=True,
            capture_output=True,
        )
        temp_log.write_bytes(pulled.stdout)
        temp_log.replace(local_log)
        local_log.chmod(0o600)
    finally:
        temp_log.unlink(missing_ok=True)
    print(f"Local change log: {local_log}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
