#!/usr/bin/env python3
"""Installer boundary tests. All loader/process calls are mocked; no USB access."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("install-pearl.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def fake_elf(metadata):
    names = bytearray(b"\0.shstrtab\0")
    entries = []
    for name, value in metadata.items():
        offset = len(names)
        names.extend(name.encode() + b"\0")
        entries.append((offset, value.encode()))
    values = [(1, bytes(names))] + entries
    data_offset = 52 + 40 * len(values)
    header = bytearray(52)
    header[:6] = b"\x7fELF\x01\x01"
    struct.pack_into("<I", header, 32, 52)
    struct.pack_into("<HHH", header, 46, 40, len(values), 0)
    sections, payload = bytearray(), bytearray()
    for name, value in values:
        sections.extend(struct.pack("<10I", name, 1, 0, 0, data_offset + len(payload), len(value), 0, 0, 1, 0))
        payload.extend(value)
    return bytes(header + sections + payload)


class InstallerTests(unittest.TestCase):
    def fixture(self, folder, **overrides):
        release, model = app.release_for("gen5")
        model = dict(model)
        metadata = {"ledger.app_name": "Pearl", "ledger.app_version": release["version"],
                    "ledger.api_level": "27", "ledger.target": "apex_p",
                    "ledger.target_id": model["targetId"], "ledger.app_flags": "0x240",
                    "ledger.sdk_hash": release["sdkCommit"]}
        metadata.update(overrides)
        for name, data in [("app.elf", fake_elf(metadata)), ("app.hex", b"fixture-only")]:
            (folder / name).write_bytes(data)
            model["elfSha256" if name.endswith("elf") else "hexSha256"] = hashlib.sha256(data).hexdigest()
        values = {"_nvram_data": 0x1000, "_envram_data": 0x1200,
                  "_install_parameters": 0x1200, "_einstall_parameters": 0x126a}
        (folder / "app.map").write_text("\n".join(f"{v:x} {v:x} 0 1 {k} = ." for k, v in values.items()))
        return release, model

    def test_all_loader_targets_permissions_sizes_and_no_delete(self):
        for name in app.NAMES:
            release, model = app.release_for(name)
            args = app.loader_arguments(Path("/private-loader/python"), Path("/verified"), model)
            self.assertEqual(args[args.index("--targetId") + 1], model["targetId"])
            self.assertEqual(args[args.index("--appFlags") + 1], "0x40" if name == "nano-s-plus" else "0x240")
            self.assertEqual(args[args.index("--installparamsSize") + 1], str(model["installparamsSize"]))
            self.assertNotIn("--delete", args)
            self.assertEqual(args[args.index("--fileName") + 1], "/verified/app.hex")

    def test_retail_nano_x_rejected_before_process_or_download(self):
        with patch.object(app, "call") as process:
            with self.assertRaisesRegex(RuntimeError, "Nano X"):
                app.run("nano-x", install=True)
            process.assert_not_called()

    def test_source_mismatch_rejected(self):
        release, _ = app.release_for("gen5")
        changed = dict(release["sourceFiles"])
        changed["Makefile"] = "0" * 64
        with patch.object(app, "output", return_value=json.dumps(changed)):
            with self.assertRaisesRegex(RuntimeError, "source differs"):
                app.check_source(Path("/fixture"), release)

    def test_wrong_or_dirty_sdk_rejected(self):
        release, _ = app.release_for("gen5")
        for responses in [["0" * 40], [release["sdkCommit"], " M file"]]:
            with patch.object(app, "output", side_effect=responses):
                with self.assertRaises(RuntimeError):
                    app.check_sdk(Path("/fixture"), release)

    def test_verified_image_metadata_and_map(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            release, model = self.fixture(folder)
            app.check_image(folder, release, model)

    def test_wrong_version_model_api_permissions_sdk_rejected(self):
        cases = {"ledger.app_version": "0.1.0", "ledger.target": "flex", "ledger.api_level": "28",
                 "ledger.app_flags": "0xa40", "ledger.sdk_hash": "0" * 40,
                 "ledger.target_id": "0x33300004"}
        for key, value in cases.items():
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                release, model = self.fixture(folder, **{key: value})
                with self.assertRaises((ValueError, RuntimeError)):
                    app.check_image(folder, release, model)

    def test_binary_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            release, model = self.fixture(folder)
            (folder / "app.hex").write_bytes(b"changed")
            with self.assertRaisesRegex(RuntimeError, "app.hex differs"):
                app.check_image(folder, release, model)

    def test_wrong_map_sizes_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            release, model = self.fixture(folder)
            path = folder / "app.map"
            path.write_text(path.read_text().replace("126a", "126b"))
            with self.assertRaisesRegex(RuntimeError, "sizes differ"):
                app.check_image(folder, release, model)

    def test_build_only_never_creates_loader_or_opens_usb(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            with patch.object(app.tempfile, "mkdtemp", return_value=directory), \
                 patch.object(app, "call") as calls, patch.object(app, "check_source"), \
                 patch.object(app, "check_sdk"), patch.object(app, "check_image") as checked, \
                 patch.object(app.shutil, "which", return_value="/tool"), \
                 patch.object(app.subprocess, "run") as cached:
                cached.return_value.returncode = 0
                app.run("gen5", sdk=Path("/clean-sdk"))
                checked.assert_called_once()
                commands = [str(c.args[0]) for c in calls.call_args_list]
                self.assertFalse(any("ledgerblue" in c or "venv" in c for c in commands))
                self.assertTrue(any("--network" in c and "none" in c for c in commands))

    def test_install_rechecks_image_after_loader_setup_before_usb(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            with patch.object(app.tempfile, "mkdtemp", return_value=directory), \
                 patch.object(app, "call") as calls, patch.object(app, "check_source"), \
                 patch.object(app, "check_sdk"), \
                 patch.object(app, "check_image", side_effect=[None, RuntimeError("Image changed")]), \
                 patch.object(app.shutil, "which", return_value="/tool"), \
                 patch.object(app.subprocess, "run") as cached:
                cached.return_value.returncode = 0
                with self.assertRaisesRegex(RuntimeError, "Image changed"):
                    app.run("gen5", install=True, sdk=Path("/clean-sdk"))
                self.assertFalse(any("ledgerblue.loadApp" in [str(a) for a in c.args[0]]
                                     for c in calls.call_args_list))


if __name__ == "__main__":
    unittest.main()
