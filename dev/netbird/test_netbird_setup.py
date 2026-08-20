#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from argparse import Namespace
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

SYS_DIR = Path(__file__).resolve().parent
if str(SYS_DIR) not in sys.path:
    sys.path.insert(0, str(SYS_DIR))

import netbird_setup as nb


LSBLK = {
    "blockdevices": [
        {
            "name": "nvme0n1",
            "tran": "nvme",
            "rm": False,
            "type": "disk",
            "model": "Samsung",
            "children": [
                {
                    "name": "nvme0n1p1",
                    "type": "part",
                    "mountpoint": "/boot",
                    "label": "boot",
                    "size": "1G",
                }
            ],
        },
        {
            "name": "sda",
            "tran": "usb",
            "rm": True,
            "type": "disk",
            "model": "Cruzer",
            "size": "58.6G",
            "children": [
                {
                    "name": "sda1",
                    "type": "part",
                    "mountpoints": ["/run/media/easydev/USB"],
                    "label": "USB",
                    "size": "58.6G",
                }
            ],
        },
    ]
}


class PathTests(unittest.TestCase):
    def test_keys_file_is_usb_name_in_netbird_dir(self) -> None:
        self.assertEqual(nb.KEYS_NAME, ".env.netbird.setup.keys")
        self.assertEqual(nb.KEYS_PATH, nb.SCRIPT_DIR / ".env.netbird.setup.keys")
        self.assertEqual(nb.USB_KEYS_NAME, nb.KEYS_NAME)


class NameTests(unittest.TestCase):
    def test_accepts_short_employee_name(self) -> None:
        self.assertEqual(nb.normalize_key_name("green_user_01"), "GREEN_USER_01")

    def test_strips_legacy_prefix(self) -> None:
        self.assertEqual(
            nb.normalize_key_name("NETBIRD_SETUP_KEY_GREEN_ADMIN_PC"),
            "GREEN_ADMIN_PC",
        )

    def test_rejects_reserved_and_invalid(self) -> None:
        with self.assertRaises(nb.AppError):
            nb.normalize_key_name("NETBIRD_API_KEY")
        with self.assertRaises(nb.AppError):
            nb.normalize_key_name("green-user")


class EnvTests(unittest.TestCase):
    def test_upsert_preserves_comments_and_replaces_name(self) -> None:
        original = (
            "# keep\n"
            "GREEN_USER_01=old-secret\n"
            "GREEN_ADMIN_PC=other-secret\n"
        )
        updated = nb.upsert_env(original, "GREEN_USER_01", "new-secret")
        self.assertIn("# keep", updated)
        self.assertIn("GREEN_USER_01=new-secret", updated)
        self.assertNotIn("old-secret", updated)
        self.assertIn("GREEN_ADMIN_PC=other-secret", updated)

    def test_parse_env_skips_comments(self) -> None:
        values = nb.parse_env("# c\nGREEN_USER_01=abc\nexport GREEN_ADMIN_PC='xyz'\n")
        self.assertEqual(values["GREEN_USER_01"], "abc")
        self.assertEqual(values["GREEN_ADMIN_PC"], "xyz")


class UsbParseTests(unittest.TestCase):
    def test_parse_lsblk_keeps_mounted_usb_only(self) -> None:
        volumes = nb.parse_lsblk(LSBLK)
        self.assertEqual(len(volumes), 1)
        self.assertEqual(volumes[0].mountpoint, Path("/run/media/easydev/USB"))
        self.assertEqual(volumes[0].label, "USB")
        self.assertEqual(volumes[0].model, "Cruzer")


class KeyClassifyTests(unittest.TestCase):
    def test_arrows_and_vim_keys(self) -> None:
        self.assertEqual(nb.classify_key(b"j"), "DOWN")
        self.assertEqual(nb.classify_key(b"k"), "UP")
        self.assertEqual(nb.classify_key(b"g"), "FIRST")
        self.assertEqual(nb.classify_key(b"G"), "LAST")
        self.assertEqual(nb.classify_key(b"\x1b", b"[A"), "UP")
        self.assertEqual(nb.classify_key(b"\x1b", b"[B"), "DOWN")
        self.assertEqual(nb.classify_key(b"\x1b", b"[H"), "FIRST")
        self.assertEqual(nb.classify_key(b"\x1b", b"[F"), "LAST")
        self.assertEqual(nb.classify_key(b"\r"), "ENTER")
        self.assertEqual(nb.classify_key(b"q"), "QUIT")
        self.assertEqual(nb.classify_key(b"\x03"), "QUIT")
        self.assertEqual(nb.classify_key(b"\x1b"), "QUIT")


