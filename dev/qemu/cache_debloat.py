#!/usr/bin/env python3
"""Download Win11Debloat once. Keep the patched cache on the host.

Do not stage this into Shared. After SSH works, copy it to the guest over SSH.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

CACHE_ROOT = Path.home() / ".cache" / "windows-qemu" / "win11debloat"
API_URL = "https://api.github.com/repos/Raphire/Win11Debloat/releases/latest"
PINNED_TAG = "2026.07.11"
USER_AGENT = "windows-qemu-debloat"
FORCE_DEFAULT_APPS = (
    "Microsoft.OneDrive",
    "Microsoft.Copilot",
    "XP9CXNGPPJ97XX",
    "Microsoft.Windows.AIHub",
    "Microsoft.MicrosoftOfficeHub",
    "Microsoft.OutlookForWindows",
    "Microsoft.YourPhone",
    "Microsoft.People",
    "Microsoft.GamingApp",
    "Microsoft.Xbox.TCUI",
    "Microsoft.XboxGameOverlay",
    "Microsoft.XboxGamingOverlay",
    "Microsoft.XboxIdentityProvider",
    "Microsoft.XboxSpeechToTextOverlay",
    "Microsoft.ZuneMusic",
    "Microsoft.BingSearch",
    "Microsoft.WindowsCamera",
)


def forced_apps_payload() -> str:
    return "\n".join(FORCE_DEFAULT_APPS) + "\n"


def preset_fingerprint(apps: list[str] | None = None) -> str:
    names = list(apps if apps is not None else FORCE_DEFAULT_APPS)
    return hashlib.sha256(("\n".join(names) + "\n").encode("utf-8")).hexdigest()[:16]


def write_preset_files(root: Path) -> dict[str, str]:
    apps_file = root / "forced-apps.txt"
    preset_file = root / "PRESET"
    fingerprint = preset_fingerprint()
    apps_file.write_text(forced_apps_payload(), encoding="utf-8")
    preset_file.write_text(fingerprint + "\n", encoding="utf-8")
    return {"forced_apps_file": str(apps_file), "preset_file": str(preset_file), "preset": fingerprint}


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})


def latest_release() -> dict[str, str]:
    with urllib.request.urlopen(_request(API_URL), timeout=30) as resp:
        data = json.load(resp)
    tag = str(data["tag_name"])
    return {"tag": tag, "zip": str(data["zipball_url"])}


def cache_dir(tag: str) -> Path:
    return CACHE_ROOT / tag


def cached_script(tag: str) -> Path | None:
    root = cache_dir(tag)
    if not root.is_dir():
        return None
    matches = sorted(root.rglob("Win11Debloat.ps1"))
    return matches[0] if matches else None


def download(tag: str, zip_url: str) -> Path:
    root = cache_dir(tag)
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="win11debloat-") as tmp:
        archive = Path(tmp) / "src.zip"
        with urllib.request.urlopen(_request(zip_url), timeout=60) as resp, archive.open("wb") as fh:
            shutil.copyfileobj(resp, fh)
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(root)
    script = cached_script(tag)
    if script is None:
        raise SystemExit(f"Win11Debloat.ps1 missing from {root}")
    (root / "VERSION").write_text(tag + "\n", encoding="utf-8")
    return script


def patch_apps_json(path: Path) -> list[str]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")
    data = json.loads(text)
    apps = data.get("Apps") if isinstance(data, dict) else data
    if not isinstance(apps, list):
        raise SystemExit(f"unexpected Apps.json shape in {path}")
    changed: list[str] = []
    wanted = {app_id.lower() for app_id in FORCE_DEFAULT_APPS}
    for app in apps:
        if not isinstance(app, dict):
            continue
        app_id = str(app.get("AppId") or "")
        if app_id.lower() not in wanted:
            continue
        if app.get("SelectedByDefault") is True:
            continue
        app["SelectedByDefault"] = True
        changed.append(app_id)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return changed


def apply_local_preset(root: Path) -> list[str]:
    apps = root / "Config" / "Apps.json"
    if not apps.is_file():
        raise SystemExit(f"missing {apps}")
    return patch_apps_json(apps)


def ensure(refresh: bool = False, offline: bool = False) -> dict[str, object]:
    tag = PINNED_TAG
    zip_url = f"https://api.github.com/repos/Raphire/Win11Debloat/zipball/{tag}"
    if not offline:
        try:
            release = latest_release()
            tag = release["tag"]
            zip_url = release["zip"]
        except Exception:
            if cached_script(tag) is None and not refresh:
                raise
    script = cached_script(tag)
    if script is None or refresh:
        if offline:
            raise SystemExit(f"offline and cache missing for {tag}")
        script = download(tag, zip_url)
    patched = apply_local_preset(script.parent)
    version = cache_dir(tag) / "VERSION"
    if not version.is_file():
        version.write_text(tag + "\n", encoding="utf-8")
    preset = write_preset_files(script.parent)
    return {
        "tag": tag,
        "script": str(script),
        "cache": str(script.parent),
        "version_file": str(version),
        "forced_default_apps": FORCE_DEFAULT_APPS,
        "patched_default_apps": patched,
        "preset": preset["preset"],
        "forced_apps_file": preset["forced_apps_file"],
        "preset_file": preset["preset_file"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    info = ensure(refresh=args.refresh, offline=args.offline)
    print(json.dumps(info, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
