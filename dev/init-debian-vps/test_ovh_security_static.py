#!/usr/bin/env python3
"""Offline security contract tests for the OVH VPS.

These tests never contact OVH or the VPS. They catch unsafe repository changes
before deployment; live reachability is a separate acceptance check.
"""
from __future__ import annotations

import ipaddress
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS_ROOT = HERE.parents[1]
SECURITY_PROFILE = HERE / "profiles" / "ovh-vps.security.example.json"
VPS_PROFILE = HERE / "profiles" / "ovh-vps.example.json"
BOOTSTRAP = HERE / "bootstrap-debian.sh"
OVERLAY_HELPER = HERE / "early-warning" / "files" / "vps-caddy-overlay"
COMMAND_MANIFEST = SCRIPTS_ROOT / "meta" / "cmd-links.json"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class EdgeFirewallContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = read_json(SECURITY_PROFILE)
        self.rules = self.profile["rules"]

    def test_ssh_allowlist_contains_exactly_one_ipv4_host(self) -> None:
        ssh_rules = [
            rule
            for rule in self.rules
            if rule.get("protocol") == "tcp" and rule.get("destination_port") == 22
        ]
        self.assertEqual(len(ssh_rules), 1)
        self.assertEqual(ssh_rules[0]["sequence"], self.profile["ssh_sequence"])
        self.assertEqual(ssh_rules[0]["action"], "permit")
        network = ipaddress.ip_network(ssh_rules[0]["source"], strict=True)
        self.assertEqual(network.version, 4)
        self.assertEqual(network.prefixlen, 32)
        self.assertNotIn("source_port", ssh_rules[0])

    def test_rules_are_fail_closed_and_ordered(self) -> None:
        expected = [
            (0, "permit", "tcp", None),
            (1, "permit", "tcp", 22),
            (2, "permit", "tcp", 80),
            (3, "permit", "tcp", 443),
            (4, "permit", "udp", 3478),
            (5, "permit", "icmp", None),
            (19, "deny", "ipv4", None),
        ]
        actual = [
            (
                rule["sequence"],
                rule["action"],
                rule["protocol"],
                rule.get("destination_port"),
            )
            for rule in self.rules
        ]
        self.assertEqual(actual, expected)
        self.assertEqual(self.rules[0].get("tcp_option"), "established")
        self.assertEqual(self.rules[-1], {"sequence": 19, "action": "deny", "protocol": "ipv4"})


class HostFirewallContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bootstrap = BOOTSTRAP.read_text(encoding="utf-8")

    def test_ssh_and_stun_are_ipv4_only_but_web_is_dual_stack(self) -> None:
        self.assertIn("meta nfproto ipv4 tcp dport 22 ct state new accept", self.bootstrap)
        self.assertIn("tcp dport { 80, 443 } ct state new accept", self.bootstrap)
        self.assertIn("meta nfproto ipv4 udp dport 3478 ct state new accept", self.bootstrap)
        self.assertNotIn("tcp dport { 22, 80, 443 }", self.bootstrap)
        self.assertNotIn("ip6 nexthdr tcp tcp dport 22", self.bootstrap)

    def test_input_chain_keeps_default_drop(self) -> None:
        self.assertIn("type filter hook input priority filter; policy drop;", self.bootstrap)
        self.assertIn("ct state established,related accept", self.bootstrap)
        self.assertIn("nft -c -f /etc/nftables.conf", self.bootstrap)

    def test_overlay_is_not_trusted_as_a_whole_interface(self) -> None:
        self.assertNotIn('iifname "wt0" accept', self.bootstrap)


class CaddyNetBirdBootContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.helper = OVERLAY_HELPER.read_text(encoding="utf-8")

    def test_overlay_site_binds_only_after_wt0_is_ready(self) -> None:
        self.assertIn("bind __LISTEN_IP__", self.helper)
        self.assertIn("ip = wt0_ip()", self.helper)
        self.assertIn("remote_ip 100.64.0.0/10 fd00::/8", self.helper)
        self.assertIn("respond @notOverlay 403", self.helper)

    def test_overlay_oauth_redirects_are_kept(self) -> None:
        self.assertIn('/nb-auth"', self.helper)
        self.assertIn('/nb-silent-auth"', self.helper)


class OperationsContractTests(unittest.TestCase):
    def test_destructive_ovh_operations_require_named_owner_profile(self) -> None:
        profile = read_json(VPS_PROFILE)
        self.assertEqual(profile["ovh_cli_profile"], "owner-offline")

    def test_edge_credentials_live_outside_the_repository(self) -> None:
        profile = read_json(SECURITY_PROFILE)
        self.assertEqual(profile["credential_env"], "~/.config/ovhcloud/ssh-edge.env")
        serialized = SECURITY_PROFILE.read_text(encoding="utf-8")
        self.assertNotIn("OVH_CLIENT_SECRET=", serialized)
        self.assertNotIn("OVH_APPLICATION_SECRET=", serialized)

    def test_public_command_is_managed_by_cmd_links(self) -> None:
        manifest = read_json(COMMAND_MANIFEST)
        rows = [row for row in manifest["commands"] if row["name"] == "ovh-ssh-source"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["mode"], "symlink")
        self.assertEqual(rows[0]["target"], "dev/init-debian-vps/ovh-ssh-source.py")

    def test_server_side_jit_helpers_are_not_part_of_the_design(self) -> None:
        forbidden = ("vps-ssh-jit", "ssh_jit", "ssh-jit")
        texts = [
            BOOTSTRAP.read_text(encoding="utf-8"),
            (HERE / "init-vps.py").read_text(encoding="utf-8"),
        ]
        for marker in forbidden:
            self.assertTrue(all(marker not in text for text in texts), marker)


if __name__ == "__main__":
    unittest.main()
