#!/usr/bin/env python3
from pathlib import Path

import host_ssh


def test_upsert_host_block(tmp_path: Path, monkeypatch) -> None:
    cfg = tmp_path / "config"
    cfg.write_text("Host other\n    HostName example\n")
    monkeypatch.setattr(host_ssh, "SSH_CONFIG", cfg)
    monkeypatch.setattr(host_ssh, "SSH_DIR", tmp_path)
    host_ssh.upsert_host_block("windows-03", "2224")
    host_ssh.upsert_host_block("windows-03", "2225")
    text = cfg.read_text()
    assert text.count("Host windows-03") == 1
    assert "Port 2225" in text
    assert "HostName 127.0.0.1" in text
    assert "Host other" in text


if __name__ == "__main__":
    tmp = Path("/tmp/windows-qemu-host-ssh-test")
    tmp.mkdir(exist_ok=True)
    cfg = tmp / "config"
    cfg.write_text("Host other\n    HostName example\n")
    host_ssh.SSH_CONFIG = cfg
    host_ssh.SSH_DIR = tmp
    host_ssh.upsert_host_block("windows-03", "2224")
    host_ssh.upsert_host_block("windows-03", "2225")
    text = cfg.read_text()
    assert text.count("Host windows-03") == 1
    assert "Port 2225" in text
    print("ok")
