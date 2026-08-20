#!/usr/bin/env python3
"""Idempotently join and harden one NetBird host without exposing setup keys."""
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from netbird_setup import AppError, Config, api_request, load_config  # noqa: E402

Json = dict[str, Any]
ApiCall = Callable[[str, str, str, str, Json | None], Any]


@dataclass(frozen=True)
class Settings:
    target: str
    host_selector: str
    host_group: str
    admin_group: str
    admin_peer: str | None
    ssh_user: str
    key_name: str
    apply: bool
    enable_ssh: bool
    disable_default: bool
    spec: Path | None = None


class Remote:
    def __init__(self, target: str) -> None:
        self.target = target

    def run(
        self,
        command: str,
        *,
        input_text: str | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [
                "ssh",
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "RequestTTY=no",
                self.target,
                "bash -c " + shlex.quote(command),
            ],
            text=True,
            input=input_text,
            capture_output=True,
        )
        if check and result.returncode != 0:
            blob = (result.stderr or result.stdout or "").strip()
            line = blob.splitlines()[-1] if blob.splitlines() else "remote command failed"
            if "setup-key" in line.lower() or "setup_key" in line.lower():
                line = "remote command failed"
            raise AppError(line)
        return result

    def connected(self, management_url: str) -> bool:
        result = self.run(
            "command -v netbird >/dev/null && "
            "netbird status 2>/dev/null | grep -q 'Management: Connected'",
            check=False,
        )
        if result.returncode != 0:
            return False
        detailed = self.run("netbird status -d 2>/dev/null", check=False)
        return management_url.rstrip("/") in detailed.stdout

    def install_client(self) -> None:
        self.run(
            "if ! command -v netbird >/dev/null; then "
            "curl -fsSL https://pkgs.netbird.io/install.sh | sudo sh; fi"
        )

    def join(self, management_url: str, setup_key: str, hostname: str) -> None:
        command = (
            "sudo netbird down >/dev/null 2>&1 || true; "
            "IFS= read -r NETBIRD_SETUP_KEY; "
            "sudo netbird up "
            f"--management-url {shlex.quote(management_url)} "
            ' --setup-key "$NETBIRD_SETUP_KEY" '
            f"--hostname {shlex.quote(hostname)}"
        )
        result = self.run(command, input_text=setup_key + "\n", check=False)
        if result.returncode != 0:
            blob = (result.stderr or result.stdout or "").strip()
            line = next(
                (
                    item
                    for item in reversed(blob.splitlines())
                    if item
                    and "setup-key" not in item.lower()
                    and "setup_key" not in item.lower()
                ),
                "host join failed",
            )
            raise AppError(f"host join failed: {line}")

    def ssh_server_enabled(self) -> bool:
        result = self.run(
            "netbird status 2>/dev/null | grep -q 'SSH Server: Enabled'",
            check=False,
        )
        return result.returncode == 0

    def enable_ssh_server(self) -> None:
        command = (
            "set -e; sudo netbird down; "
            "sudo netbird up --allow-server-ssh --disable-ssh-auth; "
            "netbird status | grep -q 'SSH Server: Enabled'"
        )
        self.run(command)

    def overlay_ip(self) -> str:
        result = self.run(
            "ip -4 -o addr show wt0 | awk '{split($4,a,\"/\"); print a[1]; exit}'"
        )
        ip = result.stdout.strip()
        if not ip.startswith("100."):
            raise AppError("joined host has no wt0 IPv4")
        return ip


