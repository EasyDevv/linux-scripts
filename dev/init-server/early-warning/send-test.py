#!/usr/bin/env python3
"""Run labelled Discord alert scenarios on the workstation.

Does not SSH, install, or print webhook secrets.
Default is dry-run. Pass --send to POST using a local sender env.
"""
from __future__ import annotations

import argparse
from importlib.machinery import SourceFileLoader
import importlib.util
from pathlib import Path
import sys
import tempfile
import time
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent
ALERT_PATH = ROOT / "files" / "vps-alert"
DEFAULT_ENV = Path.home() / ".local/share/scripts/dev/.env.sender"
HOST_LABEL = "vps-alert-test"


class Scenario(NamedTuple):
    id: str
    event: str
    severity: str
    outcome: str
    body: str
    expect_notify: bool
    expect_ping: bool


SCENARIOS = (
    Scenario(
        "X0",
        "routine",
        "info",
        "success",
        "[TEST X0] routine INFO must drop",
        False,
        False,
    ),
    Scenario(
        "F0",
        "falco",
        "warning",
        "detected",
        "[TEST F0] Falco WARNING must drop",
        False,
        False,
    ),
    Scenario(
        "N1",
        "crowdsec-decision",
        "notice",
        "ban-or-decision",
        "[TEST N1] CrowdSec NOTICE must notify without ping",
        True,
        False,
    ),
    Scenario(
        "S1",
        "ssh-login",
        "info",
        "success",
        "[TEST S1] SSH login INFO must notify without ping",
        True,
        False,
    ),
    Scenario(
        "E1",
        "ssh-unauthorized-login",
        "critical",
        "success",
        "[TEST E1] Unauthorized SSH must ping",
        True,
        True,
    ),
    Scenario(
        "F1",
        "falco",
        "error",
        "detected",
        "[TEST F1] Falco ERROR must ping",
        True,
        True,
    ),
    Scenario(
        "B1",
        "ssh-deny-burst",
        "error",
        "detected",
        "[TEST B1] SSH denial burst must ping",
        True,
        True,
    ),
)


def load_alert():
    loader = SourceFileLoader("vps_alert_send_test", str(ALERT_PATH))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def isolate(alert, env_path: Path, state: Path) -> None:
    alert.ENV_FILE = env_path
    alert.LEGACY_ENVS = ()
    alert.STATE_DIR = state
    alert.STATE_FILE = state / "throttle.json"
    alert.LOCK_FILE = state / "throttle.lock"
    alert.HOST = HOST_LABEL


def evaluate(alert, scenario: Scenario) -> tuple[bool, bool]:
    notify = alert.should_notify(scenario.event, scenario.severity)
    ping = notify and alert.should_ping(scenario.severity)
    return notify, ping


def report(scenario: Scenario, notify: bool, ping: bool) -> bool:
    ok = notify == scenario.expect_notify and ping == scenario.expect_ping
    print(
        f"{scenario.id} notify={notify} ping={ping} "
        f"expect_notify={scenario.expect_notify} expect_ping={scenario.expect_ping} "
        f"ok={ok}"
    )
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--send", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args(argv)

    if args.list:
        for scenario in SCENARIOS:
            print(
                f"{scenario.id}\t{scenario.event}\t{scenario.severity}\t"
                f"notify={scenario.expect_notify}\tping={scenario.expect_ping}"
            )
        return 0

    alert = load_alert()
    failed = False
    for scenario in SCENARIOS:
        notify, ping = evaluate(alert, scenario)
        if not report(scenario, notify, ping):
            failed = True
    if failed:
        return 1
    if not args.send:
        return 0

    env_path = args.env.expanduser()
    if not env_path.is_file():
        print(f"missing sender env: {env_path}", file=sys.stderr)
        return 1
    state = Path(tempfile.mkdtemp(prefix="vps-alert-send-test-"))
    isolate(alert, env_path, state)
    cfg = alert.load_config()
    print("mention_configured", bool(cfg.get("DISCORD_MENTION")))
    for scenario in SCENARIOS:
        if not scenario.expect_notify:
            continue
        payload = alert.build_discord_payload(
            scenario.event, scenario.severity, scenario.outcome, scenario.body
        )
        content, mentions = alert.ping_mention(cfg, scenario.severity)
        if content:
            payload["content"] = content
        payload["allowed_mentions"] = mentions
        if not alert.send_discord(cfg, payload):
            print(f"{scenario.id} SEND_FAIL", file=sys.stderr)
            return 1
        print(f"{scenario.id} sent")
        time.sleep(0.4)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
