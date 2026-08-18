#!/usr/bin/env python3
"""Resolve dockur/windows Quadlet instances without hardcoding 01/02."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

ENV_DIR = Path.home() / ".config" / "containers" / "systemd" / "envs"
SHARED_DIR = Path.home() / "windows-data" / "shared"
SETUP_DIR = SHARED_DIR / "scripts" / "windows-setup"
SSH_DIR = Path.home() / ".ssh"
IDENTITY = SSH_DIR / "windows"
SSH_CONFIG = SSH_DIR / "config"
REQUIRED_ENV_KEYS = ("SSH_PORT", "WEB_PORT", "RDP_PORT", "VM_NET_IP")
DEFAULT_EXIT_NODE = "redmi-note-3"
HOST_ISP_IP = "211.245.140.95"
GUEST_SCRIPTS = "C:/Users/Docker/Scripts"
GUEST_SETUP = "C:/Users/Docker/Desktop/Shared/scripts/windows-setup"


def parse_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def normalize_instance(value: str) -> str:
    text = value.strip()
    text = text.removeprefix("windows@")
    text = text.removeprefix("windows-")
    if not re.fullmatch(r"[0-9A-Za-z]+", text):
        raise ValueError(f"invalid instance id: {value!r}")
    return text


def env_path(instance: str) -> Path:
    return ENV_DIR / f"{normalize_instance(instance)}.env"


def list_instances() -> list[str]:
    if not ENV_DIR.is_dir():
        return []
    return sorted(path.stem for path in ENV_DIR.glob("*.env"))


def resolve(instance: str) -> dict[str, Any]:
    ident = normalize_instance(instance)
    path = env_path(ident)
    record: dict[str, Any] = {
        "instance": ident,
        "env_path": str(path),
        "container": f"windows-{ident}",
        "unit": f"windows@{ident}",
        "ssh_alias": f"windows-{ident}",
        "shared_dir": str(SHARED_DIR),
        "setup_dir": str(SETUP_DIR),
        "identity_file": str(IDENTITY),
        "errors": [],
    }
    if not path.exists():
        record["errors"] = [f"missing env file: {path}"]
        return record
    env = parse_env(path)
    missing = [key for key in REQUIRED_ENV_KEYS if not env.get(key)]
    if missing:
        record["errors"] = [f"missing required env keys: {', '.join(missing)}"]
    record["ssh_port"] = env.get("SSH_PORT")
    record["web_port"] = env.get("WEB_PORT")
    record["rdp_port"] = env.get("RDP_PORT")
    record["edge_port"] = env.get("EDGE_PORT")
    record["vm_net_ip"] = env.get("VM_NET_IP")
    record["vm_net_host"] = env.get("VM_NET_HOST") or env.get("HOST")
    return record


def require(instance: str) -> dict[str, Any]:
    record = resolve(instance)
    if record["errors"]:
        raise SystemExit("; ".join(record["errors"]))
    return record
