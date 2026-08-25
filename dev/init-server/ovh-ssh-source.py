#!/usr/bin/env python3
"""Manage the single OVH Edge Firewall /32 allowed to reach public SSH."""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import socket
import subprocess
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
DEFAULT_SPEC = HERE / "profiles" / "ovh-vps.security.json"
CURRENT_IP_URL = "https://ifconfig.me/ip"


class AppError(RuntimeError):
    pass


@dataclass(frozen=True)
class Rule:
    sequence: int
    action: str
    protocol: str
    source: str | None = None
    destination_port: int | None = None
    tcp_option: str | None = None

    @classmethod
    def from_spec(cls, value: dict[str, Any]) -> "Rule":
        return cls(
            sequence=int(value["sequence"]),
            action=str(value["action"]),
            protocol=str(value["protocol"]),
            source=value.get("source"),
            destination_port=(
                int(value["destination_port"])
                if value.get("destination_port") is not None
                else None
            ),
            tcp_option=value.get("tcp_option"),
        )

    def create_args(self) -> list[str]:
        args = [
            "--sequence",
            str(self.sequence),
            "--action",
            self.action,
            "--protocol",
            self.protocol,
        ]
        if self.source:
            args.extend(["--source", self.source])
        if self.destination_port is not None:
            args.extend(["--destination-port", str(self.destination_port)])
        if self.tcp_option:
            args.extend(["--tcp-option", self.tcp_option])
        return args

    def matches(self, actual: dict[str, Any]) -> bool:
        expected = {
            "sequence": self.sequence,
            "action": self.action,
            "protocol": self.protocol,
            "source": self.source,
            "destinationPort": self.destination_port,
            "tcpOption": self.tcp_option,
        }
        for key, wanted in expected.items():
            if wanted is None:
                continue
            got = actual.get(key)
            if key in {"sequence", "destinationPort"}:
                if got is None:
                    return False
                if key == "destinationPort" and isinstance(got, str):
                    got = got.removeprefix("eq ")
                try:
                    got = int(got)
                except (TypeError, ValueError):
                    return False
            if got != wanted:
                return False
        return True


@dataclass(frozen=True)
class Settings:
    ip_block: str
    public_ipv4: str
    home_ipv4: str
    ssh_sequence: int
    credential_env: Path
    rules: tuple[Rule, ...]

    @classmethod
    def load(cls, path: Path) -> "Settings":
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise AppError(f"cannot read spec {path}: {error}") from error
        home = normalize_ipv4(value["home_ipv4"])
        rules = tuple(Rule.from_spec(item) for item in value["rules"])
        sequences = [rule.sequence for rule in rules]
        if len(sequences) != len(set(sequences)):
            raise AppError("duplicate rule sequence in spec")
        ssh_sequence = int(value["ssh_sequence"])
        ssh_rules = [rule for rule in rules if rule.sequence == ssh_sequence]
        if len(ssh_rules) != 1 or ssh_rules[0].destination_port != 22:
            raise AppError("ssh_sequence must identify one TCP/22 rule")
        return cls(
            ip_block=str(value["ip_block"]),
            public_ipv4=normalize_ipv4(value["public_ipv4"]),
            home_ipv4=home,
            ssh_sequence=ssh_sequence,
            credential_env=Path(value["credential_env"]).expanduser(),
            rules=rules,
        )

    def desired_rules(self, ssh_source: str | None = None) -> tuple[Rule, ...]:
        result: list[Rule] = []
        for rule in self.rules:
            if rule.sequence == self.ssh_sequence and ssh_source is not None:
                result.append(
                    Rule(
                        sequence=rule.sequence,
                        action=rule.action,
                        protocol=rule.protocol,
                        source=normalize_cidr(ssh_source),
                        destination_port=rule.destination_port,
                        tcp_option=rule.tcp_option,
                    )
                )
            else:
                result.append(rule)
        return tuple(result)


def normalize_ipv4(value: str) -> str:
    try:
        return str(ipaddress.IPv4Address(str(value).strip()))
    except ipaddress.AddressValueError as error:
        raise AppError(f"not an IPv4 address: {value}") from error


