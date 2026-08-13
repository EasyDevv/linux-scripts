#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


GLOBAL_PROTOTOOLS_PATH = Path.home() / ".proto" / ".prototools"
MOON_SCHEMA_LINE = "$schema: 'https://moonrepo.dev/schemas/toolchain.json'"
CLEAN_DIR_NAMES = {"node_modules", "dist", ".cache"}
CLEAN_FILE_NAMES = {"bun.lock", "bun.lockb"}


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=str(cwd) if cwd else None, check=True)


def capture(command: list[str], cwd: Path | None = None) -> str:
    completed = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def detect_repo_root(repo_arg: str | None) -> Path:
    if repo_arg:
        return Path(repo_arg).expanduser().resolve()

    try:
        root = capture(["git", "rev-parse", "--show-toplevel"])
        if root:
            return Path(root).resolve()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    return Path.cwd().resolve()


def resolve_toolchain_path(repo_root: Path) -> Path:
    singular = repo_root / ".moon" / "toolchain.yml"
    plural = repo_root / ".moon" / "toolchains.yml"

    if singular.exists():
        return singular
    if plural.exists():
        return plural

    return singular


def install_and_pin_global_bun(version_spec: str) -> None:
    run(
        [
            "proto",
            "install",
            "--config-mode",
            "global",
            "bun",
            version_spec,
            "--pin",
            "global",
            "-y",
        ]
    )


def read_pinned_global_bun_version() -> str:
    if not GLOBAL_PROTOTOOLS_PATH.exists():
        raise RuntimeError(f"Global proto config not found: {GLOBAL_PROTOTOOLS_PATH}")

    text = GLOBAL_PROTOTOOLS_PATH.read_text()
    match = re.search(r'(?m)^bun\s*=\s*"([^"]+)"\s*$', text)
    if not match:
        raise RuntimeError(f'Could not find a pinned Bun version in {GLOBAL_PROTOTOOLS_PATH}')

    return match.group(1)


def update_package_json(package_json_path: Path, version: str) -> None:
    if not package_json_path.exists():
        raise RuntimeError(f"package.json not found: {package_json_path}")

    data = json.loads(package_json_path.read_text())
    data["packageManager"] = f"bun@{version}"
    package_json_path.write_text(json.dumps(data, indent="\t", ensure_ascii=False) + "\n")


def update_toolchain_yaml(toolchain_path: Path, version: str) -> None:
    toolchain_path.parent.mkdir(parents=True, exist_ok=True)

    if not toolchain_path.exists() or not toolchain_path.read_text().strip():
        toolchain_path.write_text(f"{MOON_SCHEMA_LINE}\n\nbun:\n  version: '{version}'\n")
        return

    text = toolchain_path.read_text()
    bun_block_pattern = re.compile(r"(?ms)^bun:\n((?:^[ \t].*(?:\n|$))*)")
    bun_block_match = bun_block_pattern.search(text)

    if bun_block_match:
        body = bun_block_match.group(1)

        if re.search(r"(?m)^[ \t]+version:\s*.+$", body):
            body = re.sub(
                r"(?m)^([ \t]+version:\s*).+$",
                rf"\1'{version}'",
                body,
                count=1,
            )
        else:
            indent_match = re.search(r"(?m)^([ \t]+)\S", body)
            indent = indent_match.group(1) if indent_match else "  "
            body = f"{indent}version: '{version}'\n{body}"

        updated = text[: bun_block_match.start()] + "bun:\n" + body + text[bun_block_match.end() :]
        toolchain_path.write_text(updated)
        return

    if not text.endswith("\n"):
        text += "\n"
    if not text.endswith("\n\n"):
        text += "\n"

    text += f"bun:\n  version: '{version}'\n"
    toolchain_path.write_text(text)


def sync_repo_with_version(repo_root: Path, version: str) -> Path:
    package_json_path = repo_root / "package.json"
    toolchain_path = resolve_toolchain_path(repo_root)

    print(f"Updating {package_json_path}...")
    update_package_json(package_json_path, version)

    print(f"Updating {toolchain_path}...")
    update_toolchain_yaml(toolchain_path, version)

    return toolchain_path


def clear_bun_artifacts(root: Path) -> tuple[int, int]:
    removed_dirs = 0
    removed_files = 0

    for current_root, dirnames, filenames in os.walk(root, topdown=True):
        current_path = Path(current_root)

        for dirname in list(dirnames):
            if dirname not in CLEAN_DIR_NAMES:
                continue

            target = current_path / dirname
            print(f"Removing directory: {target}")
            shutil.rmtree(target)
            dirnames.remove(dirname)
            removed_dirs += 1

        for filename in filenames:
            if filename not in CLEAN_FILE_NAMES:
                continue

            target = current_path / filename
            print(f"Removing file: {target}")
            target.unlink()
            removed_files += 1

    return removed_dirs, removed_files


def cmd_clear(_: argparse.Namespace) -> int:
    root = Path.cwd().resolve()
    print(f"Cleaning Bun artifacts under {root}...")
    removed_dirs, removed_files = clear_bun_artifacts(root)
    print("")
    print("Done.")
    print(f"- directories removed: {removed_dirs}")
    print(f"- files removed: {removed_files}")
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    repo_root = detect_repo_root(args.repo)
    print(f"Repository root: {repo_root}")

    if args.sync_only:
        print("Mode: sync-only")
        print("Reading the currently pinned global Bun version...")
        resolved_version = read_pinned_global_bun_version()
    else:
        version_spec = args.version or "latest"
        print("Mode: update + sync")
        print(f"Requested Bun spec: {version_spec}")
        print("Updating and pinning global Bun with proto...")
        install_and_pin_global_bun(version_spec)
        resolved_version = read_pinned_global_bun_version()

    print(f"Resolved Bun version: {resolved_version}")
    toolchain_path = sync_repo_with_version(repo_root, resolved_version)

    print("")
    print("Done.")
    print(f"- ~/.proto/.prototools bun = {resolved_version}")
    print(f"- package.json packageManager = bun@{resolved_version}")
    print(f"- {toolchain_path.relative_to(repo_root)} bun.version = {resolved_version}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Unified Bun helper for cleanup and version sync workflows."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    clear_parser = subparsers.add_parser(
        "clear",
        help="Remove node_modules, dist, .cache, and bun lock files under the current tree.",
    )
    clear_parser.set_defaults(handler=cmd_clear)

    update_parser = subparsers.add_parser(
        "update",
        help="Update global proto Bun and sync repo-local packageManager and Moon toolchain settings.",
    )
    update_parser.add_argument(
        "version",
        nargs="?",
        help=(
            'Bun version or proto spec to install before syncing. Examples: "latest", "1.3.11". '
            'Defaults to "latest" unless --sync-only is used.'
        ),
    )
    update_parser.add_argument(
        "--repo",
        help="Repository root to update. Defaults to the current git root, or the current directory if not in git.",
    )
    update_parser.add_argument(
        "--sync-only",
        action="store_true",
        help="Skip proto install/pin and only sync local files from the current global Bun pin in ~/.proto/.prototools.",
    )
    update_parser.set_defaults(handler=cmd_update)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "update" and args.sync_only and args.version is not None:
        parser.error("--sync-only cannot be combined with a version argument")

    try:
        return args.handler(args)
    except (
        json.JSONDecodeError,
        OSError,
        PermissionError,
        RuntimeError,
        subprocess.CalledProcessError,
        FileNotFoundError,
        ValueError,
    ) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
