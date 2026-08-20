#!/usr/bin/env python3
"""Idempotently add a managed overlay alias by copying safe source-host options."""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

SAFE_KEYS = ("user", "identityfile", "identitiesonly", "port")


def blocks(text: str) -> list[tuple[int, int, list[str], dict[str, str]]]:
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if re.match(r"^\s*Host\s+", line, re.I)]
    result = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(lines)
        names = lines[start].strip().split()[1:]
        options: dict[str, str] = {}
        for line in lines[start + 1 : end]:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or " " not in stripped:
                continue
            key, value = stripped.split(None, 1)
            options[key.lower()] = value
        result.append((start, end, names, options))
    return result


def render(alias: str, hostname: str, options: dict[str, str]) -> str:
    rows = [f"# BEGIN init-debian-vps alias:{alias}\n", f"Host {alias}\n"]
    rows.append(f"    HostName {hostname}\n")
    rows.append("    UserKnownHostsFile ~/.ssh/known_hosts.netbird\n")
    rows.append("    StrictHostKeyChecking accept-new\n")
    for key in SAFE_KEYS:
        if key not in options:
            continue
        label = {
            "user": "User",
            "identityfile": "IdentityFile",
            "identitiesonly": "IdentitiesOnly",
            "port": "Port",
        }[key]
        rows.append(f"    {label} {options[key]}\n")
    rows.append(f"# END init-debian-vps alias:{alias}\n")
    return "".join(rows)


def reconcile(text: str, source: str, alias: str, hostname: str) -> tuple[str, str]:
    source_blocks = [b for b in blocks(text) if source in b[2]]
    if len(source_blocks) != 1:
        raise ValueError(f"expected one exact Host {source} block")
    if any(ch in source for ch in "*?!"):
        raise ValueError("source host must not be a pattern")
    source_options = source_blocks[0][3]
    managed = re.compile(
        rf"(?ms)^# BEGIN init-debian-vps alias:{re.escape(alias)}\n.*?"
        rf"^# END init-debian-vps alias:{re.escape(alias)}\n?"
    )
    unmanaged = [b for b in blocks(text) if alias in b[2]]
    desired = render(alias, hostname, source_options)
    match = managed.search(text)
    if match:
        updated = text[: match.start()] + desired + text[match.end() :]
        action = "noop" if updated == text else "replace"
        return updated, action
    if unmanaged:
        if len(unmanaged) != 1:
            raise ValueError(f"Host {alias} appears in multiple unmanaged blocks")
        start, end, names, options = unmanaged[0]
        if names != [alias]:
            raise ValueError(f"Host {alias} shares an unmanaged block; refusing to replace it")
        expected = {"hostname": hostname}
        expected.update({key: source_options[key] for key in SAFE_KEYS if key in source_options})
        actual = {key: value for key, value in options.items() if key in {*SAFE_KEYS, "hostname"}}
        if actual != expected:
            raise ValueError(f"Host {alias} exists with different options; refusing to replace it")
        lines = text.splitlines(keepends=True)
        updated = "".join([*lines[:start], desired, *lines[end:]])
        return updated, "adopt"
    separator = "" if not text or text.endswith("\n\n") else "\n"
    return text + separator + desired, "add"


def verify(path: Path, alias: str, hostname: str) -> None:
    result = subprocess.run(
        ["ssh", "-G", "-F", str(path), alias],
        text=True,
        capture_output=True,
        check=True,
    )
    resolved = dict(
        line.split(None, 1) for line in result.stdout.splitlines() if " " in line
    )
    if resolved.get("hostname") != hostname:
        raise ValueError(f"alias resolves to {resolved.get('hostname')}, expected {hostname}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--alias", required=True)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--config", type=Path, default=Path.home() / ".ssh/config")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    text = args.config.read_text() if args.config.exists() else ""
    updated, action = reconcile(text, args.source, args.alias, args.hostname)
    print(f"PLAN action={action} alias={args.alias} hostname={args.hostname}")
    if not args.apply or action == "noop":
        return 0

    args.config.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = args.config.with_suffix(args.config.suffix + ".bak")
    if args.config.exists():
        shutil.copy2(args.config, backup)
    fd, temp_name = tempfile.mkstemp(prefix="config.", dir=args.config.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(updated)
        os.chmod(temp, 0o600)
        verify(temp, args.alias, args.hostname)
        os.replace(temp, args.config)
    finally:
        temp.unlink(missing_ok=True)
    print(f"PASS wrote {args.alias}; backup={backup if backup.exists() else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
