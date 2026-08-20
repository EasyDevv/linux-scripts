#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from contextlib import contextmanager
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load():
    spec = importlib.util.spec_from_file_location("init_vps", HERE / "init-vps.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


mod = load()


@contextmanager
def example_profile():
    with tempfile.TemporaryDirectory() as tmp:
        profile_dir = Path(tmp) / "profiles"
        profile_dir.mkdir()
        for source in sorted((HERE / "profiles").glob("*.example.json")):
            runtime_name = source.name.replace(".example.json", ".json")
            target = profile_dir / runtime_name
            target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        original = mod.SCRIPT_DIR
        setattr(mod, "SCRIPT_DIR", Path(tmp))
        try:
            yield mod.load_profile("ovh-vps")
        finally:
            setattr(mod, "SCRIPT_DIR", original)


class SshControlTests(unittest.TestCase):
    def test_control_options_use_private_runtime_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            options = mod.ssh_control_options({"XDG_RUNTIME_DIR": tmp})
            control_dir = Path(tmp) / "easydev-ssh-control"
            self.assertTrue(control_dir.is_dir())
            self.assertEqual(control_dir.stat().st_mode & 0o777, 0o700)
            self.assertIn("ControlMaster=auto", options)
            self.assertIn("ControlPersist=120", options)
            self.assertIn(f"ControlPath={control_dir}/%C", options)


class ClassifyTests(unittest.TestCase):
    def test_passphrase(self) -> None:
        self.assertEqual(
            mod.classify_ssh_error("incorrect passphrase supplied to decrypt private key"),
            "passphrase",
        )

    def test_hostkey(self) -> None:
        self.assertEqual(
            mod.classify_ssh_error("REMOTE HOST IDENTIFICATION HAS CHANGED"),
            "hostkey",
        )

    def test_publickey(self) -> None:
        self.assertEqual(
            mod.classify_ssh_error("Permission denied (publickey)."),
            "publickey",
        )

    def test_unreachable(self) -> None:
        self.assertEqual(mod.classify_ssh_error("Connection refused"), "unreachable")


class HostnameTests(unittest.TestCase):
    SOURCE = """Host ovh-vps
    HostName 100.64.0.10
    User debian
    IdentityFile ~/.ssh/example_vps

Host ovh-vps-nb
    HostName 100.64.0.10
"""

    def test_replace_overlay(self) -> None:
        updated, action = mod.ensure_public_hostname(
            self.SOURCE, "ovh-vps", "203.0.113.10"
        )
        self.assertEqual(action, "replace")
        self.assertIn("HostName 203.0.113.10", updated)
        self.assertIn("Host ovh-vps-nb\n    HostName 100.64.0.10", updated)

    def test_noop(self) -> None:
        text = self.SOURCE.replace("100.64.0.10", "203.0.113.10", 1)
        updated, action = mod.ensure_public_hostname(text, "ovh-vps", "203.0.113.10")
        self.assertEqual(action, "noop")
        self.assertEqual(updated, text)

    def test_insert_missing(self) -> None:
        text = "Host ovh-vps\n    User debian\n"
        updated, action = mod.ensure_public_hostname(text, "ovh-vps", "203.0.113.10")
        self.assertEqual(action, "replace")
        self.assertIn("HostName 203.0.113.10", updated)


class StateTests(unittest.TestCase):
    def test_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            original = mod.SCRIPT_DIR
            setattr(mod, "SCRIPT_DIR", Path(tmp))
            try:
                state = mod.State(profile="ovh-vps", target="ovh-vps")
                mod.mark_done(state, "preflight")
                loaded = mod.load_state("ovh-vps", "ovh-vps")
                self.assertEqual(loaded.completed, ["preflight"])
                mod.mark_failed(loaded, "bootstrap", "ssh failed")
                again = mod.load_state("ovh-vps", "ovh-vps")
                self.assertEqual(again.failed_stage, "bootstrap")
            finally:
                setattr(mod, "SCRIPT_DIR", original)

    def test_profile_access_spec(self) -> None:
        with example_profile() as profile:
            self.assertIsNotNone(profile.access_spec)
            assert profile.access_spec is not None
            self.assertTrue(profile.access_spec.is_file())
            spec = json.loads(profile.access_spec.read_text())
            names = [policy["name"] for policy in spec["policies"]]
            self.assertIn("employees-to-app", names)
            self.assertIn("app-to-image", names)
            self.assertIn("dev-to-vps-dashboard", names)
            self.assertNotIn("dev-all-access", names)
            self.assertNotIn("employees-to-image", names)
            dashboard = next(p for p in spec["policies"] if p["name"] == "dev-to-vps-dashboard")
            self.assertEqual(dashboard["ports"], ["80", "443"])
            self.assertEqual(dashboard["destination_group"], "app-servers")
            for policy in spec["policies"]:
                self.assertNotEqual(policy.get("protocol"), "all")
                self.assertNotEqual(policy.get("destination_group"), "All")
            self.assertIn("dev-all-access", spec["disable_policy_names"])
            self.assertNotIn("100.", profile.access_spec.read_text())
            self.assertEqual(profile.image_target, "image-host")
            self.assertEqual(profile.image_group, "image-servers")
            self.assertIsNotNone(profile.employee_roster)
            assert profile.employee_roster is not None
            self.assertTrue(profile.employee_roster.is_file())
            roster = json.loads(profile.employee_roster.read_text())
            self.assertEqual(roster["keys_path"], ".env.netbird.setup.keys")

    def test_from_skips_completed_prefix(self) -> None:
        self.assertEqual(mod.next_stage(["preflight", "ssh_agent"], "bootstrap"), "bootstrap")
        self.assertEqual(mod.next_stage(list(mod.STAGE_IDS), None), None)

    def test_pending_skips_completed(self) -> None:
        pending = mod.pending_stages(["preflight", "reinstall"])
        self.assertEqual(pending[0], "public_hostname")
        self.assertNotIn("preflight", pending)

    def test_pending_retries_failed_only(self) -> None:
        ids = list(mod.STAGE_IDS)
        done = ids[: ids.index("host_join") + 1]
        pending = mod.pending_stages(done, failed_stage="verify_control_plane")
        self.assertEqual(pending[0], "verify_control_plane")
        self.assertNotIn("reboot", pending)
        self.assertIn("early_warning", pending)

    def test_reinstall_before_ssh_login(self) -> None:
        ids = list(mod.STAGE_IDS)
        self.assertLess(ids.index("reinstall"), ids.index("wait_sshd"))
        self.assertLess(ids.index("reinstall"), ids.index("public_ssh"))
        self.assertLess(ids.index("public_hostname"), ids.index("wait_sshd"))
        self.assertEqual(mod.SECTIONS["reinstall"], "OVH")
        self.assertLess(ids.index("operator_up"), ids.index("host_join"))
        self.assertLess(ids.index("host_join"), ids.index("image_join"))
        self.assertLess(ids.index("image_join"), ids.index("employee_keys"))
        self.assertLess(ids.index("employee_keys"), ids.index("early_warning"))

    def test_management_url_strips_443(self) -> None:
        self.assertEqual(
            mod.normalize_management_url("https://vps.example.invalid:443"),
            "https://vps.example.invalid",
        )
        self.assertTrue(mod.SPIN_FRAMES)


class BootstrapTests(unittest.TestCase):
    def test_install_chowns_log_after_validate(self) -> None:
        text = (HERE / "early-warning" / "install.sh").read_text()
        validate = text.index("caddy validate --config")
        chown = text.index("chown -R caddy:caddy /var/log/caddy", validate)
        restart = text.index("systemctl restart caddy", chown)
        self.assertLess(validate, chown)
        self.assertLess(chown, restart)
        self.assertIn('progress() { printf', text)
        self.assertIn("import /etc/caddy/overlay.caddy", text)
        self.assertIn("vps-caddy-overlay", text)
        overlay = (HERE / "early-warning" / "files" / "vps-caddy-overlay").read_text()
        self.assertIn("dashboardRedirectURIs", overlay)
        self.assertIn("/nb-auth", overlay)
        self.assertNotIn("bind __WT0__", overlay)
        self.assertIn("remote_ip 100.64.0.0/10 fd00::/8", overlay)

    def test_bootstrap_packages(self) -> None:
        text = (HERE / "bootstrap-debian.sh").read_text()
        self.assertIn("apt-get install -y caddy podman", text)
        self.assertNotIn("jail.local", text)
        self.assertNotIn('iifname "wt0"', text)
        self.assertIn("meta nfproto ipv4 tcp dport 22", text)
        self.assertNotIn("tcp dport { 22, 80, 443 }", text)
        self.assertIn("early_warning", mod.STAGE_IDS)


class SenderTests(unittest.TestCase):
    def test_sender_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sender.env"
            path.write_text("DISCORD_OVH_VPS_WEBHOOK=\n")
            self.assertFalse(mod.sender_present(path))
            path.write_text("DISCORD_OVH_VPS_WEBHOOK=https://example.invalid/hook\n")
            self.assertTrue(mod.sender_present(path))
            path.write_text("AGENTMAIL_API_KEY=am_test\n")
            self.assertFalse(mod.sender_present(path))

    def test_resolve_explicit_missing(self) -> None:
        with example_profile() as profile:
            self.assertIsNone(mod.resolve_sender_env(profile, Path("/no/such/file.env")))
            self.assertTrue(profile.sender_env_candidates)

    def test_normalize_renames_discord_key(self) -> None:
        spec = importlib.util.spec_from_file_location(
            "copy_sender", HERE / "early-warning" / "copy-sender.py"
        )
        assert spec and spec.loader
        sender = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sender)
        out = sender.normalize_sender(
            {
                "AGENTMAIL_API_KEY": "am_test",
                "DISCORD_OVH_VPS_WEBHOOK": "https://example.invalid/hook",
            }
        )
        self.assertEqual(out, {"DISCORD_WEBHOOK": "https://example.invalid/hook"})
        self.assertTrue(sender.has_channel(out))
        rendered = sender.render_env(out).decode()
        self.assertNotIn("AGENTMAIL", rendered)
        self.assertEqual(rendered, "DISCORD_WEBHOOK=https://example.invalid/hook\n")


