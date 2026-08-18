#!/usr/bin/env python3
from __future__ import annotations

import tempfile
from pathlib import Path

import doctor


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_inspect_ok(tmp: Path) -> None:
    here = tmp / "qemu"
    home = tmp / "home"
    _write(here / "wq.py", "")
    _write(here / "wq", "")
    _write(here / "guest" / "setup-ssh.ps1", "")
    path_wq = home / ".local/bin/wq"
    path_wq.parent.mkdir(parents=True, exist_ok=True)
    path_wq.symlink_to(here / "wq")
    _write(
        home / ".config/systemd/user/windows@.service.d/ssh-forward.conf",
        f"[Service]\nExecStartPost={here}/wq ssh-forward %i\n",
    )
    _write(
        home / ".config/containers/systemd/windows@.container",
        "[Container]\nTmpfs=/var/lib/nginx\n",
    )
    assert doctor.inspect(here=here, home=home) == []


def test_inspect_reports_drift(tmp: Path) -> None:
    here = tmp / "qemu"
    home = tmp / "home"
    _write(here / "wq.py", "")
    _write(home / ".agents/skills/windows-qemu/scripts/ssh_forward.py", "")
    _write(
        home / ".config/systemd/user/windows@.service.d/ssh-forward.conf",
        "ExecStartPost=/old/windows-ssh-forward.sh %i\n",
    )
    _write(home / ".config/containers/systemd/windows@.container", "[Container]\n")
    fails = doctor.inspect(here=here, home=home)
    joined = "\n".join(fails)
    assert "missing" in joined and "setup-ssh.ps1" in joined
    assert "stale skill scripts" in joined
    assert "PATH wq missing" in joined
    assert "drop-in must call" in joined
    assert "old wrapper" in joined
    assert "Tmpfs=/var/lib/nginx" in joined


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="wq-doctor-") as tmp:
        root = Path(tmp)
        test_inspect_ok(root / "ok")
        test_inspect_reports_drift(root / "bad")
    print("ok")
