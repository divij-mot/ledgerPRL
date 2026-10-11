#!/usr/bin/env python3
"""Inspect compiled Ledger ELF identity without executing it or contacting a device."""
import hashlib
import json
from pathlib import Path
import struct
import sys

EXPECTED = {"mainnet": "Pearl", "regtest": "Pearl Reg"}


def inspect(path: Path, network: str, *, version: str = "0.1.0",
            target: str = "nanos2", flags: str = "0x40") -> dict:
    data = path.read_bytes()
    if any(value in data for value in (b"prl-dev", b"Pearl Dev", b"Pearl Reg Dev", b"Development app.")):
        raise ValueError("Development identity remains in compiled artifact")
    if data[:6] != b"\x7fELF\x01\x01":
        raise ValueError("Expected little-endian ELF32")
    offset = struct.unpack_from("<I", data, 32)[0]
    size, count, string_index = struct.unpack_from("<HHH", data, 46)
    if size != 40 or string_index >= count or offset + size * count > len(data):
        raise ValueError("Invalid ELF section table")
    sections = [struct.unpack_from("<10I", data, offset + i * size) for i in range(count)]

    def section_bytes(section: tuple) -> bytes:
        start, length = section[4:6]
        if start + length > len(data):
            raise ValueError("ELF section exceeds file")
        return data[start:start + length]

    names = section_bytes(sections[string_index])
    metadata = {}
    for section in sections:
        name = names[section[0]:].split(b"\0", 1)[0].decode("ascii")
        if name.startswith("ledger."):
            if name in metadata:
                raise ValueError("Duplicate Ledger metadata section")
            metadata[name] = section_bytes(section).decode("ascii")
    for name, expected in {
        "ledger.app_name": EXPECTED[network],
        "ledger.app_version": version,
        "ledger.api_level": "27",
        "ledger.target": target,
        "ledger.app_flags": flags,
        "ledger.sdk_hash": "6709cd2bdfebb224ee070f7c1211b54254262579",
    }.items():
        if metadata.get(name) != expected:
            raise ValueError(f"Unexpected {name}: {metadata.get(name)!r}")
    return {"network": network, "sha256": hashlib.sha256(data).hexdigest(), "metadata": metadata}


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in EXPECTED:
        raise SystemExit("usage: inspect-metadata.py mainnet|regtest app.elf")
    print(json.dumps(inspect(Path(sys.argv[2]), sys.argv[1]), indent=2))