class ProfileTests(unittest.TestCase):
    def test_ovh_defaults(self) -> None:
        with example_profile() as profile:
            self.assertEqual(profile.target, "ovh-vps")
            self.assertEqual(profile.ovh_cli_profile, "owner-offline")
            self.assertTrue(profile.early_warning)
            self.assertEqual(set(mod.STAGE_IDS), set(mod.STAGES))
            self.assertEqual(set(mod.STAGE_IDS), set(mod.SECTIONS))


class AgentEnvTests(unittest.TestCase):
    def test_parse_agent_env(self) -> None:
        text = "SSH_AUTH_SOCK=/tmp/ssh-abc/agent.1; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=123; export SSH_AGENT_PID;\n"
        env = mod.parse_agent_env(text)
        self.assertEqual(env["SSH_AUTH_SOCK"], "/tmp/ssh-abc/agent.1")
        self.assertEqual(env["SSH_AGENT_PID"], "123")


class SshGTests(unittest.TestCase):
    def test_parse(self) -> None:
        values = mod.parse_ssh_g("hostname 203.0.113.10\nuser debian\nidentityfile /tmp/id\n")
        self.assertEqual(values["hostname"], "203.0.113.10")
        self.assertEqual(values["user"], "debian")


class FailDetailTests(unittest.TestCase):
    def test_skips_caddy_valid(self) -> None:
        blob = "caddyfile_dashboard_wt0\nValid configuration\n"
        self.assertEqual(
            mod.fail_detail(blob, "command failed: apply.sh"),
            "command failed: apply.sh",
        )

    def test_prefers_permission_denied(self) -> None:
        blob = "Valid configuration\nopen /var/log/caddy/access.log: permission denied\n"
        self.assertIn("permission denied", mod.fail_detail(blob, "fallback"))


