"""Real make/cc/ar over inert fixtures; no native verifier, network or wallet."""
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

builder = runpy.run_path(str(Path(__file__).with_name("build-light-client.py")))


class XmssBuildTests(unittest.TestCase):
    def test_private_objects_exclude_precreated_shared_tmp_archive_members(self):
        cc, cxx, ar, make = (shutil.which(x) for x in ("cc", "c++", "ar", "make"))
        if not all((cc, cxx, ar, make)):
            self.skipTest("C/C++ compiler and ar/make required")
        with tempfile.TemporaryDirectory(prefix="pearl-xmss-test-") as directory:
            root = Path(directory).resolve()
            evil = root / "injected.o"
            subprocess.run([cc, "-x", "c", "-c", "-o", str(evil), "-"],
                           input="int injected_fixture(void) { return 7; }\n", text=True, check=True)
            wrapper = root / "shell.py"
            wrapper.write_text("""#!/usr/bin/env python3
import os, pathlib, shutil, sys
shared = pathlib.Path('/tmp') / ('xmss_build_' + str(os.getpid()))
shared.mkdir()  # Exclusive: never adopt or remove an existing user's directory.
shutil.copyfile(os.environ['PEARL_TEST_OBJECT'], shared / 'injected.o')
pathlib.Path(os.environ['PEARL_TEST_SHARED']).write_text(str(shared))
os.execv('/bin/sh', ['/bin/sh', *sys.argv[1:]])
""")
            wrapper.chmod(0o700)
            for hardened in (False, True):
                with self.subTest(hardened=hardened):
                    staging = root / ("private build space" if hardened else "baseline")
                    staging.mkdir(mode=0o700)
                    source = staging / "source"
                    xmss = source / "xmss"
                    (xmss / "src").mkdir(parents=True)
                    (xmss / "safe.c").write_text("int safe_fixture(void) { return 1; }\n")
                    (xmss / "src/xmss.cpp").write_text("int cpp_fixture() { return 2; }\n")
                    (xmss / "xmss.h").write_text("/* inert fixture */\n")
                    (xmss / "Makefile").write_text("SOURCES = safe.c\nHEADERS =\n" + builder["XMSS_RECIPE"])
                    record = staging / "shared-path"
                    env = dict(os.environ, PEARL_TEST_OBJECT=str(evil), PEARL_TEST_SHARED=str(record))

                    def execute(args, cwd, environment):
                        self.assertEqual(args, ["make"])
                        subprocess.run([make, f"CC={cc}", f"CXX={cxx}", f"AR={ar}",
                                        f"SHELL={wrapper}"], cwd=cwd, env=environment,
                                       check=True, capture_output=True)
                    try:
                        if hardened:
                            with patch.dict(builder["build_xmss"].__globals__, run=execute):
                                builder["build_xmss"](source, staging, env)
                        else:
                            execute(["make"], xmss, env)
                        members = subprocess.check_output([ar, "t", str(xmss / "libxmss.a")], text=True).splitlines()
                        self.assertIn("safe.o", members)
                        self.assertIn("xmss.o", members)
                        self.assertEqual("injected.o" in members, not hardened)
                        if hardened:
                            self.assertTrue(Path(record.read_text()).joinpath("injected.o").is_file())
                            self.assertFalse(list(staging.glob("xmss-objects-*")))
                    finally:
                        if record.exists():
                            shared = Path(record.read_text())
                            self.assertEqual(shared.parent, Path("/tmp"))
                            self.assertTrue(shared.name.startswith("xmss_build_"))
                            if shared.exists():
                                shutil.rmtree(shared)

    def test_changed_recipe_fails_before_any_build_command(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory)
            (staging / "xmss").mkdir()
            (staging / "xmss/Makefile").write_text(builder["XMSS_RECIPE"].replace("mkdir -p", "mkdir"))
            with patch.dict(builder["build_xmss"].__globals__, run=lambda *_: self.fail("unexpected build")):
                with self.assertRaisesRegex(RuntimeError, "recipe changed"):
                    builder["build_xmss"](staging, staging, {})

    def test_compiler_failure_propagates_and_private_objects_are_cleaned(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory)
            xmss = staging / "xmss"
            (xmss / "src").mkdir(parents=True)
            for name in ("safe.c", "src/xmss.cpp", "xmss.h"):
                (xmss / name).write_text("/* inert fixture */\n")
            (xmss / "Makefile").write_text(
                "CC = false\nCXX = false\nAR = false\nSOURCES = safe.c\nHEADERS =\n" + builder["XMSS_RECIPE"])
            def execute(args, cwd, env):
                subprocess.run(args, cwd=cwd, env=env, check=True, capture_output=True)
            with patch.dict(builder["build_xmss"].__globals__, run=execute):
                with self.assertRaises(subprocess.CalledProcessError):
                    builder["build_xmss"](staging, staging, dict(os.environ))
            self.assertFalse(list(staging.glob("xmss-objects-*")))
            self.assertFalse((xmss / "libxmss.a").exists())


if __name__ == "__main__":
    unittest.main()
