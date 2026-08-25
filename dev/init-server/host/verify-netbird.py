#!/usr/bin/env python3
"""Verify NetBird HTTPS, gRPC, STUN, and loopback backend binds."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

HOST_DIR = Path(__file__).resolve().parent
REMOTE = r"""
set -Eeuo pipefail
systemctl is-active --quiet caddy netbird-podman nftables
podman ps --format '{{.Names}}' | while IFS= read -r name; do printf '%s\n' "$name"; done
printf '%s\n' PORTS
ss -lnt | while IFS= read -r line; do
    case "$line" in
        *':8080 '*|*':8081 '*) printf '%s\n' "$line" ;;
    esac
done
"""


def load_ssh_control():
    path = HOST_DIR / "ssh-control.py"
    spec = importlib.util.spec_from_file_location("ssh_control", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pass_(message: str) -> None:
    print(f"PASS {message}")


def fail_(message: str, failed: list[int]) -> None:
    print(f"FAIL {message}", file=sys.stderr)
    failed.append(1)


def curl_json(url: str) -> dict:
    request = Request(url, method="GET")
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())


def curl_code(url: str, *, insecure: bool = False) -> str:
    argv = ["curl", "--silent", "--output", "/dev/null", "--write-out", "%{http_code}"]
    if insecure:
        argv.append("--insecure")
    else:
        argv.append("--fail")
    argv.append(url)
    result = subprocess.run(argv, text=True, capture_output=True)
    return (result.stdout or "").strip()


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"Usage: {argv[0]} SSH_TARGET DOMAIN", file=sys.stderr)
        return 2
    target, domain = argv[1], argv[2]
    options = load_ssh_control().control_options()
    failed: list[int] = []

    oidc_url = f"https://{domain}/oauth2/.well-known/openid-configuration"
    try:
        data = curl_json(oidc_url)
        if data.get("issuer") == f"https://{domain}/oauth2":
            pass_("OIDC discovery and issuer")
        else:
            fail_("OIDC discovery and issuer", failed)
    except (URLError, json.JSONDecodeError, TimeoutError, OSError):
        fail_("OIDC discovery and issuer", failed)

    setup_code = subprocess.run(
        [
            "curl",
            "--silent",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}",
            f"https://{domain}/setup",
        ],
        text=True,
        capture_output=True,
    ).stdout.strip()
    if setup_code == "200":
        pass_("Dashboard setup route")
    else:
        overlay = subprocess.run(
            [
                "ssh",
                *options,
                "-o",
                "BatchMode=yes",
                target,
                "ip -4 -o addr show wt0 | awk '{print $4}' | cut -d/ -f1",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        overlay_ip = overlay.stdout.strip()
        overlay_code = ""
        if overlay_ip.startswith("100."):
            overlay_code = curl_code(f"https://{overlay_ip}/setup", insecure=True)
        if setup_code == "404" and overlay_code == "200":
            pass_("Dashboard setup route (overlay)")
        else:
            fail_("Dashboard setup route", failed)

    headers = subprocess.run(
        [
            "curl",
            "--silent",
            "--show-error",
            "--http2",
            "--dump-header",
            "-",
            "--output",
            "/dev/null",
            "--request",
            "POST",
            "--header",
            "Content-Type: application/grpc",
            f"https://{domain}/management.ManagementService/GetServerKey",
        ],
        text=True,
        capture_output=True,
    )
    blob = (headers.stdout or "") + (headers.stderr or "")
    if "content-type: application/grpc" in blob.lower():
        pass_("gRPC routed through Caddy with h2c backend")
    else:
        fail_("gRPC routing", failed)

    stun = subprocess.run(
        [
            "bash",
            "-c",
            "printf '000100002112a4420102030405060708090a0b0c' | xxd -r -p | "
            f"nc -u -w 3 {domain} 3478 | wc -c",
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    try:
        stun_bytes = int((stun.stdout or "0").strip() or "0")
    except ValueError:
        stun_bytes = 0
    if stun_bytes >= 20:
        pass_(f"STUN response ({stun_bytes} bytes)")
    else:
        fail_("STUN response", failed)

    remote = subprocess.run(
        ["ssh", *options, "-o", "BatchMode=yes", target, "sudo bash -s"],
        input=REMOTE.lstrip("\n"),
        text=True,
        capture_output=True,
        check=False,
    )
    remote_text = remote.stdout or ""
    if "netbird-dashboard" in remote_text and "netbird-server" in remote_text:
        pass_("NetBird containers running")
    else:
        fail_("NetBird containers running", failed)
    if (
        "127.0.0.1:8080" in remote_text
        and "127.0.0.1:8081" in remote_text
        and "0.0.0.0:8080" not in remote_text
        and "0.0.0.0:8081" not in remote_text
    ):
        pass_("Backends restricted to loopback")
    else:
        fail_("Backend bind addresses", failed)

    subprocess.run([str(HOST_DIR / "sync-log.py"), target], check=False)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
