#!/usr/bin/env python3
"""Shared operator-side SSH multiplexing options."""
from __future__ import annotations

import os
from pathlib import Path


def control_dir(env: dict[str, str] | None = None) -> Path:
    values = os.environ if env is None else env
    override = values.get("SSH_CONTROL_DIR")
    if override:
        path = Path(override)
    else:
        runtime = values.get("XDG_RUNTIME_DIR")
        path = (
            Path(runtime) / "easydev-ssh-control"
            if runtime
            else Path.home() / ".cache/easydev-ssh-control"
        )
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return path


def control_options(env: dict[str, str] | None = None) -> list[str]:
    path = control_dir(env)
    return [
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPersist=120",
        "-o",
        f"ControlPath={path}/%C",
    ]
