#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "ts-ssh-guard.py").read_text(encoding="utf-8")


def load_module():
    spec = importlib.util.spec_from_file_location("ts_ssh_guard", ROOT / "ts-ssh-guard.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    import sys

    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


guard = load_module()


class KeyTests(unittest.TestCase):
    def test_split_combined_reads(self) -> None:
        self.assertEqual(guard.split_keys("j\r"), ["j", "\r"])
        self.assertEqual(guard.split_keys("\x1b[B\x1b[A\r"), ["\x1b[B", "\x1b[A", "\r"])
        self.assertEqual(guard.split_keys("\x1b"), ["\x1b"])
        self.assertEqual(guard.split_keys("\x1b[1~\x1b[4~"), ["\x1b[1~", "\x1b[4~"])

    def test_classify_arrows_and_letters(self) -> None:
        self.assertEqual(guard.classify_key("j"), "DOWN")
        self.assertEqual(guard.classify_key("k"), "UP")
        self.assertEqual(guard.classify_key("g"), "FIRST")
        self.assertEqual(guard.classify_key("G"), "LAST")
        self.assertEqual(guard.classify_key("\x1b[A"), "UP")
        self.assertEqual(guard.classify_key("\x1b[B"), "DOWN")
        self.assertEqual(guard.classify_key("\x1bOA"), "UP")
        self.assertEqual(guard.classify_key("\x1b[H"), "FIRST")
        self.assertEqual(guard.classify_key("\x1b[F"), "LAST")
        self.assertEqual(guard.classify_key("\r"), "ENTER")
        self.assertEqual(guard.classify_key("q"), "QUIT")
        self.assertEqual(guard.classify_key("\x03"), "QUIT")
        self.assertEqual(guard.classify_key("\x1b"), "QUIT")
        self.assertIsNone(guard.classify_key("x"))

    def test_move_does_not_wrap(self) -> None:
        self.assertEqual(guard.move_index(0, "UP", 3), 0)
        self.assertEqual(guard.move_index(2, "DOWN", 3), 2)
        self.assertEqual(guard.move_index(1, "DOWN", 3), 2)
        self.assertEqual(guard.move_index(1, "FIRST", 3), 0)
        self.assertEqual(guard.move_index(0, "LAST", 3), 2)


class PolicyTests(unittest.TestCase):
    def facts(self, **overrides: str) -> guard.Facts:
        values = {
            "dropin": "absent",
            "unit": "active",
            "unit_env": "unset",
            "live": "unknown",
            "envfile": "unset",
        }
        values.update(overrides)
        return guard.Facts(**values)

    def test_apply_installs_when_dropin_is_absent(self) -> None:
        self.assertEqual(guard.decide(self.facts(), "apply"), "install")

    def test_apply_is_noop_when_already_loaded(self) -> None:
        facts = self.facts(dropin="match", unit_env="set", live="set")
        self.assertEqual(guard.decide(facts, "apply"), "noop")

    def test_apply_restarts_when_process_lacks_the_flag(self) -> None:
        facts = self.facts(dropin="match", unit_env="set", live="unset")
        self.assertEqual(guard.decide(facts, "apply"), "restart")

    def test_other_dropin_is_a_conflict(self) -> None:
        facts = self.facts(dropin="other")
        self.assertEqual(guard.decide(facts, "apply"), "conflict")
        self.assertEqual(guard.decide(facts, "recover"), "conflict")

    def test_recover_removes_only_our_dropin(self) -> None:
        self.assertEqual(guard.decide(self.facts(dropin="match"), "recover"), "remove")
        self.assertEqual(guard.decide(self.facts(), "recover"), "already")

    def test_recover_does_not_claim_success_when_env_file_still_sets_it(self) -> None:
        facts = self.facts(envfile="set")
        self.assertEqual(guard.decide(facts, "recover"), "still-set")

    def test_dropin_match_is_exact(self) -> None:
        self.assertEqual(guard.classify_dropin(False, False, None), "absent")
        self.assertEqual(guard.classify_dropin(True, False, guard.DROPIN_TEXT), "match")
        self.assertEqual(guard.classify_dropin(True, False, guard.DROPIN_TEXT + "\n"), "other")
        self.assertEqual(guard.classify_dropin(True, True, guard.DROPIN_TEXT), "other")

    def test_envfile_ignores_comments(self) -> None:
        self.assertEqual(guard.classify_envfile('PORT="41641"\nFLAGS=""\n'), "unset")
        self.assertEqual(
            guard.classify_envfile("# TS_SSH_DISABLE_FORWARDING=1\nFLAGS=\n"),
            "unset",
        )
        self.assertEqual(
            guard.classify_envfile('FLAGS=""\nTS_SSH_DISABLE_FORWARDING=1\n'),
            "set",
        )


class ConfigTests(unittest.TestCase):
    def test_example_uses_a_placeholder_target(self) -> None:
        payload = json.loads((ROOT / ".hosts.example.json").read_text(encoding="utf-8"))
        target = payload["hosts"][1]["target"]
        self.assertIn("example.invalid", target)
        self.assertNotIn("tail494", SOURCE)
        self.assertNotIn("cachyos-home", SOURCE)
        self.assertNotIn("100.126.", SOURCE)

    def test_help_is_grouped(self) -> None:
        text = guard.help_text(color=False)
        self.assertIn("동작", text)
        self.assertIn("호스트", text)
        self.assertIn("안전", text)
        self.assertLess(text.index("동작"), text.index("호스트"))
        self.assertLess(text.index("호스트"), text.index("안전"))

    def test_load_rejects_a_bad_target_without_echoing_it(self) -> None:
        with self.assertRaises(guard.AppError) as caught:
            guard.load_hosts(self._write({"hosts": [{"name": "remote", "via": "ssh", "target": "bad target"}]}))
        self.assertNotIn("bad target", str(caught.exception))

    def _write(self, payload: dict) -> Path:
        path = ROOT / ".hosts.test.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.addCleanup(path.unlink, missing_ok=True)
        return path


if __name__ == "__main__":
    unittest.main()
