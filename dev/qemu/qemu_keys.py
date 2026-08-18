#!/usr/bin/env python3
"""Send QEMU monitor keystrokes into a dockur/windows guest.

Lessons from the first windows-02 setup:
- The guest layout is Korean. QEMU `\\` becomes `#`.
- Prefer `/` in Windows paths. Do not type `\\`.
- `podman exec -i <ctr> nc -q1 -w2 127.0.0.1 7100` is the monitor path.
- Keep a hold time. Bursting keys too fast drops characters.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import require

SHIFT = {
    "!": "1",
    "@": "2",
    "#": "3",
    "$": "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "asterisk",
    "(": "9",
    ")": "0",
    "_": "minus",
    "+": "equal",
    "{": "bracket_left",
    "}": "bracket_right",
    "|": "backslash",
    ":": "semicolon",
    '"': "apostrophe",
    "<": "comma",
    ">": "dot",
    "?": "slash",
    "~": "grave_accent",
}

PLAIN = {
    " ": "spc",
    "-": "minus",
    "=": "equal",
    "[": "bracket_left",
    "]": "bracket_right",
    ";": "semicolon",
    "'": "apostrophe",
    ",": "comma",
    ".": "dot",
    "/": "slash",
    "`": "grave_accent",
    "\n": "ret",
    "\t": "tab",
}


def encode_char(ch: str) -> str:
    if ch in {"\\", "₩"}:
        raise ValueError(
            "Korean guest layout maps QEMU backslash to '#'. Use '/' in Windows paths."
        )
    if ch in PLAIN:
        return PLAIN[ch]
    if ch in SHIFT:
        return f"shift-{SHIFT[ch]}"
    if ch.islower() or ch.isdigit():
        return ch
    if ch.isupper():
        return f"shift-{ch.lower()}"
    raise ValueError(f"unsupported char {ch!r}")


def encode_text(text: str) -> list[str]:
    return [encode_char(ch) for ch in text]


def send_monitor(container: str, sequences: list[str], hold_ms: int) -> None:
    payload = "".join(f"sendkey {seq} {hold_ms}\n" for seq in sequences)
    subprocess.run(
        ["podman", "exec", "-i", container, "nc", "-q1", "-w2", "127.0.0.1", "7100"],
        input=payload,
        text=True,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(max(0.03, hold_ms / 1000) * max(1, len(sequences)) * 0.15)


def win_path(path: str) -> str:
    return path.replace("\\", "/")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance", help="01, 02, windows-02, or windows@02")
    parser.add_argument(
        "mode",
        choices=("winr", "type", "keys", "enter", "esc", "alt-y", "run"),
    )
    parser.add_argument("text", nargs="?")
    parser.add_argument("--hold-ms", type=int, default=40)
    args = parser.parse_args()
    rec = require(args.instance)
    container = rec["container"]

    if args.mode == "winr":
        send_monitor(container, ["meta_l-r"], 90)
        time.sleep(0.5)
    elif args.mode == "enter":
        send_monitor(container, ["ret"], 70)
    elif args.mode == "esc":
        send_monitor(container, ["esc"], 70)
    elif args.mode == "alt-y":
        send_monitor(container, ["alt-y"], 90)
    elif args.mode == "keys":
        if not args.text:
            raise SystemExit("keys mode needs a QEMU key sequence")
        send_monitor(container, [args.text], args.hold_ms)
    elif args.mode == "type":
        if args.text is None:
            raise SystemExit("type mode needs text")
        send_monitor(container, encode_text(args.text), args.hold_ms)
    elif args.mode == "run":
        if not args.text:
            raise SystemExit("run mode needs a Windows path or command")
        send_monitor(container, ["meta_l-r"], 90)
        time.sleep(0.6)
        send_monitor(container, encode_text(win_path(args.text)), args.hold_ms)
        time.sleep(0.2)
        send_monitor(container, ["ret"], 70)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