class ParallelTests(unittest.TestCase):
    def test_run_parallel_ok(self) -> None:
        out = mod.run_parallel(
            [("a", lambda: 1), ("b", lambda: 2)],
        )
        self.assertEqual(out["a"], 1)
        self.assertEqual(out["b"], 2)

    def test_run_parallel_collects_errors(self) -> None:
        def boom() -> None:
            raise mod.Fail("nope")

        with self.assertRaises(mod.Fail) as ctx:
            mod.run_parallel([("a", boom), ("b", lambda: 1)])
        self.assertIn("a:", str(ctx.exception))

    def test_early_warning_alias_are_peers(self) -> None:
        self.assertEqual(
            mod.parallel_peers("early_warning", None),
            ("early_warning", "overlay_alias"),
        )
        self.assertEqual(
            mod.parallel_peers("overlay_alias", "overlay_alias"),
            ("overlay_alias",),
        )


class ReportTests(unittest.TestCase):
    def _facts(self, **overrides):
        probe = mod.probe_request()
        facts = {
            "paths": {path: True for path in probe["paths"]},
            "units": {name: True for name in probe["units"]},
            "listens": {addr: True for addr in probe["listens"]},
            "nft_drop": True,
            "wt0_ip": "100.92.232.44",
            "public_ip": "203.0.113.10",
            "caddy_dir": "750 root:caddy",
        }
        facts.update(overrides)
        return facts

    def test_pass_has_roles_and_paths(self) -> None:
        text = mod.render_report(
            {
                "target": "ovh-vps",
                "generated": "2026-08-20T00:00:00Z",
                "domain": "vps.example.invalid",
                "early_warning": True,
                "overlay_ip": "100.92.232.44",
            },
            self._facts(),
        )
        self.assertIn("결과 **PASS**", text)
        self.assertIn("## CrowdSec", text)
        self.assertIn("## Falco", text)
        self.assertIn("역할", text)
        self.assertIn("wt0 전체 accept는 넣지 않는다", text)
        self.assertIn("passthrough", text)
        self.assertNotIn("wt0는 사내망이라 통과", text)
        self.assertIn("추가된 경로", text)
        self.assertIn("/usr/local/sbin/vps-crowdsec-nft-drop", text)
        self.assertIn("/etc/falco/config.d/vps-early-warning.yaml", text)
        self.assertIn("앱 미배포", text)
        self.assertNotIn("discord.com/api/webhooks", text)
        self.assertNotIn("CADDY_CROWDSEC_KEY=", text)

    def test_fail_when_crowdsec_down(self) -> None:
        facts = self._facts()
        facts["units"] = dict(facts["units"])
        facts["units"]["crowdsec"] = False
        text = mod.render_report(
            {
                "target": "ovh-vps",
                "generated": "2026-08-20T00:00:00Z",
                "domain": "vps.example.invalid",
                "early_warning": True,
            },
            facts,
        )
        self.assertIn("결과 **FAIL**", text)
        self.assertIn("| CrowdSec | missing |", text)


if __name__ == "__main__":
    unittest.main()