def normalize_cidr(value: str) -> str:
    text = str(value).strip()
    if "/" not in text:
        text += "/32"
    try:
        network = ipaddress.IPv4Network(text, strict=True)
    except (ipaddress.AddressValueError, ValueError) as error:
        raise AppError(f"source must be one IPv4 /32: {value}") from error
    if network.prefixlen != 32:
        raise AppError(f"source must be one IPv4 /32: {value}")
    return str(network)


def load_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise AppError(f"missing restricted OVH credential file: {path}")
    if path.stat().st_mode & 0o077:
        raise AppError(f"credential file must be mode 0600: {path}")
    result = os.environ.copy()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise AppError(f"invalid credential line in {path}")
        key, value = line.split("=", 1)
        if key not in {"OVH_ENDPOINT", "OVH_CLIENT_ID", "OVH_CLIENT_SECRET"}:
            raise AppError(f"unsupported credential key in {path}: {key}")
        result[key] = value
    required = {"OVH_ENDPOINT", "OVH_CLIENT_ID", "OVH_CLIENT_SECRET"}
    missing = sorted(key for key in required if not result.get(key))
    if missing:
        raise AppError(f"credential file is missing: {', '.join(missing)}")
    for key in ("OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET", "OVH_CONSUMER_KEY"):
        result.pop(key, None)
    return result


class Ovh:
    def __init__(
        self,
        settings: Settings,
        *,
        apply: bool,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ) -> None:
        self.settings = settings
        self.apply = apply
        self.runner = runner
        self.env = load_env(settings.credential_env)

    def command(self, args: list[str], *, check: bool = True) -> Any:
        cmd = ["ovhcloud", *args, "-o", "json"]
        if not self.apply and any(word in args for word in ("add", "create", "delete", "enable", "disable")):
            print("PLAN", " ".join(args))
            return None
        result = self.runner(cmd, text=True, capture_output=True, env=self.env)
        if check and result.returncode != 0:
            message = (result.stderr or result.stdout or "OVHcloud command failed").strip()
            raise AppError(message)
        if result.returncode != 0:
            return None
        text = result.stdout.strip()
        if not text or text == "null":
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            raise AppError(f"invalid JSON from ovhcloud: {text[:200]}") from error

    def firewall(self) -> dict[str, Any] | None:
        value = self.command(
            ["ip", "firewall", "get", self.settings.ip_block, self.settings.public_ipv4],
            check=False,
        )
        return value if isinstance(value, dict) and not value.get("error") else None

    def list_rules(self) -> dict[int, dict[str, Any]]:
        value = self.command(
            ["ip", "firewall", "rule", "list", self.settings.ip_block, self.settings.public_ipv4]
        )
        if value is None:
            return {}
        if not isinstance(value, list):
            raise AppError("unexpected firewall rule list response")
        return {int(item["sequence"]): item for item in value}

    def delete_rule(self, sequence: int) -> None:
        self.command(
            [
                "ip",
                "firewall",
                "rule",
                "delete",
                self.settings.ip_block,
                self.settings.public_ipv4,
                str(sequence),
            ]
        )

    def create_rule(self, rule: Rule) -> None:
        self.command(
            [
                "ip",
                "firewall",
                "rule",
                "create",
                self.settings.ip_block,
                self.settings.public_ipv4,
                *rule.create_args(),
            ]
        )

    def reconcile(self) -> None:
        if self.firewall() is None:
            self.command(
                ["ip", "firewall", "add", self.settings.ip_block, self.settings.public_ipv4]
            )
        actual = self.list_rules() if self.apply or self.firewall() is not None else {}
        for desired in self.settings.rules:
            current = actual.get(desired.sequence)
            if current is not None and desired.matches(current):
                print(f"PASS rule {desired.sequence}")
                continue
            if current is not None:
                self.delete_rule(desired.sequence)
            self.create_rule(desired)
        self.command(
            ["ip", "firewall", "enable", self.settings.ip_block, self.settings.public_ipv4]
        )
        if self.apply:
            self.verify(self.settings.rules)

    def replace_ssh_source(self, source: str | None) -> None:
        actual = self.list_rules()
        current = actual.get(self.settings.ssh_sequence)
        if current is not None:
            self.delete_rule(self.settings.ssh_sequence)
        if source is None:
            print("PASS public SSH closed at OVH edge" if self.apply else "PLAN close public SSH")
            return
        desired = next(
            rule
            for rule in self.settings.desired_rules(source)
            if rule.sequence == self.settings.ssh_sequence
        )
        try:
            self.create_rule(desired)
            if self.apply:
                created = self.list_rules().get(self.settings.ssh_sequence)
                if created is None or not desired.matches(created):
                    raise AppError("replacement SSH rule did not verify")
        except Exception:
            if self.apply and current is not None:
                print("ROLLBACK restoring previous SSH source", file=sys.stderr)
                self.create_rule(Rule.from_spec(rule_to_spec(current)))
            raise
        print(f"PASS SSH source {desired.source}" if self.apply else f"PLAN SSH source {desired.source}")

    def verify(self, expected: tuple[Rule, ...]) -> None:
        firewall = self.firewall()
        if firewall is None:
            raise AppError("OVH Edge Firewall is missing")
        if firewall.get("enabled") is not True:
            raise AppError("OVH Edge Firewall is not enabled")
        actual = self.list_rules()
        failures = [rule.sequence for rule in expected if not rule.matches(actual.get(rule.sequence, {}))]
        if failures:
            raise AppError(f"firewall rules do not match: {failures}")
        ssh = actual.get(self.settings.ssh_sequence)
        if ssh and ssh.get("source") in {None, "0.0.0.0/0"}:
            raise AppError("unsafe public SSH source")
        print("PASS OVH Edge Firewall desired state")


