"""Offline packaging regressions; no Ledger device or private key is used."""
import binascii
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("ledger_package", ROOT / "scripts/ledger-package.py")
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


def tlv(tag, value):
    return bytes([tag, len(value)]) + value


def record(kind, address, data):
    prefix = bytes([len(data)]) + address.to_bytes(2, "big") + bytes([kind]) + data
    return ":" + (prefix + bytes([-sum(prefix) & 255])).hex().upper()


def apdu(data):
    return (b"\xe0\x00\x00\x00" + bytes([len(data)]) + data).hex()


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.image = dict(enumerate(bytes(range(16)), 0x1000)) | dict(enumerate(b"tail", 0x1100))
        self.info = {
            "target_id": 0x33100004, "api_level": 27, "flags": 0,
            "code_length": 256, "data_length": 0, "install_params_length": 4,
            "boot_offset": 1, "load_length": 260,
        }
        self.hex = "\n".join([
            record(4, 0, b"\x00\x00"), record(0, 0x1000, bytes(range(16))),
            record(0, 0x1100, b"tail"), record(5, 0, (0x1001).to_bytes(4, "big")),
            record(1, 0, b""),
        ]) + "\n"
        self.params = b"".join([tlv(1, b"Pearl Dev"), tlv(2, b"0.1.0"), tlv(3, b"icon"),
            tlv(4, b"\x01\x02" + struct.pack(">II", 0x80000056, 0x800c5554))])

    def generated(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "app.hex"
            file.write_text(self.hex)
            # File-only packing must not construct manager/application keys or
            # use a physical/network connection even when a transport exists.
            with patch("ledgerblue.hexLoader.PrivateKey", side_effect=AssertionError("No key generation")), \
                    patch("socket.create_connection", side_effect=AssertionError("No connection")):
                return PACKAGE.emit_apdus(file, self.info)

    def test_real_root_manifest_and_policies(self):
        PACKAGE.configuration()
        from ledgered.manifest import Manifest
        manifest = Manifest.from_string((ROOT / "ledger_app.toml").read_text())
        manifest.check(ROOT)
        self.assertTrue(manifest.app.is_rust)
        self.assertEqual(manifest.app.build_directory, Path("apps/ledger"))
        self.assertEqual(set(manifest.app.devices), {"nanos+", "nanox", "stax", "flex", "apex_p"})

    def test_official_gates_are_explicitly_inactive(self):
        gates = json.loads((ROOT / "apps/ledger/publication/official-gates.json").read_text())
        self.assertIs(gates["active"], False)
        self.assertEqual(len(gates["upstream"]["commit"]), 40)
        self.assertGreaterEqual(len(gates["blockers"]), 7)

    def test_source_manifest_requires_complete_bound_digest_set(self):
        valid = {key: PACKAGE.sha((ROOT / key).read_bytes()) for key in PACKAGE.expected_source_keys()}
        PACKAGE.validate_sources(valid)
        omitted = dict(valid)
        omitted.pop("apps/ledger/src/crypto.rs")
        for source_map in [None, {}, omitted, valid | {"unexpected.rs": "0" * 64},
                           valid | {"Cargo.toml": ""}, valid | {"Cargo.toml": "g" * 64},
                           valid | {"Cargo.toml": "0" * 64}]:
            with self.subTest(source_map=source_map), self.assertRaises(ValueError):
                PACKAGE.validate_sources(source_map)

    def test_strict_tlv(self):
        self.assertEqual(PACKAGE.parse_tlv(self.params)[1], b"Pearl Dev")
        for mutated in [self.params[:-1], self.params + tlv(1, b"other"),
                        self.params + tlv(6, b"dependency"), self.params + b"\x05\x80",
                        b"\x01\x81\x09Pearl Dev" + self.params[11:]]:
            with self.subTest(mutated=mutated.hex()), self.assertRaises(ValueError):
                PACKAGE.parse_tlv(mutated)

    def test_hex_image_and_gap(self):
        image, entry = PACKAGE.parse_hex(self.hex)
        self.assertEqual(image, self.image)
        self.assertEqual(entry, 0x1001)
        script, official_hash = self.generated()
        count, independent_hash = PACKAGE.verify_apdus(script, image, self.info)
        self.assertGreater(count, 5)
        self.assertEqual(independent_hash, official_hash)
        contiguous = bytes(range(16)) + bytes(240) + b"tail"
        expected = hashlib.sha256(struct.pack(">I", self.info["target_id"])
            + PACKAGE.create_parameters(self.info) + contiguous).hexdigest()
        self.assertEqual(official_hash, expected)

    def test_hex_rejects_checksum_overlap_trailing_and_missing_eof(self):
        lines = self.hex.splitlines()
        cases = [self.hex[:-3] + "00\n", "\n".join(lines[:-1]) + "\n",
                 self.hex + lines[1] + "\n", "\n".join(lines[:2] + [lines[1]] + lines[2:]) + "\n"]
        for data in cases:
            with self.subTest(data=data), self.assertRaises(ValueError):
                PACKAGE.parse_hex(data)

    def test_apdu_rejects_privilege_expansion(self):
        script, _ = self.generated()
        for key, value in [("flags", 0x10), ("api_level", 28), ("boot_offset", 3),
                           ("code_length", 255), ("install_params_length", 5)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                PACKAGE.verify_apdus(script, self.image, self.info | {key: value})

    def test_apdu_rejects_delete_ca_unknown_or_signed_commit(self):
        lines = self.generated()[0].splitlines()
        for forbidden in [b"\x0c\x01x", b"\x12\x00", b"\x13", b"\x15" + bytes(32),
                          b"\x09\x01\xff", b"\xff"]:
            with self.subTest(forbidden=forbidden.hex()), self.assertRaises(ValueError):
                PACKAGE.verify_apdus("\n".join(lines[:-1] + [apdu(forbidden)]) + "\n", self.image, self.info)

    def test_apdu_rejects_wrong_data_offset_crc_and_commit(self):
        lines = self.generated()[0].splitlines()
        candidates = []
        for i, line in enumerate(lines):
            raw = bytearray.fromhex(line)
            if raw[5] in (6, 8):
                raw[-1] ^= 1
                candidates.append(lines[:i] + [raw.hex()] + lines[i + 1:])
                if raw[5] == 6:
                    raw = bytearray.fromhex(line)
                    raw[7] ^= 1
                    candidates.append(lines[:i] + [raw.hex()] + lines[i + 1:])
        candidates.extend([lines[:-1], lines + [lines[-1]], lines[:1] + lines[:1] + lines[1:]])
        for changed in candidates:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                PACKAGE.verify_apdus("\n".join(changed) + "\n", self.image, self.info)

    def test_duplicate_ledger_sections_identical_and_conflicting(self):
        # Standalone ARM32 ELF with two same-named metadata sections. No native
        # build artifact is required, so this regression also runs in CI.
        names = b"\x00.shstrtab\x00ledger.target_id\x00"
        first = b"0x33100004\n"
        for second in [first, b"0x33000004\n"]:
            with self.subTest(second=second):
                data_offset = 52 + 4 * 40
                ident = b"\x7fELF\x01\x01\x01" + bytes(9)
                header = struct.pack("<16sHHIIIIIHHHHHH", ident, 2, 40, 1,
                    0, 0, 52, 0, 52, 0, 0, 40, 4, 1)
                section = lambda *fields: struct.pack("<10I", *fields)
                sections = bytes(40)
                sections += section(1, 3, 0, 0, data_offset, len(names), 0, 0, 1, 0)
                offset = data_offset + len(names)
                sections += section(11, 1, 0, 0, offset, len(first), 0, 0, 1, 0)
                sections += section(11, 1, 0, 0, offset + len(first), len(second), 0, 0, 1, 0)
                elf = header + sections + names + first + second
                with self.assertRaisesRegex(ValueError, "Duplicate Ledger metadata"):
                    PACKAGE.inspect_elf(elf, "nanosplus", "mainnet")

    def test_permissions_and_target_checks_on_frozen_elf_when_available(self):
        source = ROOT / "apps/ledger/target/artifacts/pearl-nanosplus-mainnet.elf"
        if not source.exists():
            self.skipTest("Frozen native ELF is an optional local integration input")
        data = source.read_bytes()
        metadata, image, entry, params, info = PACKAGE.inspect_elf(data, "nanosplus", "mainnet")
        self.assertEqual(metadata["app_name"], "Pearl Dev")
        self.assertEqual(info["flags"], 0)
        for device, network in [("nanox", "mainnet"), ("nanosplus", "simnet")]:
            with self.assertRaises(ValueError):
                PACKAGE.inspect_elf(data, device, network)
        # Mutate the actual serialized curve/prefix without rebuilding crypto.
        for index in [0, 1, 2, 9]:
            fields = PACKAGE.parse_tlv(params)
            permission = fields[4]
            changed = bytearray(permission)
            changed[index] ^= 1
            corrupt = data.replace(permission, bytes(changed), 1)
            self.assertNotEqual(corrupt, data)
            with self.assertRaises(ValueError):
                PACKAGE.inspect_elf(corrupt, "nanosplus", "mainnet")


if __name__ == "__main__":
    unittest.main()
