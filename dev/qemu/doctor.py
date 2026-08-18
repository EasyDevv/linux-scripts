#!/usr/bin/env python3
"""Check the windows-qemu operator home before guest work.

Catches layout drift that looks like a dead VM: missing scripts, a
skill-local copy, a PATH launcher that does not resolve, a drop-in
pointing at the old wrapper, or an image missing /var/lib/nginx.
"""
from __future__ import annotations

import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL_SCRIPTS = Path.home() / ".agents/skills/windows-qemu/scripts"
QUADLET_SKILL = (
    Path.home() / ".config/containers/systemd/.agents/skills/windows-qemu"
)
DROPIN = Path.home() / ".config/systemd/user/windows@.service.d/ssh-forward.conf"
CONTAINER = Path.home() / ".config/containers/systemd/windows@.container"
PATH_WQ = Path.home() / ".local/bin/wq"


def inspect(*, here: Path | None = None, home: Path | None = None) -> list[str]:
    here = here or HERE
    home = home or Path.home()
    skill_scripts = home / ".agents/skills/windows-qemu/scripts"
    quadlet_skill = home / ".config/containers/systemd/.agents/skills/windows-qemu"
    dropin = home / ".config/systemd/user/windows@.service.d/ssh-forward.conf"
    container = home / ".config/containers/systemd/windows@.container"
    path_wq = home / ".local/bin/wq"
    fails: list[str] = []

    if not (here / "wq.py").is_file():
        fails.append(f"missing {here / 'wq.py'}")
    if not (here / "guest" / "setup-ssh.ps1").is_file():
        fails.append(f"missing {here / 'guest' / 'setup-ssh.ps1'}")
    if skill_scripts.exists():
        fails.append(f"stale skill scripts at {skill_scripts}; use {here}")
    if quadlet_skill.exists():
        fails.append(f"stale Quadlet skill copy at {quadlet_skill}; use {here}")

    if path_wq.exists() or path_wq.is_symlink():
        try:
            resolved = path_wq.resolve()
        except OSError as exc:
            fails.append(f"PATH wq is broken: {exc}")
        else:
            expected = (here / "wq").resolve()
            if resolved != expected:
                fails.append(f"PATH wq resolves to {resolved}, expected {expected}")
    else:
        fails.append(f"PATH wq missing at {path_wq}")

    if not dropin.is_file():
        fails.append(f"missing drop-in {dropin}")
    else:
        text = dropin.read_text(encoding="utf-8")
        needle = f"{here}/wq ssh-forward"
        if needle not in text:
            fails.append(f"drop-in must call {needle} %i")
        if "windows-ssh-forward" in text or "windows-qemu/scripts" in text:
            fails.append("drop-in still points at the old wrapper or skill scripts")

    if not container.is_file():
        fails.append(f"missing {container}")
    elif "Tmpfs=/var/lib/nginx" not in container.read_text(encoding="utf-8"):
        fails.append(f"{container} needs Tmpfs=/var/lib/nginx")

    return fails


def main() -> int:
    parser = argparse.ArgumentParser(description="check windows-qemu operator home")
    parser.parse_args()
    fails = inspect()
    if not fails:
        print(f"doctor: ok ({HERE})")
        return 0
    for item in fails:
        print(f"doctor: {item}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
