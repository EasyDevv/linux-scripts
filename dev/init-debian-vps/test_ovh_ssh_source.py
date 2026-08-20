#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ovh_ssh_source", HERE / "ovh-ssh-source.py")
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class RuleTests(unittest.TestCase):
    def test_rule_matches_cli_shape(self) -> None:
        rule = mod.Rule(1, "permit", "tcp", "198.51.100.20/32", 22)
        self.assertTrue(
            rule.matches(
                {
                    "sequence": 1,
                    "action": "permit",
                    "protocol": "tcp",
                    "source": "198.51.100.20/32",
                    "destinationPort": "eq 22",
                }
            )
        )
        self.assertFalse(rule.matches({"sequence": 1, "action": "permit"}))

    def test_rule_create_args_omit_source_port(self) -> None:
        rule = mod.Rule(1, "permit", "tcp", "198.51.100.20/32", 22)
        args = rule.create_args()
        self.assertIn("--destination-port", args)
        self.assertNotIn("--source-port", args)


class SourceTests(unittest.TestCase):
    def test_normalizes_one_host_only(self) -> None:
        self.assertEqual(mod.normalize_cidr("203.0.113.10"), "203.0.113.10/32")
        with self.assertRaises(mod.AppError):
            mod.normalize_cidr("203.0.113.0/24")
        with self.assertRaises(mod.AppError):
            mod.normalize_cidr("::1")

    def test_replaces_only_ssh_rule(self) -> None:
        settings = mod.Settings.load(HERE / "profiles" / "ovh-vps.security.example.json")
        rules = settings.desired_rules("203.0.113.10")
        ssh = next(rule for rule in rules if rule.sequence == settings.ssh_sequence)
        web = next(rule for rule in rules if rule.sequence == 3)
        self.assertEqual(ssh.source, "203.0.113.10/32")
        self.assertEqual(ssh.destination_port, 22)
        self.assertEqual(web.destination_port, 443)


class CredentialTests(unittest.TestCase):
    def test_rejects_weak_file_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "edge.env"
            path.write_text("OVH_ENDPOINT=ovh-us\nOVH_CLIENT_ID=x\nOVH_CLIENT_SECRET=y\n")
            path.chmod(0o644)
            with self.assertRaises(mod.AppError):
                mod.load_env(path)


if __name__ == "__main__":
    unittest.main()