class WindowsScriptTests(unittest.TestCase):
    def test_ps1_is_interactive_and_reads_bundled_env(self) -> None:
        script = nb.render_windows_ps1()
        self.assertIn(".env.netbird.setup.keys", script)
        self.assertIn("param(", script)
        self.assertIn("$DryRun", script)
        self.assertIn("[Console]::ReadKey", script)
        self.assertIn("msiexec.exe", script)
        self.assertIn("winget", script)
        self.assertIn("netbird up", script)
        self.assertIn("--setup-key", script)
        self.assertIn("Disable-UsedSetupKey", script)
        self.assertIn("already used", script)
        self.assertIn("0x0336", script)
        self.assertNotIn("GREEN_HOME_PC=", script)

    def test_cmd_launcher_calls_ps1(self) -> None:
        script = nb.render_windows_cmd()
        self.assertIn("install-netbird.ps1", script)
        self.assertIn("@echo off", script)


class CommandTests(unittest.TestCase):
    def test_issue_saves_key_without_printing_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            keys = root / ".env.netbird.setup-keys"
            config = nb.Config(
                api_key="pat",
                management_url=nb.DEFAULT_MANAGEMENT_URL,
                auto_group="employees",
                config_path=root / ".env.netbird",
                keys_path=keys,
            )
            stdout = io.StringIO()
            stderr = io.StringIO()
            args = Namespace(name="green_user_01", replace=False)
            code = nb.cmd_issue(
                args,
                config=config,
                create=lambda _config, name: f"secret-for-{name}",
                stdin=io.StringIO(),
                stdout=stdout,
                stderr=stderr,
            )
            self.assertEqual(code, 0)
            text = keys.read_text()
            self.assertIn("GREEN_USER_01=secret-for-GREEN_USER_01", text)
            self.assertIn("# auto-group: employees", text)
            self.assertIn(
                "#   netbird up --management-url "
                f"{nb.DEFAULT_MANAGEMENT_URL} --setup-key <KEY>",
                text,
            )
            self.assertIn("#   1. Change Server", text)
            self.assertIn("#   3. Add this device with a setup key", text)
            self.assertNotIn("secret-for-GREEN_USER_01", text.split("GREEN_USER_01=", 1)[0])
            self.assertNotIn("secret-for-GREEN_USER_01", stdout.getvalue())
            self.assertIn("issued GREEN_USER_01", stdout.getvalue())

    def test_issue_requires_replace_without_tty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            keys = root / ".env.netbird.setup-keys"
            keys.write_text("GREEN_USER_01=already\n")
            config = nb.Config(
                api_key="pat",
                management_url=nb.DEFAULT_MANAGEMENT_URL,
                auto_group="employees",
                config_path=root / ".env.netbird",
                keys_path=keys,
            )
            args = Namespace(name="GREEN_USER_01", replace=False)
            with self.assertRaises(nb.AppError):
                nb.cmd_issue(
                    args,
                    config=config,
                    create=lambda *_: "unused",
                    stdin=io.StringIO(),
                    stdout=io.StringIO(),
                    stderr=io.StringIO(),
                )

    def test_usb_writes_script_to_dest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            keys = root / ".env.netbird.setup-keys"
            dest = root / "usb"
            dest.mkdir()
            keys.write_text("GREEN_USER_01=usb-secret-key\n")
            config = nb.Config(
                api_key="",
                management_url=nb.DEFAULT_MANAGEMENT_URL,
                auto_group="employees",
                config_path=root / ".env.netbird",
                keys_path=keys,
            )
            stdout = io.StringIO()
            args = Namespace(dest=str(dest))
            code = nb.cmd_usb(
                args,
                config=config,
                stdin=io.StringIO(),
                stdout=stdout,
                stderr=io.StringIO(),
                ensure=lambda _dest: None,
            )
            self.assertEqual(code, 0)
            payload = dest / "netbird-setup"
            env_file = payload / ".env.netbird.setup.keys"
            ps1 = payload / "install-netbird.ps1"
            cmd = payload / "install-netbird.cmd"
            readme = payload / "README.md"
            self.assertTrue(env_file.is_file())
            self.assertTrue(ps1.is_file())
            self.assertTrue(cmd.is_file())
            self.assertTrue(readme.is_file())
            self.assertIn("usb-secret-key", env_file.read_text())
            self.assertNotIn("usb-secret-key", ps1.read_text())
            self.assertNotIn("usb-secret-key", stdout.getvalue())

    def test_usb_non_tty_requires_dest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            keys = root / ".env.netbird.setup-keys"
            keys.write_text("GREEN_USER_01=usb-secret-key\n")
            config = nb.Config(
                api_key="",
                management_url=nb.DEFAULT_MANAGEMENT_URL,
                auto_group="employees",
                config_path=root / ".env.netbird",
                keys_path=keys,
            )
            args = Namespace(dest=None)
            with self.assertRaises(nb.AppError):
                nb.cmd_usb(
                    args,
                    config=config,
                    stdin=io.StringIO(),
                    stdout=io.StringIO(),
                    stderr=io.StringIO(),
                    ensure=lambda _dest: None,
                )

    def test_list_prints_names_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            keys = Path(tmp) / ".env.netbird.setup-keys"
            keys.write_text("GREEN_USER_01=hidden-secret\nGREEN_ADMIN_PC=other\n")
            stdout = io.StringIO()
            code = nb.cmd_list(Namespace(), keys_path=keys, stdout=stdout)
            self.assertEqual(code, 0)
            self.assertEqual(stdout.getvalue(), "GREEN_USER_01\nGREEN_ADMIN_PC\n")
            self.assertNotIn("hidden-secret", stdout.getvalue())

    def test_main_help_and_missing_command(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with self.assertRaises(SystemExit) as exited, redirect_stdout(stdout):
            nb.main(["--help"])
        self.assertEqual(exited.exception.code, 0)
        with redirect_stderr(stderr):
            self.assertEqual(nb.main([]), 2)

    def test_load_config_requires_pat_only_for_issue(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / ".env.netbird"
            keys_path = Path(tmp) / ".env.netbird.setup-keys"
            empty = {"PATH": "/usr/bin"}
            with self.assertRaises(nb.AppError):
                nb.load_config(
                    environ=empty,
                    config_path=config_path,
                    keys_path=keys_path,
                )
            loaded = nb.load_config(
                environ=empty,
                config_path=config_path,
                keys_path=keys_path,
                require_api_key=False,
            )
            self.assertEqual(loaded.management_url, nb.DEFAULT_MANAGEMENT_URL)
            self.assertEqual(loaded.auto_group, "employees")


class CreateKeyTests(unittest.TestCase):
    def test_posts_one_off_employee_key(self) -> None:
        calls: list[tuple[str, str, dict | None]] = []

        def request(_url: str, _token: str, method: str, path: str, body=None):
            calls.append((method, path, body))
            if path.startswith("/api/groups"):
                return [{"id": "grp1", "name": "employees"}]
            assert body is not None
            return {"key": "minted-secret", "name": body["name"]}

        config = nb.Config(
            api_key="pat",
            management_url=nb.DEFAULT_MANAGEMENT_URL,
            auto_group="employees",
            config_path=Path("/tmp/.env.netbird"),
            keys_path=Path("/tmp/.env.netbird.setup-keys"),
        )
        key = nb.create_setup_key(config, "GREEN_USER_01", request=request)
        self.assertEqual(key, "minted-secret")
        self.assertEqual(calls[0][0], "GET")
        self.assertEqual(calls[1][0], "POST")
        self.assertEqual(calls[1][1], "/api/setup-keys")
        posted = calls[1][2]
        assert posted is not None
        self.assertEqual(posted["type"], "one-off")
        self.assertEqual(posted["usage_limit"], 1)
        self.assertEqual(posted["expires_in"], 604800)
        self.assertEqual(posted["auto_groups"], ["grp1"])


class EmployeeRosterTests(unittest.TestCase):
    def test_roster_has_eight_waiting_keys(self) -> None:
        path = (
            Path(__file__).resolve().parents[1]
            / "init-debian-vps"
            / "profiles"
            / "ovh-vps.employees.example.json"
        )
        names, keys_path = nb.load_employee_roster(path)
        self.assertEqual(len(names), 8)
        self.assertIn("EXAMPLE_ADMIN_PC", names)
        self.assertIn("EXAMPLE_MANAGER_01_PHONE", names)
        self.assertEqual(keys_path, nb.KEYS_PATH)
        self.assertEqual(keys_path.name, ".env.netbird.setup.keys")
        raw = path.read_text()
        self.assertIn("604800", raw)
        self.assertNotIn("100.", raw)

    def test_employees_mints_missing_only(self) -> None:
        import argparse
        import tempfile

        created: list[str] = []

        def create(config: nb.Config, name: str) -> str:
            created.append(name)
            return f"secret-{name}"

        roster = {
            "keys_path": "netbird-employees.env",
            "people": [
                {"email": "a@example.com", "pc": "GREEN_A_PC", "phone": "GREEN_A_PHONE"}
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            roster_path = Path(tmp) / "roster.json"
            roster_path.write_text(json.dumps(roster))
            # patch SCRIPT_DIR so keys land in tmp? load uses SCRIPT_DIR.
            # Write existing env into SCRIPT_DIR would pollute. Use absolute keys_path.
            keys_path = Path(tmp) / "netbird-employees.env"
            roster["keys_path"] = str(keys_path)
            roster_path.write_text(json.dumps(roster))
            keys_path.write_text("GREEN_A_PC=already\n")
            args = argparse.Namespace(roster=str(roster_path), auto_group="", apply=True)
            config = nb.Config(
                api_key="pat",
                management_url=nb.DEFAULT_MANAGEMENT_URL,
                auto_group="employees",
                config_path=Path(tmp) / ".env.netbird",
                keys_path=keys_path,
            )
            rc = nb.cmd_employees(args, config=config, create=create)
            self.assertEqual(rc, 0)
            self.assertEqual(created, ["GREEN_A_PHONE"])
            stored = nb.load_env_file(keys_path)
            self.assertEqual(stored["GREEN_A_PC"], "already")
            self.assertEqual(stored["GREEN_A_PHONE"], "secret-GREEN_A_PHONE")


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent)
    unittest.main()
