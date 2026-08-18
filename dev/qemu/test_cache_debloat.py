#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cache_debloat import FORCE_DEFAULT_APPS, patch_apps_json, preset_fingerprint, write_preset_files


class PatchAppsJsonTest(unittest.TestCase):
    def test_marks_forced_apps_selected(self) -> None:
        payload = {
            "Apps": [
                {"AppId": "Microsoft.BingWeather", "SelectedByDefault": True},
                {"AppId": "Microsoft.OneDrive", "SelectedByDefault": False},
                {"AppId": "Microsoft.OutlookForWindows", "SelectedByDefault": False},
                {"AppId": "Microsoft.YourPhone", "SelectedByDefault": False},
                {"AppId": "Microsoft.WindowsCamera", "SelectedByDefault": False},
                {"AppId": "XP9CXNGPPJ97XX", "SelectedByDefault": True},
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Apps.json"
            path.write_bytes(b"\xef\xbb\xbf" + json.dumps(payload).encode("utf-8"))
            changed = patch_apps_json(path)
            data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(
            changed,
            [
                "Microsoft.OneDrive",
                "Microsoft.OutlookForWindows",
                "Microsoft.YourPhone",
                "Microsoft.WindowsCamera",
            ],
        )
        selected = {app["AppId"]: app["SelectedByDefault"] for app in data["Apps"]}
        self.assertTrue(selected["Microsoft.OneDrive"])
        self.assertTrue(selected["Microsoft.OutlookForWindows"])
        self.assertTrue(selected["Microsoft.YourPhone"])
        self.assertTrue(selected["Microsoft.WindowsCamera"])
        self.assertTrue(selected["XP9CXNGPPJ97XX"])
        self.assertIn("Microsoft.OneDrive", FORCE_DEFAULT_APPS)
        self.assertIn("Microsoft.OutlookForWindows", FORCE_DEFAULT_APPS)
        self.assertIn("Microsoft.WindowsCamera", FORCE_DEFAULT_APPS)

    def test_preset_changes_when_forced_list_changes(self) -> None:
        before = preset_fingerprint()
        after = preset_fingerprint([*FORCE_DEFAULT_APPS, "Microsoft.Paint"])
        self.assertNotEqual(before, after)
        with tempfile.TemporaryDirectory() as tmp:
            info = write_preset_files(Path(tmp))
            self.assertEqual(Path(info["preset_file"]).read_text(encoding="utf-8").strip(), before)
            self.assertIn("Microsoft.WindowsCamera", Path(info["forced_apps_file"]).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
