#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


alias = load("manage_ssh_alias", "manage-ssh-alias.py")
known = load("repair_known_hosts", "repair-known-hosts.py")


class AliasTests(unittest.TestCase):
    SOURCE = """Host ovh-vps
    HostName 203.0.113.10
    User debian
    IdentityFile ~/.ssh/example_vps
    IdentitiesOnly yes

Host other
    HostName 127.0.0.1
"""

    def test_add_and_noop(self) -> None:
        updated, action = alias.reconcile(
            self.SOURCE, "ovh-vps", "ovh-vps-nb", "100.64.0.10"
        )
        self.assertEqual(action, "add")
        self.assertIn("Host ovh-vps-nb", updated)
        self.assertIn("HostName 100.64.0.10", updated)
        self.assertIn("UserKnownHostsFile ~/.ssh/known_hosts.netbird", updated)
        self.assertIn("StrictHostKeyChecking accept-new", updated)
        self.assertIn("IdentityFile ~/.ssh/example_vps", updated)
        again, action = alias.reconcile(
            updated, "ovh-vps", "ovh-vps-nb", "100.64.0.10"
        )
        self.assertEqual(action, "noop")
        self.assertEqual(again, updated)

    def test_replace_managed_ip(self) -> None:
        updated, _ = alias.reconcile(
            self.SOURCE, "ovh-vps", "ovh-vps-nb", "100.64.0.10"
        )
        changed, action = alias.reconcile(
            updated, "ovh-vps", "ovh-vps-nb", "100.64.0.11"
        )
        self.assertEqual(action, "replace")
        self.assertNotIn("100.64.0.10", changed)
        self.assertIn("100.64.0.11", changed)

    def test_adopts_matching_unmanaged_alias(self) -> None:
        text = self.SOURCE + "\nHost ovh-vps-nb\n    HostName 100.64.0.11\n    User debian\n    IdentityFile ~/.ssh/example_vps\n    IdentitiesOnly yes\n"
        updated, action = alias.reconcile(
            text, "ovh-vps", "ovh-vps-nb", "100.64.0.11"
        )
        self.assertEqual(action, "adopt")
        self.assertIn("# BEGIN init-debian-vps alias:ovh-vps-nb", updated)

    def test_refuses_different_unmanaged_alias(self) -> None:
        text = self.SOURCE + "\nHost ovh-vps-nb\n    HostName 100.64.0.10\n"
        with self.assertRaises(ValueError):
            alias.reconcile(text, "ovh-vps", "ovh-vps-nb", "100.64.0.11")

    def test_generated_config_resolves(self) -> None:
        updated, _ = alias.reconcile(
            self.SOURCE, "ovh-vps", "ovh-vps-nb", "100.64.0.10"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config"
            path.write_text(updated)
            alias.verify(path, "ovh-vps-nb", "100.64.0.10")


class KnownHostsTests(unittest.TestCase):
    def test_clean_invalid_preserves_comments(self) -> None:
        # The invalid line reproduces ssh-keygen -R refusing the entire file.
        text = "# keep\ninvalid line\n\n"
        cleaned, removed = known.clean_invalid(text)
        self.assertEqual(removed, [2])
        self.assertEqual(cleaned, "# keep\n\n")


if __name__ == "__main__":
    unittest.main()