def rule_to_spec(rule: dict[str, Any]) -> dict[str, Any]:
    return {
        "sequence": rule["sequence"],
        "action": rule["action"],
        "protocol": rule["protocol"],
        "source": rule.get("source"),
        "destination_port": rule.get("destinationPort"),
        "tcp_option": rule.get("tcpOption"),
    }


def current_ipv4() -> str:
    try:
        with urllib.request.urlopen(CURRENT_IP_URL, timeout=5) as response:
            return normalize_ipv4(response.read().decode().strip())
    except Exception as error:
        raise AppError(f"cannot determine current public IPv4: {error}") from error


def tcp_probe(ip: str, port: int = 22) -> None:
    try:
        with socket.create_connection((ip, port), timeout=5):
            pass
    except OSError as error:
        raise AppError(f"TCP probe failed for {ip}:{port}: {error}") from error
    print(f"PASS TCP {ip}:{port} reachable")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Manage the one OVH Edge Firewall /32 allowed to reach public SSH."
    )
    result.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    result.add_argument("--apply", action="store_true", help="perform mutations; otherwise print a plan")
    sub = result.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("reconcile")
    sub.add_parser("current")
    sub.add_parser("home")
    set_parser = sub.add_parser("set")
    set_parser.add_argument("source")
    sub.add_parser("close")
    sub.add_parser("test")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        settings = Settings.load(args.spec)
        ovh = Ovh(settings, apply=args.apply)
        if args.command == "status":
            firewall = ovh.firewall()
            print(json.dumps({"firewall": firewall, "rules": list(ovh.list_rules().values()) if firewall else []}, indent=2))
        elif args.command == "reconcile":
            ovh.reconcile()
        elif args.command == "current":
            ovh.replace_ssh_source(current_ipv4())
        elif args.command == "home":
            ovh.replace_ssh_source(settings.home_ipv4)
        elif args.command == "set":
            ovh.replace_ssh_source(args.source)
        elif args.command == "close":
            ovh.replace_ssh_source(None)
        elif args.command == "test":
            ovh.verify(settings.rules)
            source = normalize_cidr(current_ipv4())
            ssh_rule = ovh.list_rules().get(settings.ssh_sequence, {})
            if ssh_rule.get("source") != source:
                raise AppError(f"current source {source} is not the SSH allow rule")
            tcp_probe(settings.public_ipv4)
        return 0
    except AppError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
