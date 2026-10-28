#!/usr/bin/env python3
"""SM-S947N adb helpers. PIN is never typed."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

MODEL = "SM-S947N"
SCRIPTS_REMOTE = "/sdcard/Scripts"
TASKER_PROJECTS = "/sdcard/Tasker/projects"
AUTOX_RUN = "org.autojs.autoxjs.v7/org.autojs.autojs.external.open.RunIntentActivity"
TASKER_PKG = "net.dinglisch.android.taskerm"
START_AUTOX = "org.androidmacro.START_AUTOX"
SMOKE_AUTOX = "org.androidmacro.SMOKE_AUTOX"
DEFAULT_AWAKE_MS = 600_000
DEFAULT_REST_MS = 60_000
DEFAULT_ROOT = Path.home() / "dev/private/android-macro"
ENDPOINT_FILE = Path.home() / ".cache" / "android-macro" / "phone-endpoint"
RUN_LOCK = DEFAULT_ROOT / "data" / "karrot-due.lock"
TIMEOUT_CACHE = Path.home() / ".cache" / "phone-screen-off-timeout"
REMOTE_REC = "/sdcard/phone-rec.mp4"
DEFAULT_REC_SECONDS = 180
RUN_REC_SECONDS = 60
IP_PORT = re.compile(r"(\d+\.\d+\.\d+\.\d+:\d+)")
NODE_RE = re.compile(r"<node\b[^>]*>")
ATTR_RE = re.compile(r'([\w:-]+)="([^"]*)"')
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"
GREEN = "\033[32m"
RED = "\033[31m"

AdbRun = Callable[[list[str]], subprocess.CompletedProcess[str]]


def color_enabled(stream=sys.stdout) -> bool:
	return stream.isatty() and os.environ.get("NO_COLOR") is None


def paint(text: str, *styles: str, stream=sys.stdout) -> str:
	if not styles or not color_enabled(stream):
		return text
	return f"{''.join(styles)}{text}{RESET}"


def mdns_hosts(text: str) -> list[str]:
	hosts: list[str] = []
	for line in text.splitlines():
		if "_adb-tls-connect._tcp" not in line:
			continue
		match = IP_PORT.search(line)
		if match:
			hosts.append(match.group(1))
	return hosts


def device_serials(text: str) -> list[str]:
	serials: list[str] = []
	for line in text.splitlines():
		match = re.match(r"^(\S+)\s+device\b", line)
		if match and match.group(1) != "host":
			serials.append(match.group(1))
	return serials


def pick_serial(mdns: str, devices: str, model_of: Callable[[str], str]) -> str | None:
	seen: set[str] = set()
	ordered: list[str] = []
	for serial in mdns_hosts(mdns) + device_serials(devices):
		if serial in seen:
			continue
		seen.add(serial)
		ordered.append(serial)
	for serial in ordered:
		if model_of(serial).strip() == MODEL:
			return serial
	return None


def default_root(explicit: str | None) -> Path:
	if explicit:
		return Path(explicit).expanduser().resolve()
	env = os.environ.get("PHONE_ROOT")
	if env:
		return Path(env).expanduser().resolve()
	cwd = Path.cwd()
	if (cwd / "autox").is_dir():
		return cwd
	return DEFAULT_ROOT


class Phone:
	def __init__(
		self,
		run: AdbRun | None = None,
		screencap: Callable[[str], bytes] | None = None,
		spawn: Callable[[list[str]], subprocess.Popen] | None = None,
		recover: bool = False,
		sleep: Callable[[float], None] = time.sleep,
		endpoint_file: Path = ENDPOINT_FILE,
		lock_dir: Path = RUN_LOCK,
	) -> None:
		self._run = run or self._subprocess
		self._screencap = screencap
		self._spawn = spawn
		self._recover = recover
		self._sleep = sleep
		self._endpoint_file = endpoint_file
		self._lock_dir = lock_dir

	@staticmethod
	def _subprocess(args: list[str]) -> subprocess.CompletedProcess[str]:
		return subprocess.run(args, text=True, capture_output=True)

	def screencap(self, serial: str) -> bytes:
		if self._screencap:
			return self._screencap(serial)
		result = subprocess.run(
			["adb", "-s", serial, "exec-out", "screencap", "-p"],
			capture_output=True,
			check=False,
		)
		if result.returncode != 0:
			raise SystemExit((result.stderr or b"").decode("utf-8", "replace") or "screencap failed")
		return result.stdout or b""

	def adb(self, serial: str | None, *args: str, check: bool = True) -> str:
		cmd = ["adb"]
		if serial:
			cmd.extend(["-s", serial])
		cmd.extend(args)
		result = self._run(cmd)
		out = (result.stdout or "") + (result.stderr or "")
		if check and result.returncode != 0:
			raise SystemExit(out.strip() or f"adb failed: {' '.join(cmd)}")
		return out

	def _pick(self) -> str | None:
		mdns = self.adb(None, "mdns", "services", check=False)
		devices = self.adb(None, "devices", "-l", check=False)

		def model_of(serial: str) -> str:
			return self.adb(serial, "shell", "getprop", "ro.product.model", check=False)

		return pick_serial(mdns, devices, model_of)

	def _remember(self, serial: str) -> str:
		if IP_PORT.fullmatch(serial):
			try:
				self._endpoint_file.parent.mkdir(parents=True, exist_ok=True)
				self._endpoint_file.write_text(serial + "\n", encoding="utf-8")
			except OSError:
				pass
		return serial

	def serial(self) -> str:
		found = self._pick()
		if found:
			return self._remember(found) if self._recover else found
		# 오래 떠 있던 adb 서버는 mdns 탐색이 멈춘다. 돌고 있는 회차가 없을 때만 되살린다.
		if self._recover and not self._lock_dir.exists():
			found = self._recover_serial()
			if found:
				return self._remember(found)
		raise SystemExit("SM-S947N adb를 못 찾았어요. 포트를 추측하지 않아요.")

	def _recover_serial(self) -> str | None:
		try:
			last = self._endpoint_file.read_text(encoding="utf-8").strip()
		except OSError:
			last = ""
		if last:
			self.adb(None, "connect", last, check=False)
			if self.adb(last, "shell", "getprop", "ro.product.model", check=False).strip() == MODEL:
				return last
		self.adb(None, "kill-server", check=False)
		self.adb(None, "start-server", check=False)
		for _ in range(10):
			self._sleep(1)
			found = self._pick()
			if found:
				return found
		return None

	def shell(self, serial: str, *args: str, check: bool = True) -> str:
		return self.adb(serial, "shell", *args, check=check)

	def spawn(self, serial: str, *args: str) -> subprocess.Popen:
		cmd = ["adb", "-s", serial, *args]
		if self._spawn:
			return self._spawn(cmd)
		return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def cmd_serial(phone: Phone, _args: argparse.Namespace) -> int:
	print(phone.serial())
	return 0


def cmd_awake(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()
	current = phone.shell(serial, "settings", "get", "system", "screen_off_timeout").strip()
	TIMEOUT_CACHE.parent.mkdir(parents=True, exist_ok=True)
	if not TIMEOUT_CACHE.exists():
		TIMEOUT_CACHE.write_text(current + "\n")
	phone.shell(serial, "settings", "put", "system", "screen_off_timeout", str(args.ms))
	phone.shell(serial, "input", "keyevent", "KEYCODE_WAKEUP")
	print(f"{current} → {args.ms}")
	return 0


def cmd_rest(phone: Phone, _args: argparse.Namespace) -> int:
	serial = phone.serial()
	saved = DEFAULT_REST_MS
	if TIMEOUT_CACHE.exists():
		text = TIMEOUT_CACHE.read_text().strip()
		if text.isdigit():
			saved = int(text)
		TIMEOUT_CACHE.unlink()
	phone.shell(serial, "settings", "put", "system", "screen_off_timeout", str(saved))
	print(str(saved))
	return 0


def keyguard_showing(blob: str) -> bool | None:
	if "isKeyguardShowing=true" in blob:
		return True
	if "isKeyguardShowing=false" in blob:
		return False
	return None


def cmd_wait(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()
	deadline = time.time() + args.timeout
	phone.shell(serial, "input", "keyevent", "KEYCODE_WAKEUP", check=False)
	while time.time() < deadline:
		blob = phone.shell(serial, "dumpsys", "window", check=False)
		if keyguard_showing(blob) is False:
			print("unlocked")
			return 0
		time.sleep(0.8)
		phone.shell(serial, "input", "keyevent", "KEYCODE_WAKEUP", check=False)
	print("locked", file=sys.stderr)
	return 1


def cmd_shot(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()
	raw = phone.screencap(serial)
	if args.file:
		Path(args.file).write_bytes(raw)
		print(args.file)
	else:
		sys.stdout.buffer.write(raw)
	return 0


def node_attr(raw: str, name: str) -> str:
	for key, value in ATTR_RE.findall(raw):
		if key == name:
			return value
	return ""


def node_lines(xml: str) -> str:
	"""text, content-desc, bounds. Nodes with neither label are omitted."""
	rows: list[str] = []
	for raw in NODE_RE.findall(xml):
		text = node_attr(raw, "text")
		desc = node_attr(raw, "content-desc")
		if text == "" and desc == "":
			continue
		rows.append(f"{text}\t{desc}\t{node_attr(raw, 'bounds')}")
	return "\n".join(rows) + ("\n" if rows else "")


def sheet_plan(duration: float, every: float, cols: int = 5, max_frames: int = 40) -> tuple[str, float, int]:
	"""ffmpeg vf for an interval contact sheet. Does not choose a tap."""
	step = every if every > 0 else 2.0
	if duration <= 0:
		frames = max_frames
	else:
		frames = max(1, int(duration / step))
		if frames > max_frames:
			step = duration / max_frames
			frames = max_frames
	rows = max(1, (frames + cols - 1) // cols)
	return f"fps=1/{step:.3f},scale=180:-1,tile={cols}x{rows}", step, frames


def cmd_dump(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()
	phone.shell(serial, "uiautomator", "dump", "/sdcard/ui.xml")
	xml = phone.adb(serial, "shell", "cat", "/sdcard/ui.xml")
	body = node_lines(xml) if args.text else xml
	if args.file:
		Path(args.file).write_text(body)
		print(args.file)
	else:
		sys.stdout.write(body)
		if not body.endswith("\n"):
			sys.stdout.write("\n")
	return 0


def probe_duration(path: Path) -> float:
	result = subprocess.run(
		["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
		capture_output=True,
		text=True,
		check=False,
	)
	try:
		return float((result.stdout or "").strip())
	except ValueError:
		return 0.0


def cmd_sheet(_phone: Phone, args: argparse.Namespace) -> int:
	src = Path(args.file)
	if not src.is_file():
		print(f"녹화가 없어요: {src}", file=sys.stderr)
		return 1
	vf, _step, _frames = sheet_plan(probe_duration(src), args.every or 2.0)
	out = Path(args.out) if args.out else src.with_name(f"{src.stem}-sheet.png")
	result = subprocess.run(
		["ffmpeg", "-y", "-i", str(src), "-vf", vf, "-frames:v", "1", str(out)],
		capture_output=True,
		text=True,
		check=False,
	)
	if result.returncode != 0 or not out.is_file():
		err = (result.stderr or "").strip().splitlines()
		print(err[-1] if err else "시트를 만들지 못했어요", file=sys.stderr)
		return 1
	print(out)
	return 0


def cmd_push(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()
	root = default_root(args.root)
	autox = root / "autox"
	if not autox.is_dir():
		raise SystemExit(f"autox 폴더가 없어요: {autox}")
	pushed: list[str] = []
	for path in sorted(autox.glob("*.js")):
		remote = f"{SCRIPTS_REMOTE}/{path.name}"
		phone.adb(serial, "push", str(path), remote)
		pushed.append(remote)
	prj = autox / "Karrot.prj.xml"
	if prj.exists():
		remote = f"{TASKER_PROJECTS}/{prj.name}"
		phone.adb(serial, "push", str(prj), remote)
		pushed.append(remote)
	print("\n".join(pushed))
	return 0


def rec_remote_cmd(seconds: int) -> tuple[str, ...]:
	limit = max(1, min(int(seconds), DEFAULT_REC_SECONDS))
	return ("shell", "screenrecord", "--time-limit", str(limit), REMOTE_REC)


def default_rec_path() -> Path:
	return Path(time.strftime("phone-%Y%m%d-%H%M%S.mp4"))


def stop_screenrecord(phone: Phone, serial: str, proc: subprocess.Popen) -> None:
	phone.shell(serial, "killall", "-INT", "screenrecord", check=False)
	try:
		proc.wait(timeout=5)
	except subprocess.TimeoutExpired:
		proc.kill()


def record_to(
	phone: Phone,
	local: Path,
	seconds: int,
	during: Callable[[], None] | None = None,
) -> Path:
	serial = phone.serial()
	phone.shell(serial, "rm", "-f", REMOTE_REC, check=False)
	proc = phone.spawn(serial, *rec_remote_cmd(seconds))
	try:
		if during:
			during()
		try:
			proc.wait(timeout=seconds + 2)
		except (KeyboardInterrupt, subprocess.TimeoutExpired):
			stop_screenrecord(phone, serial, proc)
	finally:
		if proc.poll() is None:
			stop_screenrecord(phone, serial, proc)
	time.sleep(1.2)
	phone.adb(serial, "pull", REMOTE_REC, str(local))
	phone.shell(serial, "rm", "-f", REMOTE_REC, check=False)
	return local


def maybe_record(phone: Phone, args: argparse.Namespace, action: Callable[[], None]) -> Path | None:
	if not getattr(args, "rec", None):
		action()
		return None
	seconds = args.seconds or RUN_REC_SECONDS
	path = Path(args.rec)
	return record_to(phone, path, seconds, during=action)


def cmd_run(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()
	name = Path(args.script).name
	if not name.endswith(".js"):
		name += ".js"
	uri = f"file://{SCRIPTS_REMOTE}/{name}"

	def launch() -> None:
		phone.adb(
			serial,
			"shell",
			"am",
			"start",
			"-n",
			AUTOX_RUN,
			"-d",
			uri,
		)

	rec = maybe_record(phone, args, launch)
	print(uri if rec is None else f"{uri}\n{rec}")
	return 0


def cmd_start(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()

	def launch() -> None:
		phone.adb(serial, "shell", "am", "broadcast", "-a", START_AUTOX, "-p", TASKER_PKG)

	rec = maybe_record(phone, args, launch)
	print(START_AUTOX if rec is None else f"{START_AUTOX}\n{rec}")
	return 0


def cmd_rec(phone: Phone, args: argparse.Namespace) -> int:
	local = Path(args.file) if args.file else default_rec_path()
	seconds = args.seconds or DEFAULT_REC_SECONDS
	print(record_to(phone, local, seconds))
	return 0


def cmd_smoke(phone: Phone, _args: argparse.Namespace) -> int:
	serial = phone.serial()
	phone.adb(serial, "shell", "am", "broadcast", "-a", SMOKE_AUTOX, "-p", TASKER_PKG)
	time.sleep(1.2)
	body = phone.adb(serial, "shell", "cat", f"{SCRIPTS_REMOTE}/tasker-smoke.json", check=False)
	print(body.strip())
	return 0 if body.strip() else 1


def cmd_reverse(phone: Phone, args: argparse.Namespace) -> int:
	serial = phone.serial()
	phone.adb(serial, "reverse", "tcp:1780", f"tcp:{args.to}")
	print(f"tcp:1780 → tcp:{args.to}")
	return 0


SECTIONS = (
	(
		"Screen",
		(
			("awake", "작업 중 화면이 꺼지지 않게 한다"),
			("rest", "화면 꺼짐 시간을 되돌린다"),
		),
	),
	(
		"Device",
		(
			("serial", "지금 포트의 SM-S947N 시리얼"),
			("wait", "사람이 잠금을 풀 때까지 대기 (PIN 금지)"),
			("shot", "스크린샷"),
			("dump", "uiautomator xml (--text 는 글자만)"),
		),
	),
	(
		"Scripts",
		(
			("push", "autox 스크립트와 Karrot.prj.xml"),
			("run", "AutoX RunIntentActivity (data URI, --rec 녹화)"),
			("start", "Tasker START_AUTOX (--rec 녹화)"),
			("smoke", "Tasker SMOKE_AUTOX"),
			("reverse", "tcp:1780 → 호스트"),
		),
	),
	(
		"Debug",
		(
			("rec", "화면 녹화 후 호스트로 가져온다"),
			("sheet", "녹화에서 간격 시트. 탭은 고르지 않음"),
		),
	),
)


def print_help() -> None:
	print(paint("phone", BOLD) + " — SM-S947N adb. PIN은 넣지 않는다.")
	print()
	for title, rows in SECTIONS:
		print(paint(title, BOLD, CYAN))
		width = max(len(name) for name, _ in rows)
		for name, desc in rows:
			print(f"  {paint(name.ljust(width), GREEN)}  {desc}")
		print()


def build_parser() -> argparse.ArgumentParser:
	parser = argparse.ArgumentParser(prog="phone", add_help=False)
	parser.add_argument("-h", "--help", action="store_true")
	sub = parser.add_subparsers(dest="command")

	awake = sub.add_parser("awake")
	awake.add_argument("--ms", type=int, default=DEFAULT_AWAKE_MS)
	awake.set_defaults(handler=cmd_awake)

	rest = sub.add_parser("rest")
	rest.set_defaults(handler=cmd_rest)

	serial = sub.add_parser("serial")
	serial.set_defaults(handler=cmd_serial)

	wait = sub.add_parser("wait")
	wait.add_argument("--timeout", type=int, default=120)
	wait.set_defaults(handler=cmd_wait)

	shot = sub.add_parser("shot")
	shot.add_argument("file", nargs="?")
	shot.set_defaults(handler=cmd_shot)

	dump = sub.add_parser("dump")
	dump.add_argument("file", nargs="?")
	dump.add_argument("--text", action="store_true")
	dump.set_defaults(handler=cmd_dump)

	sheet = sub.add_parser("sheet")
	sheet.add_argument("file")
	sheet.add_argument("--every", type=float, default=2)
	sheet.add_argument("--out")
	sheet.set_defaults(handler=cmd_sheet)

	push = sub.add_parser("push")
	push.add_argument("--root")
	push.set_defaults(handler=cmd_push)

	run = sub.add_parser("run")
	run.add_argument("script")
	run.add_argument("--rec", metavar="FILE")
	run.add_argument("--seconds", type=int)
	run.set_defaults(handler=cmd_run)

	start = sub.add_parser("start")
	start.add_argument("--rec", metavar="FILE")
	start.add_argument("--seconds", type=int)
	start.set_defaults(handler=cmd_start)

	rec = sub.add_parser("rec")
	rec.add_argument("file", nargs="?")
	rec.add_argument("--seconds", type=int)
	rec.set_defaults(handler=cmd_rec)

	smoke = sub.add_parser("smoke")
	smoke.set_defaults(handler=cmd_smoke)

	rev = sub.add_parser("reverse")
	rev.add_argument("--to", type=int, default=45202)
	rev.set_defaults(handler=cmd_reverse)
	return parser


def main(argv: list[str] | None = None, phone: Phone | None = None) -> int:
	parser = build_parser()
	args = parser.parse_args(argv)
	if args.help or not args.command:
		print_help()
		return 0 if args.help else 2
	try:
		return int(args.handler(phone or Phone(recover=True), args))
	except SystemExit as exc:
		if isinstance(exc.code, str):
			print(paint(exc.code, RED), file=sys.stderr)
			return 1
		raise


if __name__ == "__main__":
	sys.exit(main())
