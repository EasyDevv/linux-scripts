#!/usr/bin/env python3
from __future__ import annotations

import io
from subprocess import CompletedProcess

import phone as phone_mod
from phone import Phone, keyguard_showing, mdns_hosts, node_lines, pick_serial, rec_remote_cmd, sheet_plan


def test_mdns_hosts_reads_ip_port() -> None:
	text = "adb-R3KL607VJPL-vyVBKX\t_adb-tls-connect._tcp\t192.168.0.29:42705\n"
	assert mdns_hosts(text) == ["192.168.0.29:42705"]


def test_pick_serial_prefers_sm_s947n_ip_port() -> None:
	mdns = "adb-R3KL607VJPL-vyVBKX\t_adb-tls-connect._tcp\t192.168.0.29:42705\n"
	devices = (
		"List of devices attached\n"
		"192.168.0.29:42705     device product:m2sksx model:SM_S947N\n"
		"adb-R3KL607VJPL-vyVBKX._adb-tls-connect._tcp device\n"
	)
	models = {"192.168.0.29:42705": "SM-S947N\n", "adb-R3KL607VJPL-vyVBKX._adb-tls-connect._tcp": "SM-S947N\n"}
	assert pick_serial(mdns, devices, lambda s: models[s]) == "192.168.0.29:42705"


def test_pick_serial_skips_other_models() -> None:
	mdns = "other\t_adb-tls-connect._tcp\t10.0.0.8:5555\n"
	devices = "10.0.0.8:5555 device\n"
	assert pick_serial(mdns, devices, lambda _s: "Pixel 8") is None


def test_keyguard_false() -> None:
	assert keyguard_showing("isKeyguardShowing=false") is False
	assert keyguard_showing("isKeyguardShowing=true") is True


def test_help_lists_groups() -> None:
	buf = io.StringIO()
	old = phone_mod.sys.stdout
	phone_mod.sys.stdout = buf
	try:
		code = phone_mod.main(["--help"], phone=Phone(run=lambda _a: CompletedProcess([], 0, "", "")))
	finally:
		phone_mod.sys.stdout = old
	text = buf.getvalue()
	assert code == 0
	assert "Screen" in text
	assert "awake" in text
	assert "start" in text
	assert "PIN" in text
	assert "rec" in text
	assert "Debug" in text
	assert "sheet" in text
	assert "--text" in text


def test_serial_command_prints_only_serial() -> None:
	def run(args: list[str]) -> CompletedProcess[str]:
		joined = " ".join(args)
		if "mdns" in joined:
			return CompletedProcess(args, 0, "x\t_adb-tls-connect._tcp\t192.168.0.29:42705\n", "")
		if "devices" in joined:
			return CompletedProcess(args, 0, "192.168.0.29:42705 device\n", "")
		if "getprop" in joined:
			return CompletedProcess(args, 0, "SM-S947N\n", "")
		return CompletedProcess(args, 1, "", f"unhandled {joined}")

	buf = io.StringIO()
	old = phone_mod.sys.stdout
	phone_mod.sys.stdout = buf
	try:
		code = phone_mod.main(["serial"], phone=Phone(run=run))
	finally:
		phone_mod.sys.stdout = old
	assert code == 0
	assert buf.getvalue().strip() == "192.168.0.29:42705"


def test_run_uses_data_uri_not_es_path() -> None:
	seen: list[list[str]] = []

	def run(args: list[str]) -> CompletedProcess[str]:
		seen.append(args)
		joined = " ".join(args)
		if "mdns" in joined:
			return CompletedProcess(args, 0, "x\t_adb-tls-connect._tcp\t192.168.0.29:42705\n", "")
		if "devices" in joined:
			return CompletedProcess(args, 0, "192.168.0.29:42705 device\n", "")
		if "getprop" in joined:
			return CompletedProcess(args, 0, "SM-S947N\n", "")
		return CompletedProcess(args, 0, "Starting: Intent\n", "")

	buf = io.StringIO()
	old = phone_mod.sys.stdout
	phone_mod.sys.stdout = buf
	try:
		code = phone_mod.main(["run", "run-batch.js"], phone=Phone(run=run))
	finally:
		phone_mod.sys.stdout = old
	assert code == 0
	am = [row for row in seen if "am" in row]
	assert am
	assert "-d" in am[0]
	assert "file:///sdcard/Scripts/run-batch.js" in am[0]
	assert "--es" not in am[0]


