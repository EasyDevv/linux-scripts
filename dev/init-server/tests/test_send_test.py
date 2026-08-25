#!/usr/bin/env python3
from __future__ import annotations

from importlib.machinery import SourceFileLoader
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent.parent


def load(name: str, path: Path):
    loader = SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


alert = load("vps_alert", HERE / "early-warning" / "files" / "vps-alert")
send_test = load("send_test", HERE / "early-warning" / "send-test.py")


class SendTestContractTests(unittest.TestCase):
    def test_scenarios_match_alert_policy(self) -> None:
        self.assertTrue(send_test.SCENARIOS)
        for scenario in send_test.SCENARIOS:
            notify, ping = send_test.evaluate(alert, scenario)
            self.assertEqual(notify, scenario.expect_notify, scenario.id)
            self.assertEqual(ping, scenario.expect_ping, scenario.id)

    def test_dry_run_does_not_need_sender_env(self) -> None:
        self.assertEqual(send_test.main(["--list"]), 0)
        self.assertEqual(send_test.main([]), 0)
