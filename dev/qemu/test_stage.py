#!/usr/bin/env python3
from __future__ import annotations

import tempfile
from pathlib import Path

import stage


def test_copy_if_missing(tmp_path: Path) -> None:
    src = tmp_path / "src.txt"
    dest = tmp_path / "dest.txt"
    src.write_text("skill\n", encoding="utf-8")
    assert stage.copy_if_missing(src, dest) is True
    dest.write_text("shared\n", encoding="utf-8")
    assert stage.copy_if_missing(src, dest) is False
    assert dest.read_text(encoding="utf-8") == "shared\n"
    assert stage.copy_if_missing(src, dest, force=True) is True
    assert dest.read_text(encoding="utf-8") == "skill\n"


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="wq-stage-") as tmp:
        test_copy_if_missing(Path(tmp))
    print("ok")
