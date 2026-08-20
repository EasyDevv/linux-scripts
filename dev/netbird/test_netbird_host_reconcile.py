#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import netbird_host_reconcile as host
from netbird_setup import Config


class FakeApi:
    def __init__(self) -> None:
        self.groups = [{"id": "all", "name": "All", "peers": []}]
        self.peers = [
            {
                "id": "admin-id",
                "name": "admin-box",
                "hostname": "admin-box",
                "dns_label": "admin-box.netbird.selfhosted",
                "ip": "100.77.1.2",
                "ssh_enabled": False,
                "login_expiration_enabled": False,
                "inactivity_expiration_enabled": False,
            },
            {
                "id": "host-id",
                "name": "ovh-vps",
                "hostname": "ovh-vps",
                "dns_label": "ovh-vps.netbird.selfhosted",
                "ip": "100.64.0.10",
                "ssh_enabled": False,
                "login_expiration_enabled": False,
                "inactivity_expiration_enabled": False,
            },
        ]
        self.policies = [
            {
                "id": "default-id",
                "name": "Default",
                "description": "mesh",
                "enabled": True,
                "source_posture_checks": [],
                "rules": [
                    {
                        "name": "Default",
                        "enabled": True,
                        "action": "accept",
                        "bidirectional": True,
                        "protocol": "all",
                        "sources": [{"id": "all"}],
                        "destinations": [{"id": "all"}],
                    }
                ],
            }
        ]
        self.keys = [
            {
                "id": "stale",
                "name": "host-join",
                "revoked": False,
                "used_times": 0,
                "auto_groups": ["host-group"],
            }
        ]
        self.calls: list[tuple[str, str, Any]] = []
        self._next = 1

    def __call__(
        self,
        _url: str,
        _token: str,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> Any:
        self.calls.append((method, path, deepcopy(body)))
        if method == "GET":
            return deepcopy(
                {
                    "/api/groups": self.groups,
                    "/api/peers": self.peers,
                    "/api/policies": self.policies,
                    "/api/setup-keys": self.keys,
                }[path]
            )
        if method == "POST" and path == "/api/groups":
            item = {"id": f"group-{self._next}", **(body or {})}
            self._next += 1
            self.groups.append(item)
            return deepcopy(item)
        if method == "PUT" and path.startswith("/api/groups/"):
            item = {"id": path.rsplit("/", 1)[1], **(body or {})}
            self.groups = [g for g in self.groups if g["id"] != item["id"]] + [item]
            return deepcopy(item)
        if method == "POST" and path == "/api/policies":
            item = {"id": f"policy-{self._next}", **(body or {})}
            self._next += 1
            self.policies.append(item)
            return deepcopy(item)
        if method == "PUT" and path.startswith("/api/policies/"):
            item = {"id": path.rsplit("/", 1)[1], **(body or {})}
            self.policies = [p for p in self.policies if p["id"] != item["id"]] + [item]
            return deepcopy(item)
        if method == "PUT" and path.startswith("/api/peers/"):
            peer_id = path.rsplit("/", 1)[1]
            current = next(p for p in self.peers if p["id"] == peer_id)
            current.update(body or {})
            return deepcopy(current)
        if method == "PUT" and path.startswith("/api/setup-keys/"):
            key_id = path.rsplit("/", 1)[1]
            current = next(k for k in self.keys if k["id"] == key_id)
            current.update(body or {})
            return deepcopy(current)
        if method == "POST" and path == "/api/setup-keys":
            return {"id": "new-key", "key": "secret", **(body or {})}
        raise AssertionError((method, path, body))


class FakeRemote:
    def connected(self, _url: str) -> bool:
        return True

    def ssh_server_enabled(self) -> bool:
        return True

    def overlay_ip(self) -> str:
        return "100.64.0.10"

    def install_client(self) -> None:
        raise AssertionError("already connected")

    def join(self, _url: str, _key: str, _hostname: str) -> None:
        raise AssertionError("already connected")

    def enable_ssh_server(self) -> None:
        raise AssertionError("already enabled")


class TestReconciler(unittest.TestCase):
    def settings(self, **overrides: Any) -> host.Settings:
        return host.Settings(
            target=str(overrides.get("target", "ovh-vps")),
            host_selector=str(overrides.get("host_selector", "ovh-vps")),
            host_group=str(overrides.get("host_group", "app-servers")),
            admin_group=str(overrides.get("admin_group", "dev")),
            admin_peer=overrides.get("admin_peer", "admin-box"),
            ssh_user=str(overrides.get("ssh_user", "debian")),
            key_name=str(overrides.get("key_name", "host-join")),
            apply=bool(overrides.get("apply", True)),
            enable_ssh=bool(overrides.get("enable_ssh", True)),
            disable_default=bool(overrides.get("disable_default", True)),
            spec=overrides.get("spec"),
        )

    def reconciler(self, api: FakeApi, **settings: Any) -> host.Reconciler:
        obj = host.Reconciler(
            Config(
                "token",
                "https://management.example",
                "unused",
                Path("/tmp/env"),
                Path("/tmp/keys"),
            ),
            self.settings(**settings),
            api=api,
            remote=FakeRemote(),  # type: ignore[arg-type]
        )
        obj.prove_data_plane = lambda _ip: None  # type: ignore[method-assign]
        return obj

    def test_apply_builds_minimal_groups_policies_and_peer_update(self) -> None:
        api = FakeApi()
        result = self.reconciler(api).run()
        self.assertEqual(result, "100.64.0.10")
        self.assertIn("app-servers", {g["name"] for g in api.groups})
        self.assertIn("dev", {g["name"] for g in api.groups})
        dev = next(g for g in api.groups if g["name"] == "dev")
        apps = next(g for g in api.groups if g["name"] == "app-servers")
        self.assertEqual(dev["peers"], ["admin-id"])
        self.assertEqual(apps["peers"], ["host-id"])
        self.assertTrue(next(p for p in api.peers if p["id"] == "host-id")["ssh_enabled"])
        self.assertFalse(next(p for p in api.policies if p["name"] == "Default")["enabled"])
        peer_put = next(call for call in api.calls if call[1] == "/api/peers/host-id")
        self.assertEqual(
            set(peer_put[2]),
            {
                "name",
                "ssh_enabled",
                "login_expiration_enabled",
                "inactivity_expiration_enabled",
            },
        )

    def test_second_apply_is_noop(self) -> None:
        api = FakeApi()
        first = self.reconciler(api)
        first.run()
        api.calls.clear()
        second = self.reconciler(api)
        second.run()
        mutations = [call for call in api.calls if call[0] != "GET"]
        self.assertEqual(mutations, [])
        self.assertEqual(second.changed, [])

    def test_revoke_includes_required_auto_groups(self) -> None:
        api = FakeApi()
        reconciler = self.reconciler(api, apply=True)
        reconciler.revoke_unused_keys("host-join")
        put = next(call for call in api.calls if call[1] == "/api/setup-keys/stale")
        self.assertEqual(put[2], {"revoked": True, "auto_groups": ["host-group"]})

    def test_spec_applies_optional_groups_and_policies(self) -> None:
        import json
        import tempfile
        from pathlib import Path as P

        api = FakeApi()
        spec = {
            "groups": [
                {"name": "employees", "peer_names": []},
                {
                    "name": "image-servers",
                    "peer_names": ["missing-home"],
                    "optional_peers": True,
                },
            ],
            "policies": [
                {
                    "name": "employees-to-app",
                    "source_group": "employees",
                    "destination_group": "app-servers",
                    "protocol": "tcp",
                    "ports": ["3000"],
                    "bidirectional": False,
                },
                {
                    "name": "dev-all-access",
                    "source_group": "dev",
                    "destination_group": "All",
                    "protocol": "all",
                    "bidirectional": False,
                },
            ],
            "disable_policy_names": ["Default"],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = P(tmp) / "spec.json"
            path.write_text(json.dumps(spec))
            self.reconciler(api, spec=path).run()
        names = {g["name"] for g in api.groups}
        self.assertIn("employees", names)
        self.assertIn("image-servers", names)
        policy_names = {p["name"] for p in api.policies}
        self.assertIn("employees-to-app", policy_names)
        self.assertIn("dev-all-access", policy_names)
        self.assertFalse(next(p for p in api.policies if p["name"] == "Default")["enabled"])
        self.assertNotIn("dev-to-vps-ssh", policy_names)

    def test_disable_default_requires_admin_peer(self) -> None:
        with self.assertRaises(SystemExit):
            host.parse_args(
                [
                    "--target",
                    "vps",
                    "--host-selector",
                    "vps",
                    "--disable-default",
                ]
            )


if __name__ == "__main__":
    unittest.main()
