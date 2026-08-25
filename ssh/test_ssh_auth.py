#!/usr/bin/env python3
from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FISH_FUNCTION = HERE / "ssh-auth.fish"


def write_executable(path: Path, body: str) -> None:
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class SshAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmpdir.name)
        self.bin = self.root / "bin"
        self.runtime = self.root / "runtime"
        self.home = self.root / "home"
        self.state = self.root / "state"
        self.bin.mkdir()
        self.runtime.mkdir()
        self.state.mkdir()
        (self.home / ".ssh").mkdir(parents=True)
        (self.home / ".ssh" / "id_test").write_text("dummy-key\n")
        (self.home / ".ssh" / "config").write_text(
            "Host demo\n    IdentityFile ~/.ssh/id_test\n"
        )
        self._install_stubs()

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def _install_stubs(self) -> None:
        write_executable(
            self.bin / "ssh",
            f"""#!/bin/sh
if [ "$1" = "-G" ]; then
  printf 'identityfile %s/.ssh/id_test\\n' "{self.home}"
  exit 0
fi
printf '%s\\n' "$*" >> "{self.state}/ssh-args"
exit 0
""",
        )
        write_executable(
            self.bin / "ssh-keygen",
            """#!/bin/sh
printf '256 SHA256:dummy %s (ED25519)\\n' "$2"
exit 0
""",
        )
        write_executable(
            self.bin / "ssh-add",
            f"""#!/bin/sh
sock=${{SSH_AUTH_SOCK:-}}
if [ "$1" = "-l" ]; then
  if [ ! -S "$sock" ]; then
    exit 2
  fi
  if [ -f "{self.state}/loaded" ]; then
    printf '256 SHA256:dummy %s/.ssh/id_test (ED25519)\\n' "{self.home}"
    exit 0
  fi
  exit 1
fi
if [ ! -S "$sock" ]; then
  exit 2
fi
touch "{self.state}/loaded"
printf 'added\\n' >> "{self.state}/ssh-add"
exit 0
""",
        )
        write_executable(
            self.bin / "ssh-agent",
            f"""#!/bin/sh
sock=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -a)
      sock=$2
      shift 2
      ;;
    -c)
      shift
      ;;
    *)
      shift
      ;;
  esac
done
if [ -z "$sock" ]; then
  echo "ssh-agent stub requires -a" >&2
  exit 1
fi
python3 -c "import os, socket, sys; p=sys.argv[1];
os.path.exists(p) and os.unlink(p);
s=socket.socket(socket.AF_UNIX); s.bind(p); os.chmod(p, 0o600)" "$sock"
printf 'setenv SSH_AUTH_SOCK %s;\\n' "$sock"
printf 'setenv SSH_AGENT_PID %s;\\n' "$$"
printf 'echo Agent pid %s;\\n' "$$"
printf 'start\\n' >> "{self.state}/agent-starts"
""",
        )

    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        env["PATH"] = f"{self.bin}:{env.get('PATH', '')}"
        env["HOME"] = str(self.home)
        env["XDG_RUNTIME_DIR"] = str(self.runtime)
        env.pop("SSH_AUTH_SOCK", None)
        env.pop("SSH_AGENT_PID", None)
        return env

    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        script = f"source {FISH_FUNCTION}; ssh-auth $argv"
        return subprocess.run(
            ["fish", "-c", script, "--", *args],
            text=True,
            capture_output=True,
            env=self._env(),
        )

    def test_help_does_not_connect_by_default(self) -> None:
        result = self._run("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--connect", result.stdout)
        self.assertIn("Does not open an SSH session", result.stdout)

    def test_default_loads_key_without_ssh(self) -> None:
        result = self._run("demo")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SSH key loaded for demo.", result.stdout)
        self.assertFalse((self.state / "ssh-args").exists())
        self.assertTrue((self.state / "loaded").exists())
        self.assertEqual((self.state / "agent-starts").read_text().count("start"), 1)

    def test_key_only_alias_still_skips_ssh(self) -> None:
        result = self._run("demo", "--key-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.state / "ssh-args").exists())

    def test_connect_runs_ssh(self) -> None:
        result = self._run("--connect", "demo")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.state / "ssh-args").read_text(), "demo\n")

    def test_second_invocation_reuses_shared_agent(self) -> None:
        first = self._run("demo")
        self.assertEqual(first.returncode, 0, first.stderr)
        second = self._run("demo")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("SSH key already loaded for demo.", second.stdout)
        self.assertEqual((self.state / "agent-starts").read_text().count("start"), 1)

    def test_conflicting_flags_fail(self) -> None:
        result = self._run("demo", "--connect", "--key-only")
        self.assertEqual(result.returncode, 2)
        self.assertIn("either --connect or --key-only", result.stderr)

    def test_list_reads_config_hosts(self) -> None:
        result = self._run("list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "demo")


if __name__ == "__main__":
    unittest.main()
