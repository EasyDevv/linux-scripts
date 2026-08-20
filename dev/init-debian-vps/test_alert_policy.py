#!/usr/bin/env python3
from __future__ import annotations

from importlib.machinery import SourceFileLoader
import importlib.util
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def load(name: str, path: Path):
    loader = SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


alert = load("vps_alert", HERE / "early-warning" / "files" / "vps-alert")
journal = load("vps_journal_watch", HERE / "early-warning" / "files" / "vps-journal-watch")
audit = load("vps_audit_plugin", HERE / "early-warning" / "files" / "vps-audit-plugin")
falco = load("vps_falco_alert", HERE / "early-warning" / "files" / "vps-falco-alert")


class AlertPolicyTests(unittest.TestCase):
    def test_routine_events_are_dropped_but_successful_login_is_immediate(self) -> None:
        self.assertFalse(alert.should_notify("routine", "info"))
        self.assertFalse(alert.should_notify("falco", "warning"))
        self.assertTrue(alert.should_notify("falco", "error"))
        self.assertTrue(alert.should_notify("ssh-login", "info"))
        self.assertTrue(alert.should_notify("crowdsec-decision", "error"))
        self.assertTrue(alert.should_notify("firewall-change", "critical"))

    def test_critical_alerts_are_not_blocked_by_noncritical_quota(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            original = (alert.STATE_DIR, alert.STATE_FILE, alert.LOCK_FILE)
            setattr(alert, "STATE_DIR", Path(tmp))
            setattr(alert, "STATE_FILE", Path(tmp) / "throttle.json")
            setattr(alert, "LOCK_FILE", Path(tmp) / "throttle.lock")
            try:
                for index in range(alert.MAX_NONCRITICAL_PER_WINDOW):
                    self.assertTrue(alert.allow(f"warning-{index}", "falco", "warning"))
                self.assertFalse(alert.allow("warning-overflow", "falco", "warning"))
                self.assertTrue(alert.allow("config:/etc/ssh/sshd_config", "sshd-config-change", "critical"))
            finally:
                setattr(alert, "STATE_DIR", original[0])
                setattr(alert, "STATE_FILE", original[1])
                setattr(alert, "LOCK_FILE", original[2])

    def test_discord_payload_is_a_readable_embed(self) -> None:
        payload = alert.build_discord_payload(
            "ssh-unauthorized-login",
            "critical",
            "success",
            "Accepted publickey for root from 203.0.113.10 port 22 ssh2",
        )
        embed = payload["embeds"][0]
        self.assertNotIn("content", payload)
        self.assertEqual(payload["allowed_mentions"], {"parse": []})
        self.assertEqual(embed["title"], "🚨 Unauthorized SSH login")
        self.assertEqual(embed["color"], alert.SEVERITY_COLORS["critical"])
        self.assertIn("```text", embed["description"])
        field_values = {field["name"]: field["value"] for field in embed["fields"]}
        self.assertEqual(field_values["Event"], "`ssh-unauthorized-login`")
        self.assertEqual(field_values["Severity"], "`CRITICAL`")
        self.assertEqual(field_values["Outcome"], "`SUCCESS`")
        self.assertTrue(embed["timestamp"].endswith("Z"))


class JournalPolicyTests(unittest.TestCase):
    def test_individual_allowusers_denials_are_suppressed_until_a_burst(self) -> None:
        tracker = journal.AlertTracker()
        events = []

        def capture(event, severity, body, **kwargs):
            events.append((event, severity, body, kwargs))

        for index in range(4):
            journal.handle(
                {
                    "_SYSTEMD_UNIT": "ssh.service",
                    "PRIORITY": "6",
                    "MESSAGE": (
                        f"User root from 62.60.130.{index + 1} not allowed "
                        "because not listed in AllowUsers"
                    ),
                },
                now=1000 + index,
                tracker=tracker,
                emit_fn=capture,
            )
        self.assertEqual(events, [])
        journal.handle(
            {
                "_SYSTEMD_UNIT": "ssh.service",
                "PRIORITY": "6",
                "MESSAGE": "User root from 62.60.130.5 not allowed because not listed in AllowUsers",
            },
            now=1004,
            tracker=tracker,
            emit_fn=capture,
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0][0:2], ("ssh-deny-burst", "error"))
        self.assertIn("distinct_sources=5", events[0][2])

    def test_successful_login_and_unauthorized_account_are_distinguished(self) -> None:
        events = []
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "sshd_config"
            config.write_text("AllowUsers debian\n", encoding="utf-8")

            def capture(event, severity, body, **kwargs):
                events.append((event, severity, body, kwargs))

            journal.handle(
                {
                    "_SYSTEMD_UNIT": "ssh.service",
                    "MESSAGE": "Accepted publickey for debian from 100.64.1.2 port 22 ssh2",
                },
                now=1000,
                tracker=journal.AlertTracker(),
                emit_fn=capture,
                config_path=config,
            )
            journal.handle(
                {
                    "_SYSTEMD_UNIT": "ssh.service",
                    "MESSAGE": "Accepted publickey for root from 100.64.1.3 port 22 ssh2",
                },
                now=1001,
                tracker=journal.AlertTracker(),
                emit_fn=capture,
                config_path=config,
            )
        self.assertEqual([event[0] for event in events], ["ssh-login", "ssh-unauthorized-login"])
        self.assertEqual(events[0][1], "info")
        self.assertEqual(events[1][1], "critical")

    def test_recovery_alert_requires_ssh_and_netbird_failures(self) -> None:
        tracker = journal.AlertTracker()
        events = []

        def capture(event, severity, body, **kwargs):
            events.append((event, severity, body, kwargs))

        journal.handle(
            {
                "_SYSTEMD_UNIT": "ssh.service",
                "PRIORITY": "3",
                "MESSAGE": "ssh.service: failed to start",
            },
            now=1000,
            tracker=tracker,
            emit_fn=capture,
        )
        self.assertEqual(events, [])
        journal.handle(
            {
                "_SYSTEMD_UNIT": "netbird.service",
                "PRIORITY": "3",
                "MESSAGE": "netbird.service: failed to start",
            },
            now=1001,
            tracker=tracker,
            emit_fn=capture,
        )
        self.assertEqual(events[0][0:2], ("recovery-path-failure", "critical"))


class SourceClassifierTests(unittest.TestCase):
    def test_sensitive_audit_paths(self) -> None:
        self.assertEqual(
            audit.classify('type=PATH name="/home/debian/.ssh/authorized_keys" key="vps_ew"'),
            ("authorized-keys-change", "/home/debian/.ssh/authorized_keys"),
        )
        self.assertEqual(
            audit.classify('type=PATH name="/etc/nftables.conf" key="vps_ew"'),
            ("firewall-change", "/etc/nftables.conf"),
        )
        self.assertIsNone(audit.classify('type=PATH name="/etc/vps-alert/watch-test" key="vps_ew"'))

    def test_falco_only_forwards_error_and_above(self) -> None:
        self.assertFalse(falco.should_alert("warning"))
        self.assertTrue(falco.should_alert("error"))
        self.assertTrue(falco.should_alert("critical"))


if __name__ == "__main__":
    unittest.main()
