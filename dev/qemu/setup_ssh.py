#!/usr/bin/env python3
"""Unattended host+guest OpenSSH bootstrap for a dockur/windows instance."""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cache_openssh import ensure as ensure_openssh
from debloat import apply as apply_debloat
from host_ssh import copy_pubkey_to_shared, ensure_identity, upsert_host_block
from lib import GUEST_SETUP, SETUP_DIR, require
from qemu_keys import send_monitor, encode_text, win_path
from ssh_forward import apply_forward, wait_container
from ssh_probe import guest_ssh, ssh_alias, tcp_banner
from stage import stage_pre_ssh

RUN_PATH = f"{GUEST_SETUP}/setup-ssh.bat"
STATUS_FILE = SETUP_DIR / "ssh-setup.status"


def wait_status(timeout: int) -> str:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        if STATUS_FILE.exists():
            last = STATUS_FILE.read_text(encoding="utf-8", errors="replace")
            if "sshd Running" in last or "sshd Running Automatic" in last:
                return last
        time.sleep(2)
    raise SystemExit(f"guest SSH setup did not finish:\n{last}")


def run_guest_setup(container: str) -> None:
    if STATUS_FILE.exists():
        STATUS_FILE.unlink()
    send_monitor(container, ["esc"], 70)
    time.sleep(0.2)
    send_monitor(container, ["meta_l-r"], 90)
    time.sleep(0.7)
    send_monitor(container, encode_text(win_path(RUN_PATH)), 40)
    time.sleep(0.2)
    send_monitor(container, ["ret"], 70)
    time.sleep(1.2)
    send_monitor(container, ["ret"], 70)
    time.sleep(0.8)
    send_monitor(container, ["alt-y"], 90)


def restart_unit(unit: str) -> None:
    result = subprocess.run(
        ["systemctl", "--user", "restart", unit],
        check=False,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or f"restart failed: {unit}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance")
    parser.add_argument("--skip-guest", action="store_true")
    parser.add_argument("--skip-debloat", action="store_true")
    parser.add_argument("--restart", action="store_true")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    rec = require(args.instance)

    if args.restart:
        restart_unit(rec["unit"])

    ensure_identity()
    upsert_host_block(rec["ssh_alias"], rec["ssh_port"])
    copy_pubkey_to_shared()
    copied = stage_pre_ssh()
    if copied:
        print("staged missing pre-SSH files: " + ", ".join(copied))
    ensure_openssh()
    wait_container(rec["container"], args.timeout)
    apply_forward(rec["container"], rec["vm_net_ip"])

    guest = guest_ssh(rec["container"], rec["vm_net_ip"])
    host = tcp_banner("127.0.0.1", int(rec["ssh_port"]))
    if not args.skip_guest and not guest["ok"]:
        run_guest_setup(rec["container"])
        wait_status(args.timeout)
        apply_forward(rec["container"], rec["vm_net_ip"])
        guest = guest_ssh(rec["container"], rec["vm_net_ip"])
        host = tcp_banner("127.0.0.1", int(rec["ssh_port"]))

    alias = ssh_alias(rec["ssh_alias"])
    print(f"unit: {rec['unit']}")
    print(f"alias: {rec['ssh_alias']}")
    print(f"guest_ssh: {'ok' if guest['ok'] else guest['error']}")
    print(f"host_listen: {'ok' if host['ok'] else host['error']}")
    print(f"ssh: {'ok' if alias['ok'] else alias['stderr'] or alias['stdout']}")
    if not alias["ok"]:
        return 1
    if not args.skip_debloat:
        print("debloat: applying cached preset, then leftover verify")
        return apply_debloat(args.instance, timeout=max(args.timeout, 1800))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
