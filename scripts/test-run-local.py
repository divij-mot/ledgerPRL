"""Isolated launcher decisions: fake commands, no server/helper/network/device."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
launcher = runpy.run_path(str(HERE / "run-local.py"))
run = launcher["run"]
current = launcher["helper_current"]
builder = runpy.run_path(str(HERE / "build-light-client.py"))


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pearl-launch-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / "scripts").mkdir()
        (self.root / "scripts/build-light-client.py").write_text((HERE / "build-light-client.py").read_text())
        self.sources = self.root / "apps/light-client"
        self.sources.mkdir(parents=True)
        for name in ("main.go", "go.mod", "go.sum"):
            (self.sources / name).write_text("public test fixture " + name)
        self.calls = []
        self.version = "v24.19.0\n"
        self.toolchains = "1.90.0-aarch64-apple-darwin\n"
        self.fail = None
        self.build_succeeds = True

    def artifact(self):
        folder = self.root / ".tools/light-client"
        folder.mkdir(parents=True, exist_ok=True)
        executable = folder / "pearl-watch"
        executable.write_text("never executed: public test bytes")
        executable.chmod(0o700)
        value = {
            "schema": 1, "sourceCommit": builder["COMMIT"],
            "archiveSha256": builder["ARCHIVE_SHA256"],
            "executable": str(executable), "executableSha256": builder["digest"](executable),
            "buildTags": ["xmss", "zkpow"],
            "helperSources": {p.relative_to(self.root).as_posix(): builder["digest"](p)
                              for p in self.sources.rglob("*") if p.is_file()},
        }
        manifest = folder / "manifest.json"
        manifest.write_text(json.dumps(value))
        manifest.chmod(0o600)

    def fake_command(self, args, **kwargs):
        self.calls.append(args)
        if self.fail and self.fail in args:
            raise subprocess.CalledProcessError(1, args)
        if args[-1] == "--version":
            return subprocess.CompletedProcess(args, 0, self.version)
        if args[:2] == ["rustup", "toolchain"]:
            return subprocess.CompletedProcess(args, 0, self.toolchains)
        if args[1:] == ["run", "setup:light"] and self.build_succeeds:
            self.artifact()
        return subprocess.CompletedProcess(args, 0)

    def launch(self, missing=None):
        with patch("shutil.which", side_effect=lambda name: None if name == missing else "/fake/" + name), \
             patch("subprocess.run", side_effect=self.fake_command), \
             patch.dict(os.environ, {}, clear=False), \
             patch("os.chdir") as chdir, patch("os.execv") as execute:
            try:
                run(self.root)
            except (RuntimeError, subprocess.CalledProcessError):
                chdir.assert_not_called()
                execute.assert_not_called()
                raise
            chdir.assert_called_once_with(self.root)
            self.assertEqual(os.environ["PEARL_OPEN_BROWSER"], "1")
            execute.assert_called_once_with("/fake/npm", ["/fake/npm", "start"])

    def test_first_run_builds_then_uses_existing_foreground_start(self):
        self.assertFalse((self.root / ".git").exists())
        self.launch(missing="git")
        self.assertEqual(self.calls[-2:], [["/fake/npm", "ci", "--ignore-scripts", "--include=dev"],
                                          ["/fake/npm", "run", "setup:light"]])
        self.assertTrue(current(self.root, builder))

    def test_missing_native_c_cpp_or_archiver_fails_before_dependency_install(self):
        for command in ("ar", "/usr/bin/gcc", "/usr/bin/g++"):
            with self.subTest(command=command):
                with self.assertRaises(RuntimeError) as failure:
                    self.launch(missing=command)
                self.assertIn(f"Missing {command};", str(failure.exception))
        self.assertFalse(any("ci" in args for args in self.calls))

    def test_current_helper_skips_build_and_native_prerequisites(self):
        self.artifact()
        self.launch(missing="cargo")
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[-1], ["/fake/npm", "ci", "--ignore-scripts", "--include=dev"])

    def test_changed_source_added_source_and_corrupt_binary_rebuild(self):
        for case in ("changed", "added", "binary", "manifest", "permission"):
            with self.subTest(case=case):
                self.artifact()
                if case == "changed":
                    (self.sources / "main.go").write_text("changed public source")
                elif case == "added":
                    (self.sources / "extra.go").write_text("new public source")
                elif case == "binary":
                    (self.root / ".tools/light-client/pearl-watch").write_text("corrupt")
                elif case == "manifest":
                    (self.root / ".tools/light-client/manifest.json").write_text("not json")
                else:
                    (self.root / ".tools/light-client/manifest.json").chmod(0o644)
                self.assertFalse(current(self.root, builder))
                self.calls.clear()
                self.launch()
                self.assertIn(["/fake/npm", "run", "setup:light"], self.calls)

    def test_deleted_source_is_stale(self):
        (self.sources / "extra.go").write_text("temporary public source")
        self.artifact()
        (self.sources / "extra.go").unlink()
        self.assertFalse(current(self.root, builder))
        self.launch()

    def test_wrong_upstream_tags_or_source_hash_are_stale(self):
        for key, value in (("sourceCommit", "0" * 40), ("buildTags", []),
                           ("helperSources", {})):
            with self.subTest(key=key):
                self.artifact()
                path = self.root / ".tools/light-client/manifest.json"
                manifest = json.loads(path.read_text())
                manifest[key] = value
                path.write_text(json.dumps(manifest))
                self.assertFalse(current(self.root, builder))
                self.launch()

    def test_missing_node_or_npm_explains_normal_install_without_running_commands(self):
        for command in ("node", "npm"):
            with self.subTest(command=command):
                with self.assertRaises(RuntimeError) as failure:
                    self.launch(missing=command)
                message = str(failure.exception)
                self.assertIn(f"Missing {command}.", message)
                self.assertIn("https://nodejs.org/en/download", message)
                self.assertIn("python3 scripts/run-local.py", message)
        self.assertEqual(self.calls, [])

    def test_wrong_node_and_missing_prerequisites_fail_before_install(self):
        for version in ("v22.22.0", "v24.18.0", "v25.0.0"):
            self.version = version
            with self.assertRaisesRegex(RuntimeError, "Node 24.19"):
                self.launch()
        self.version = "v24.19.0"
        with self.assertRaisesRegex(RuntimeError, "Missing cc"):
            self.launch(missing="cc")
        self.toolchains = "stable-x86_64-unknown-linux-gnu\n"
        with self.assertRaisesRegex(RuntimeError, "Rust 1.90.0"):
            self.launch()
        self.assertFalse(any("ci" in args for args in self.calls))

    def test_command_failure_or_unverified_build_never_starts(self):
        for failure in ("ci", "setup:light", None):
            with self.subTest(failure=failure):
                self.fail = failure
                self.build_succeeds = False
                with self.assertRaises((RuntimeError, subprocess.CalledProcessError)):
                    self.launch()

    def test_symlink_artifact_and_source_are_not_current(self):
        self.artifact()
        manifest = self.root / ".tools/light-client/manifest.json"
        saved = manifest.with_suffix(".saved")
        manifest.rename(saved)
        manifest.symlink_to(saved)
        self.assertFalse(current(self.root, builder))
        with self.assertRaisesRegex(RuntimeError, "Unsafe local build cache"):
            self.launch()
        self.assertFalse(any("ci" in args for args in self.calls))
        manifest.unlink()
        saved.rename(manifest)
        (self.sources / "alias.go").symlink_to(self.sources / "main.go")
        self.assertFalse(current(self.root, builder))


if __name__ == "__main__":
    unittest.main()