def _ok_serial(args: list[str]) -> CompletedProcess[str] | None:
	joined = " ".join(args)
	if "mdns" in joined:
		return CompletedProcess(args, 0, "x\t_adb-tls-connect._tcp\t192.168.0.29:42705\n", "")
	if "devices" in joined:
		return CompletedProcess(args, 0, "192.168.0.29:42705 device\n", "")
	if "getprop" in joined:
		return CompletedProcess(args, 0, "SM-S947N\n", "")
	return None


class _Proc:
	def wait(self, timeout=None):
		return 0

	def poll(self):
		return 0

	def kill(self) -> None:
		return None


def test_rec_cmd_is_time_limited_screenrecord() -> None:
	cmd = rec_remote_cmd(999)
	assert cmd[1] == "screenrecord"
	assert "--time-limit" in cmd
	assert cmd[cmd.index("--time-limit") + 1] == "180"
	assert cmd[-1] == "/sdcard/phone-rec.mp4"


def test_run_rec_records_then_starts_autox() -> None:
	seen: list[list[str]] = []
	spawned: list[list[str]] = []

	def run(args: list[str]) -> CompletedProcess[str]:
		seen.append(args)
		hit = _ok_serial(args)
		if hit:
			return hit
		return CompletedProcess(args, 0, "ok\n", "")

	def spawn(cmd: list[str]) -> _Proc:
		spawned.append(cmd)
		return _Proc()

	buf = io.StringIO()
	old = phone_mod.sys.stdout
	phone_mod.sys.stdout = buf
	try:
		code = phone_mod.main(
			["run", "run-batch.js", "--rec", "debug.mp4", "--seconds", "12"],
			phone=Phone(run=run, spawn=spawn),
		)
	finally:
		phone_mod.sys.stdout = old
	assert code == 0
	assert spawned
	assert "screenrecord" in spawned[0]
	assert "12" in spawned[0]
	am_at = next(i for i, row in enumerate(seen) if "am" in row)
	pull_at = next(i for i, row in enumerate(seen) if "pull" in row)
	assert am_at < pull_at
	assert "debug.mp4" in buf.getvalue()


def test_node_lines_keeps_labels_only() -> None:
	xml = (
		'<node text="" content-desc="" bounds="[0,0][1,1]" />'
		'<node text="판매중" content-desc="판매중 30" bounds="[45,314][299,427]" />'
		'<node text="" content-desc="더보기" bounds="[935,1010][991,1066]" />'
	)
	assert node_lines(xml) == (
		"판매중\t판매중 30\t[45,314][299,427]\n"
		"\t더보기\t[935,1010][991,1066]\n"
	)


def test_sheet_plan_caps_frames_and_does_not_name_a_tap() -> None:
	vf, step, frames = sheet_plan(120, 2)
	assert frames == 40
	assert step == 3
	assert "tile=5x8" in vf
	assert "tap" not in vf
	short, step2, n = sheet_plan(5, 2)
	assert n == 2
	assert step2 == 2
	assert "tile=5x1" in short


def test_sheet_missing_file() -> None:
	buf = io.StringIO()
	old = phone_mod.sys.stderr
	phone_mod.sys.stderr = buf
	try:
		code = phone_mod.main(["sheet", "/tmp/phone-sheet-missing.mp4"], phone=Phone())
	finally:
		phone_mod.sys.stderr = old
	assert code == 1
	assert "없어요" in buf.getvalue()


if __name__ == "__main__":
	failed = 0
	for name, fn in list(globals().items()):
		if name.startswith("test_") and callable(fn):
			try:
				fn()
				print("ok", name)
			except Exception as exc:
				failed += 1
				print("FAIL", name, exc)
	raise SystemExit(failed)
