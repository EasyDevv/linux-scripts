#!/usr/bin/env python3
from qemu_keys import encode_text, win_path


def test_forward_slash_path() -> None:
    keys = encode_text("C:/Users/Docker/Desktop/Shared/setup-ssh.bat")
    assert "backslash" not in keys
    assert keys[:2] == ["shift-c", "shift-semicolon"]
    assert "slash" in keys


def test_rejects_backslash() -> None:
    try:
        encode_text(r"C:\Users")
    except ValueError as exc:
        assert "backslash" in str(exc).lower() or "Korean" in str(exc)
    else:
        raise AssertionError("backslash should be rejected")


def test_win_path_normalizes() -> None:
    assert win_path(r"C:\Users\Docker\Desktop\Shared\setup-ssh.bat") == (
        "C:/Users/Docker/Desktop/Shared/setup-ssh.bat"
    )


if __name__ == "__main__":
    test_forward_slash_path()
    test_rejects_backslash()
    test_win_path_normalizes()
    print("ok")