class Reconciler:
    def __init__(
        self,
        config: Config,
        settings: Settings,
        *,
        api: ApiCall = api_request,
        remote: Remote | None = None,
    ) -> None:
        self.config = config
        self.settings = settings
        self.api = api
        self.remote = remote or Remote(settings.target)
        self.changed: list[str] = []

    def request(self, method: str, path: str, body: Json | None = None) -> Any:
        return self.api(
            self.config.management_url,
            self.config.api_key,
            method,
            path,
            body,
        )

    def list_items(self, path: str) -> list[Json]:
        data = self.request("GET", path)
        if not isinstance(data, list):
            raise AppError(f"NetBird {path} did not return a list")
        return data

    def exact(self, items: list[Json], field: str, value: str) -> Json | None:
        found = [item for item in items if item.get(field) == value]
        if len(found) > 1:
            raise AppError(f"duplicate {field}={value}")
        return found[0] if found else None

    def ensure_group(self, name: str) -> Json:
        group = self.exact(self.list_items("/api/groups"), "name", name)
        if group:
            print(f"PASS group {name}")
            return group
        print(f"PLAN create group {name}")
        if not self.settings.apply:
            return {"id": f"plan:{name}", "name": name, "peers": []}
        created = self.request("POST", "/api/groups", {"name": name, "peers": []})
        if not isinstance(created, dict) or not created.get("id"):
            raise AppError(f"failed to create group {name}")
        self.changed.append(f"group:{name}")
        return created

    @staticmethod
    def peer_ids(group: Json) -> list[str]:
        ids: list[str] = []
        for peer in group.get("peers") or []:
            if isinstance(peer, str):
                ids.append(peer)
            elif isinstance(peer, dict) and isinstance(peer.get("id"), str):
                ids.append(peer["id"])
        return ids

    def ensure_group_peer(self, group: Json, peer_id: str) -> Json:
        peers = self.peer_ids(group)
        if peer_id in peers:
            print(f"PASS group member {group['name']}")
            return group
        print(f"PLAN add peer to {group['name']}")
        if not self.settings.apply:
            group = dict(group)
            group["peers"] = [*peers, peer_id]
            return group
        body: Json = {"name": group["name"], "peers": [*peers, peer_id]}
        if "resources" in group:
            body["resources"] = group["resources"]
        updated = self.request("PUT", f"/api/groups/{group['id']}", body)
        self.changed.append(f"membership:{group['name']}")
        return updated if isinstance(updated, dict) else body

    @staticmethod
    def selector_values(peer: Json) -> set[str]:
        return {
            value
            for value in (
                peer.get("id"),
                peer.get("name"),
                peer.get("hostname"),
                peer.get("dns_label"),
                peer.get("ip"),
            )
            if isinstance(value, str)
        }

    def resolve_peer(self, selector: str) -> Json | None:
        matches = [
            peer
            for peer in self.list_items("/api/peers")
            if selector in self.selector_values(peer)
        ]
        if len(matches) > 1:
            raise AppError(f"ambiguous peer selector {selector}")
        return matches[0] if matches else None

    def revoke_unused_keys(self, name: str) -> None:
        for key in self.list_items("/api/setup-keys"):
            if key.get("name") != name or key.get("revoked"):
                continue
            if int(key.get("used_times") or 0) > 0 or key.get("state") == "overused":
                continue
            print(f"PLAN revoke stale setup key {name}")
            if not self.settings.apply:
                continue
            self.request(
                "PUT",
                f"/api/setup-keys/{key['id']}",
                {
                    "revoked": True,
                    "auto_groups": key.get("auto_groups") or [],
                },
            )
            self.changed.append(f"revoke-key:{name}")

    def mint_key(self, group_id: str) -> tuple[str, Json]:
        self.revoke_unused_keys(self.settings.key_name)
        if not self.settings.apply:
            print(f"PLAN mint one-off setup key {self.settings.key_name}")
            return "", {}
        created = self.request(
            "POST",
            "/api/setup-keys",
            {
                "name": self.settings.key_name,
                "type": "one-off",
                "expires_in": 86400,
                "auto_groups": [group_id],
                "usage_limit": 1,
                "ephemeral": False,
                "allow_extra_dns_labels": False,
            },
        )
        key = created.get("key") if isinstance(created, dict) else None
        if not isinstance(key, str) or not key:
            raise AppError("setup key create returned no plaintext key")
        self.changed.append(f"setup-key:{self.settings.key_name}")
        print(f"CHANGE minted one-off setup key {self.settings.key_name}")
        return key, created

    def revoke_key(self, created: Json) -> None:
        key_id = created.get("id")
        if not isinstance(key_id, str):
            return
        try:
            self.request(
                "PUT",
                f"/api/setup-keys/{key_id}",
                {
                    "revoked": True,
                    "auto_groups": created.get("auto_groups") or [],
                },
            )
            print(f"CHANGE revoked setup key {created.get('name') or key_id[:8]}")
        except AppError:
            print("WARN could not revoke setup key", file=sys.stderr)

    def revoke_named_keys(self, name: str) -> None:
        for key in self.list_items("/api/setup-keys"):
            if key.get("name") != name or key.get("revoked"):
                continue
            if not self.settings.apply:
                print(f"PLAN revoke setup key {name}")
                continue
            self.revoke_key(key)
            self.changed.append(f"revoke-key:{name}")

    def ensure_joined(self, host_group: Json) -> Json | None:
        peer = self.resolve_peer(self.settings.host_selector)
        if peer and self.remote.connected(self.config.management_url):
            print("PASS host client connected to expected management URL")
            self.revoke_named_keys(self.settings.key_name)
            return peer
        print("PLAN install and join host client")
        if not self.settings.apply:
            return peer
        key, created = self.mint_key(str(host_group["id"]))
        try:
            self.remote.install_client()
            self.remote.join(
                self.config.management_url,
                key,
                self.settings.host_selector,
            )
        except Exception:
            self.revoke_key(created)
            raise
        peer = self.resolve_peer(self.settings.host_selector)
        if not peer or not self.remote.connected(self.config.management_url):
            self.revoke_key(created)
            raise AppError("host did not appear connected after join")
        self.changed.append("host-join")
        print("CHANGE host joined")
        self.revoke_named_keys(self.settings.key_name)
        return peer

    def ensure_peer_ssh(self, peer: Json) -> Json:
        if peer.get("ssh_enabled") is True:
            print("PASS peer ssh_enabled")
            return peer
        print("PLAN enable peer ssh in management")
        if not self.settings.apply:
            return {**peer, "ssh_enabled": True}
        body = {
            "name": peer.get("name") or self.settings.host_selector,
            "ssh_enabled": True,
            "login_expiration_enabled": bool(peer.get("login_expiration_enabled")),
            "inactivity_expiration_enabled": bool(
                peer.get("inactivity_expiration_enabled")
            ),
        }
        updated = self.request("PUT", f"/api/peers/{peer['id']}", body)
        self.changed.append("peer-ssh")
        return updated if isinstance(updated, dict) else {**peer, **body}

    @staticmethod
    def request_rule(rule: Json) -> Json:
        def ids(values: Any) -> list[str]:
            result: list[str] = []
            for value in values or []:
                if isinstance(value, str):
                    result.append(value)
                elif isinstance(value, dict) and isinstance(value.get("id"), str):
                    result.append(value["id"])
            return result

        body: Json = {
            "name": rule.get("name") or "rule",
            "description": rule.get("description") or "",
            "enabled": bool(rule.get("enabled", True)),
            "action": rule.get("action") or "accept",
            "bidirectional": bool(rule.get("bidirectional", False)),
            "protocol": rule.get("protocol") or "all",
            "sources": ids(rule.get("sources")),
            "destinations": ids(rule.get("destinations")),
        }
        for optional in ("ports", "port_ranges", "authorized_groups"):
            if optional in rule and rule[optional] is not None:
                body[optional] = rule[optional]
        return body

    def ensure_policy(self, desired: Json) -> None:
        policies = self.list_items("/api/policies")
        current = self.exact(policies, "name", str(desired["name"]))
        if current:
            comparable = {
                "name": current.get("name"),
                "description": current.get("description") or "",
                "enabled": bool(current.get("enabled")),
                "source_posture_checks": current.get("source_posture_checks") or [],
                "rules": [self.request_rule(rule) for rule in current.get("rules") or []],
            }
            if comparable == desired:
                print(f"PASS policy {desired['name']}")
                return
        action = "replace" if current else "create"
        print(f"PLAN {action} policy {desired['name']}")
        if not self.settings.apply:
            return
        method = "PUT" if current else "POST"
        path = f"/api/policies/{current['id']}" if current else "/api/policies"
        self.request(method, path, desired)
        self.changed.append(f"policy:{desired['name']}")

    def ensure_ssh_policies(self, admin_group: Json, host_group: Json) -> None:
        admin_id = str(admin_group["id"])
        host_id = str(host_group["id"])
        base = {
            "enabled": True,
            "source_posture_checks": [],
        }
        self.ensure_policy(
            {
                **base,
                "name": "dev-to-vps-ssh",
                "description": "admin peers to host NetBird SSH",
                "rules": [
                    {
                        "name": "dev-to-vps-ssh",
                        "description": "",
                        "enabled": True,
                        "action": "accept",
                        "bidirectional": False,
                        "protocol": "netbird-ssh",
                        "sources": [admin_id],
                        "destinations": [host_id],
                        "authorized_groups": {admin_id: [self.settings.ssh_user]},
                    }
                ],
            }
        )
        self.ensure_policy(
            {
                **base,
                "name": "dev-to-vps-tcp22",
                "description": "admin peers to host native sshd over NetBird",
                "rules": [
                    {
                        "name": "dev-to-vps-tcp22",
                        "description": "",
                        "enabled": True,
                        "action": "accept",
                        "bidirectional": False,
                        "protocol": "tcp",
                        "ports": ["22"],
                        "sources": [admin_id],
                        "destinations": [host_id],
                    }
                ],
            }
        )

    def ensure_admin_peer(self, admin_group: Json) -> Json | None:
        if not self.settings.admin_peer:
            return None
        peer = self.resolve_peer(self.settings.admin_peer)
        if not peer:
            raise AppError(f"admin peer not found: {self.settings.admin_peer}")
        self.ensure_group_peer(admin_group, str(peer["id"]))
        return peer

    def group_named(self, cache: dict[str, Json], name: str) -> Json:
        if name in cache:
            return cache[name]
        group = self.exact(self.list_items("/api/groups"), "name", name)
        if not group:
            raise AppError(f"group not found: {name}")
        cache[name] = group
        return group

    def spec_policy(self, spec: Json, groups: dict[str, Json]) -> Json:
        source = self.group_named(groups, str(spec["source_group"]))
        destination = self.group_named(groups, str(spec["destination_group"]))
        protocol = str(spec.get("protocol") or "tcp")
        rule: Json = {
            "name": spec["name"],
            "description": spec.get("description") or "",
            "enabled": bool(spec.get("enabled", True)),
            "action": spec.get("action") or "accept",
            "bidirectional": bool(spec.get("bidirectional", False)),
            "protocol": protocol,
            "sources": [str(source["id"])],
            "destinations": [str(destination["id"])],
        }
        if spec.get("ports"):
            rule["ports"] = spec["ports"]
        if spec.get("port_ranges"):
            rule["port_ranges"] = spec["port_ranges"]
        if protocol == "netbird-ssh":
            user = str(spec.get("ssh_user") or self.settings.ssh_user)
            rule["authorized_groups"] = {str(source["id"]): [user]}
        return {
            "name": spec["name"],
            "description": spec.get("description") or "",
            "enabled": bool(spec.get("enabled", True)),
            "source_posture_checks": spec.get("source_posture_checks") or [],
            "rules": [rule],
        }

    def apply_spec(self, spec: Json) -> None:
        groups: dict[str, Json] = {}
        for item in spec.get("groups") or []:
            name = str(item["name"])
            group = self.ensure_group(name)
            optional = bool(item.get("optional_peers"))
            selectors = item.get("peer_names") or item.get("peer_selectors") or []
            for selector in selectors:
                peer = self.resolve_peer(str(selector))
                if not peer:
                    if optional:
                        print(f"PASS skip missing optional peer {selector}")
                        continue
                    raise AppError(f"peer not found: {selector}")
                group = self.ensure_group_peer(group, str(peer["id"]))
            groups[name] = group
        for policy in spec.get("policies") or []:
            self.ensure_policy(self.spec_policy(policy, groups))
        names = [str(name) for name in spec.get("disable_policy_names") or []]
        if names:
            self.disable_named_policies(names)

    def disable_named_policies(self, names: list[str]) -> None:
        wanted = set(names)
        for policy in self.list_items("/api/policies"):
            name = str(policy.get("name") or "")
            if name not in wanted:
                continue
            if not policy.get("enabled"):
                print(f"PASS disabled {name}")
                continue
            print(f"PLAN disable {name}")
            if not self.settings.apply:
                continue
            body = {
                "name": name,
                "description": policy.get("description") or "",
                "enabled": False,
                "source_posture_checks": policy.get("source_posture_checks") or [],
                "rules": [self.request_rule(rule) for rule in policy.get("rules") or []],
            }
            self.request("PUT", f"/api/policies/{policy['id']}", body)
            self.changed.append(f"policy:disable:{name}")

    def disable_default_policy(self) -> None:
        if not self.settings.disable_default:
            return
        self.disable_named_policies(
            ["Default", "Default All -> All", "All -> All"]
        )

    def prove_data_plane(self, overlay_ip: str) -> None:
        public = subprocess.run(
            ["ssh", "-T", "-o", "BatchMode=yes", self.settings.target, "whoami"],
            text=True,
            capture_output=True,
        )
        if public.returncode != 0 or public.stdout.strip() != self.settings.ssh_user:
            raise AppError("public SSH outage path failed")
        print("PASS public SSH outage path")
        if not self.settings.enable_ssh or not self.settings.admin_peer:
            return
        nb = subprocess.run(
            [
                "netbird",
                "ssh",
                "-u",
                self.settings.ssh_user,
                overlay_ip,
                "whoami",
            ],
            text=True,
            capture_output=True,
            timeout=20,
        )
        if nb.returncode != 0 or nb.stdout.strip() != self.settings.ssh_user:
            raise AppError("NetBird SSH data-plane proof failed")
        print("PASS NetBird SSH data plane")

    def run(self) -> str:
        self.list_items("/api/groups")
        print("PASS PAT GET /api/groups")
        host_group = self.ensure_group(self.settings.host_group)
        admin_group = self.ensure_group(self.settings.admin_group)
        peer = self.ensure_joined(host_group)
        if not self.settings.apply and peer is None:
            print("PLAN remaining peer-dependent reconciliation after join")
            return ""
        if peer is None:
            raise AppError("host peer missing")
        host_group = self.ensure_group_peer(host_group, str(peer["id"]))
        self.ensure_admin_peer(admin_group)
        spec = None
        if self.settings.spec:
            if not self.settings.spec.is_file():
                raise AppError(f"access spec not found: {self.settings.spec}")
            loaded = json.loads(self.settings.spec.read_text(encoding="utf-8"))
            if not isinstance(loaded, dict):
                raise AppError("access spec must be an object")
            spec = loaded
            self.apply_spec(spec)
        elif self.settings.enable_ssh:
            self.ensure_ssh_policies(admin_group, host_group)
        if self.settings.enable_ssh:
            self.ensure_peer_ssh(peer)
            if self.settings.apply and not self.remote.ssh_server_enabled():
                self.remote.enable_ssh_server()
                self.changed.append("host-ssh-server")
                print("CHANGE enabled host NetBird SSH server")
        overlay_ip = self.remote.overlay_ip() if self.settings.apply else str(peer.get("ip") or "")
        if spec is None:
            self.disable_default_policy()
        if self.settings.apply:
            self.prove_data_plane(overlay_ip)
        print("RESULT changes=" + (",".join(self.changed) if self.changed else "none"))
        if overlay_ip:
            print(f"RESULT overlay_ip={overlay_ip}")
        return overlay_ip


def parse_args(argv: list[str] | None = None) -> Settings:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True)
    parser.add_argument("--host-selector", required=True)
    parser.add_argument("--host-group", default="app-servers")
    parser.add_argument("--admin-group", default="dev")
    parser.add_argument("--admin-peer")
    parser.add_argument("--ssh-user", default="debian")
    parser.add_argument("--key-name", default="host-join")
    parser.add_argument("--enable-ssh", action="store_true")
    parser.add_argument("--disable-default", action="store_true")
    parser.add_argument("--spec", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    if args.disable_default and not args.admin_peer:
        parser.error("--disable-default requires --admin-peer for a data-plane proof")
    return Settings(
        target=args.target,
        host_selector=args.host_selector,
        host_group=args.host_group,
        admin_group=args.admin_group,
        admin_peer=args.admin_peer,
        ssh_user=args.ssh_user,
        key_name=args.key_name,
        apply=args.apply,
        enable_ssh=args.enable_ssh,
        disable_default=args.disable_default,
        spec=args.spec,
    )


def main(argv: list[str] | None = None) -> int:
    try:
        settings = parse_args(argv)
        config = load_config()
        Reconciler(config, settings).run()
        return 0
    except AppError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
