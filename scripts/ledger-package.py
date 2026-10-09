#!/usr/bin/env python3
"""Offline-only install packaging and independent APDU verification. Never opens USB."""
import argparse
import binascii
import fcntl
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import tomllib

from elftools.elf.elffile import ELFFile

ROOT = Path(__file__).resolve().parent.parent
DEVICES = {
    "nanosplus": ("nanos2", 0x33100004, 0),
    "nanox": ("nanox", 0x33000004, 0x200),
    "stax": ("stax", 0x33200004, 0x200),
    "flex": ("flex", 0x33300004, 0x200),
    "apex_p": ("apex_p", 0x33400004, 0x200),
}
NETWORKS = {
    "mainnet": ("Pearl Dev", 808276, None),
    "testnet": ("Pearl Test Dev", 1, "0"),
    "testnet2": ("Pearl Test2 Dev", 1, "1"),
    "regtest": ("Pearl Reg Dev", 1, "2"),
    "simnet": ("Pearl Sim Dev", 1, "3"),
}
SDK = "4123d2dc85a2085115e6a36826460a9fe742cfb1"
SECURE_SDK = "6709cd2bdfebb224ee070f7c1211b54254262579"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def parse_tlv(blob):
    """Strict canonical SDK TLV decoder; rejects duplicates/unknown permissions."""
    fields, offset = {}, 0
    while offset < len(blob):
        require(offset + 2 <= len(blob), "Truncated install TLV")
        tag, length = blob[offset:offset + 2]
        offset += 2
        if length >= 128:
            size = length & 127
            require(size in (1, 2) and offset + size <= len(blob), "Invalid TLV length")
            length = int.from_bytes(blob[offset:offset + size], "big")
            require(length >= (128 if size == 1 else 256), "Noncanonical TLV length")
            offset += size
        require(tag in (1, 2, 3, 4) and tag not in fields, "Unknown/duplicate install TLV")
        require(offset + length <= len(blob), "Truncated install TLV value")
        fields[tag] = blob[offset:offset + length]
        offset += length
    require(set(fields) == {1, 2, 3, 4}, "Missing install TLV")
    return fields


def configuration():
    manifest = tomllib.loads((ROOT / "ledger_app.toml").read_text())
    require(manifest["app"] == {
        "build_directory": "./apps/ledger", "sdk": "Rust",
        "devices": ["nanos+", "nanox", "stax", "flex", "apex_p"],
    }, "Unexpected root Ledger manifest")
    cargo = tomllib.loads((ROOT / "apps/ledger/Cargo.toml").read_text())
    metadata = cargo["package"]["metadata"]["ledger"]
    require(metadata["curve"] == ["secp256k1"] and metadata["flags"] == "0",
            "Unexpected Cargo curve or base privilege expansion")
    require(not metadata.get("path_slip21"), "Unexpected SLIP21 permission")
    for name, (app_name, coin, variant) in NETWORKS.items():
        effective = metadata | (metadata["variants"][variant] if variant else {})
        require(effective["name"] == app_name and effective["path"] == [f"86'/{coin}'"],
                f"Unexpected {name} app identity or derivation prefix")
        require(effective["curve"] == ["secp256k1"] and effective["flags"] == "0"
                and not effective.get("path_slip21"), "Variant permission expansion")
    return cargo


def expected_source_keys():
    # Mirrors the frozen build-manifest inputs() contract. Changing that
    # contract requires a reviewed build/provenance migration, not omission.
    fixed = {
        "Cargo.toml", "apps/ledger/Cargo.toml", "apps/ledger/Cargo.lock",
        "apps/ledger/rust-toolchain.toml", "crates/pearl-core/Cargo.toml",
        "apps/ledger/patches/strict-transport.patch", "scripts/ledger-build.sh",
        "scripts/ledger-prepare-sdk.sh", "scripts/ledger-build-manifest.py",
    }
    for folder in ("apps/ledger/src", "apps/ledger/icons", "apps/ledger/.cargo", "crates/pearl-core/src"):
        fixed.update(str(path.relative_to(ROOT)) for path in (ROOT / folder).rglob("*") if path.is_file())
    return fixed


def validate_sources(sources):
    require(isinstance(sources, dict) and set(sources) == expected_source_keys(),
            "Incomplete or unexpected build source key set")
    for path, digest in sources.items():
        require(isinstance(digest, str) and len(digest) == 64
                and all(char in "0123456789abcdef" for char in digest), "Invalid source digest")
        source = (ROOT / path).resolve()
        require(source.is_relative_to(ROOT) and source.is_file() and sha(source.read_bytes()) == digest,
                f"Build source no longer matches: {path}")


def inspect_elf(data, device, network):
    elf = ELFFile(io.BytesIO(data))
    require(elf.elfclass == 32 and elf.little_endian and elf["e_machine"] == "EM_ARM",
            "Expected ARM32 little-endian Ledger ELF")
    metadata = {}
    image = {}
    for section in elf.iter_sections():
        if section.name.startswith("ledger."):
            require(section.name[7:] not in metadata, "Duplicate Ledger metadata section")
            raw = section.data()
            require(raw.endswith(b"\n") and b"\n" not in raw[:-1], "Invalid Ledger metadata string")
            metadata[section.name[7:]] = raw[:-1].decode("ascii")
        if section["sh_flags"] & 2 and section["sh_type"] != "SHT_NOBITS" and section["sh_size"]:
            require(section["sh_type"] == "SHT_PROGBITS", "Unexpected loadable section")
            for index, value in enumerate(section.data(), section["sh_addr"]):
                require(index not in image, "Overlapping ELF load data")
                image[index] = value
    target, target_id, flags = DEVICES[device]
    app_name, coin, _ = NETWORKS[network]
    for field, expected in {"target": target, "target_id": hex(target_id),
                            "app_name": app_name, "api_level": "27", "sdk_hash": SECURE_SDK}.items():
        require(metadata.get(field) == expected, f"ELF {field} mismatch")
    require(int(metadata["app_flags"], 0) == flags, "Unexpected effective ELF flags")
    symbols = {}
    required = {"_nvram_data", "_envram_data", "_install_parameters", "_einstall_parameters"}
    for symbol in elf.get_section_by_name(".symtab").iter_symbols():
        if symbol.name in required:
            require(symbol.name not in symbols, "Duplicate install symbol")
            symbols[symbol.name] = symbol["st_value"]
    require(set(symbols) == required and image, "Missing ELF install symbols/image")
    low, high = min(image), max(image) + 1
    require(0 < high - low <= 8 * 1024 * 1024, "Unreasonable image span")
    first, last = symbols["_install_parameters"], symbols["_einstall_parameters"]
    require(low <= symbols["_nvram_data"] <= symbols["_envram_data"] == first < last == high,
            "Invalid ELF data/install region boundaries")
    params = bytes(image[i] for i in range(first, last))
    tlv = parse_tlv(params)
    require(tlv[1] == app_name.encode("ascii"), "Install TLV name mismatch")
    require(tlv[2] == metadata["app_version"].encode("ascii"), "Install version mismatch")
    require(tlv[3], "Empty install icon")
    require(tlv[4] == b"\x01\x02" + struct.pack(">II", 0x80000056, 0x80000000 | coin),
            "Unexpected curve/path/wildcard permission expansion")
    entry = elf["e_entry"]
    require(entry & 1 and low <= entry - 1 < first, "Invalid app entry point")
    info = {
        "target_id": target_id, "api_level": 27, "flags": flags,
        "code_length": symbols["_nvram_data"] - low,
        "data_length": first - symbols["_nvram_data"],
        "install_params_length": last - first, "boot_offset": (entry - low) | 1,
        "load_length": high - low,
    }
    return metadata, image, entry, params, info


def parse_hex(text):
    image, base, entry, ended = {}, None, None, False
    for line in text.splitlines():
        require(not ended and line.startswith(":"), "Unexpected HEX record")
        record = bytes.fromhex(line[1:])
        require(len(record) >= 5 and len(record) == record[0] + 5 and sum(record) % 256 == 0,
                "Invalid HEX length/checksum")
        length, address, kind = record[0], int.from_bytes(record[1:3], "big"), record[3]
        data = record[4:-1]
        if kind == 0:
            require(base is not None and address + length <= 65536, "Invalid HEX data address")
            for index, value in enumerate(data, base + address):
                require(index not in image, "Overlapping HEX data")
                image[index] = value
        elif kind == 4:
            require(address == 0 and length == 2, "Invalid HEX upper address")
            base = int.from_bytes(data, "big") << 16
        elif kind == 5:
            require(address == 0 and length == 4 and entry is None, "Invalid HEX entry")
            entry = int.from_bytes(data, "big")
        elif kind == 1:
            require(address == 0 and length == 0, "Invalid HEX EOF")
            ended = True
        else:
            raise ValueError("Unsupported HEX record type")
    require(ended and entry is not None and image, "Incomplete HEX")
    return image, entry


def create_parameters(info):
    return struct.pack(">BIIIII", *(info[k] for k in (
        "api_level", "code_length", "data_length", "install_params_length", "flags", "boot_offset")))


def verify_apdus(text, image, info):
    """Decode load commands independently of ledgerblue and reconstruct all bytes."""
    low = min(image)
    reconstructed, segment, chunk_data = {}, None, bytearray()
    state, count = "create", 0
    for line in text.splitlines():
        apdu = bytes.fromhex(line)
        require(len(apdu) >= 6 and apdu[:4] == b"\xe0\x00\x00\x00"
                and len(apdu) == apdu[4] + 5 and apdu[4] <= 240, "Invalid offline APDU envelope")
        data = apdu[5:]
        instruction = data[0]
        count += 1
        if state == "create":
            require(data == b"\x0b" + create_parameters(info), "Create-app parameter mismatch")
            state = "select"
        elif instruction == 5 and state == "select":
            require(len(data) == 5, "Bad segment selector")
            segment = int.from_bytes(data[1:], "big")
            require(segment < info["load_length"], "Segment outside image")
            chunk_data = bytearray()
            state = "load"
        elif instruction == 6 and state == "load":
            require(len(data) > 3 and int.from_bytes(data[1:3], "big") == len(chunk_data),
                    "Nonsequential chunk offset")
            require(segment + len(chunk_data) + len(data) - 3 <= info["load_length"],
                    "Chunk outside image")
            for index, value in enumerate(data[3:], low + segment + len(chunk_data)):
                require(index not in reconstructed, "Duplicate APDU image bytes")
                reconstructed[index] = value
            chunk_data.extend(data[3:])
        elif instruction == 7 and state == "load":
            require(data == b"\x07" and chunk_data, "Invalid segment flush")
            state = "crc"
        elif instruction == 8 and state == "crc":
            require(data == b"\x08\x00\x00" + struct.pack(">IH", len(chunk_data),
                    binascii.crc_hqx(chunk_data, 0xffff)), "Segment CRC mismatch")
            state = "select"
        elif instruction == 9 and state == "select":
            require(data == b"\x09", "Signed/extended commit not permitted")
            state = "done"
        else:
            raise ValueError("Unexpected APDU sequence, deletion, trust or other operation")
    require(state == "done" and reconstructed == image, "APDU image differs from ELF")
    contiguous = bytes(image.get(i, 0) for i in range(low, low + info["load_length"]))
    digest = sha(struct.pack(">I", info["target_id"]) + create_parameters(info) + contiguous)
    return count, digest


class FileOnlySink:
    """No physical transport, authentication, credentials or loading functionality."""
    def __init__(self):
        self.lines = []

    def exchange(self, apdu):
        self.lines.append(bytes(apdu).hex())
        return bytearray()

    def apduMaxDataSize(self):
        return 240


def emit_apdus(hex_path, info):
    require(importlib.metadata.version("ledgerblue") == "0.1.58", "Pin ledgerblue 0.1.58")
    from ledgerblue.hexLoader import HexLoader
    from ledgerblue.hexParser import IntelHexParser, IntelHexPrinter
    from ledgerblue.hashApp import compute_app_hash
    require("ledgerblue.comm" not in sys.modules, "Hardware transport unexpectedly imported")
    sink = FileOnlySink()
    loader = HexLoader(sink, 0xE0, secure=False)
    loader.createApp(info["code_length"], info["api_level"], info["data_length"],
                     info["install_params_length"], info["flags"], info["boot_offset"])
    loader.load(0, 240, IntelHexPrinter(IntelHexParser(str(hex_path))),
                targetId=info["target_id"], targetVersion="", doCRC=True)
    loader.commit()
    digest, official_info = compute_app_hash(str(hex_path), info["target_id"], info["api_level"],
        info["flags"], info["data_length"], info["install_params_length"])
    require(official_info == info, "Official hash metadata differs from independently parsed ELF")
    return "\n".join(sink.lines) + "\n", digest


def package(device, network, elf_path, destination, objcopy):
    # Serialize cooperating publishers before checking output existence; never
    # replace an earlier package directory, even when labels differ.
    destination.parent.mkdir(parents=True, exist_ok=True)
    with (destination.parent / f".{destination.name}.package.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _package(device, network, elf_path, destination, objcopy)


def _package(device, network, elf_path, destination, objcopy):
    packager_hash = sha(Path(__file__).read_bytes())
    require(importlib.metadata.version("pyelftools") == "0.33", "Pin pyelftools 0.33")
    cargo = configuration()
    require(not destination.exists(), "Output must be a new directory; never replace a reviewed package")
    destination.parent.mkdir(parents=True, exist_ok=True)
    lock_path = ROOT / f"apps/ledger/target/.build-{device}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        elf_bytes = elf_path.read_bytes()
        build_path = elf_path.with_suffix(".build.json")
        build_bytes = build_path.read_bytes()
    build = json.loads(build_bytes)
    require(build["device"] == device and build["network"] == network
            and build["elfSha256"] == sha(elf_bytes), "ELF/build generation or target/network mismatch")
    require(build["rustSdk"] == SDK and build["secureSdk"] == SECURE_SDK, "Unexpected SDK provenance")
    validate_sources(build.get("sources"))
    metadata, image, entry, params, info = inspect_elf(elf_bytes, device, network)
    require(metadata["app_version"] == cargo["package"]["version"], "Cargo/ELF version mismatch")
    temporary = Path(tempfile.mkdtemp(prefix=".pearl-package-", dir=destination.parent))
    try:
        base = f"pearl-{device}-{network}"
        local_elf, local_hex = temporary / f"{base}.elf", temporary / f"{base}.hex"
        local_elf.write_bytes(elf_bytes)
        (temporary / f"{base}.build.json").write_bytes(build_bytes)
        subprocess.run([objcopy, str(local_elf), "-O", "ihex", str(local_hex)], check=True,
                       capture_output=True, text=True)
        actual_image, actual_entry = parse_hex(local_hex.read_text())
        require(actual_image == image and actual_entry == entry, "HEX differs from ELF load bytes/entry")
        apdus, official_hash = emit_apdus(local_hex, info)
        apdu_count, verified_hash = verify_apdus(apdus, image, info)
        require(official_hash == verified_hash, "Independent/official application hash mismatch")
        (temporary / f"{base}.apdu").write_text(apdus)
        (temporary / f"{base}.sha256").write_text(verified_hash + "\n")
        require(sha(elf_path.read_bytes()) == sha(elf_bytes), "ELF changed during packaging")
        require(sha(Path(__file__).read_bytes()) == packager_hash, "Packager source changed during execution")
        validate_sources(build.get("sources"))
        from ledgerblue import hexLoader, hexParser, hashApp
        report = {
            "status": "offline-verified-not-installed", "device": device, "network": network,
            "retailSideloadSupported": device != "nanox",
            "nanoXRestriction": "Retail Nano X cannot sideload; vendor-controlled review/testing only",
            "elfSha256": sha(elf_bytes), "applicationHash": verified_hash,
            "metadata": metadata, "effectiveParameters": info,
            "curve": "secp256k1", "derivationPrefix": f"86'/{NETWORKS[network][1]}'",
            "installTlvSha256": sha(params), "iconTlvSha256": sha(parse_tlv(params)[3]),
            "apduCount": apdu_count, "deleteExistingApp": False,
            "sourceBuildManifestSha256": sha(build_bytes),
            "packagerSha256": packager_hash,
            "tools": {
                "python": sys.version, "ledgerblue": "0.1.58", "pyelftools": importlib.metadata.version("pyelftools"),
                "objcopy": subprocess.check_output([objcopy, "--version"], text=True).strip(),
                "ledgerblueSources": {module.__name__: sha(Path(module.__file__).read_bytes())
                                      for module in (hexLoader, hexParser, hashApp)},
            },
            "files": {p.name: sha(p.read_bytes()) for p in sorted(temporary.iterdir())},
            "scope": "Offline APDU/HEX inspection only; no hardware transport, credentials, CA, OS flashing or vendor authorization",
        }
        (temporary / "package.json").write_text(json.dumps(report, indent=2) + "\n")
        require(not destination.exists(), "Output appeared concurrently")
        os.rename(temporary, destination)
        return report
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-configuration", action="store_true")
    parser.add_argument("--device", choices=DEVICES)
    parser.add_argument("--network", choices=NETWORKS)
    parser.add_argument("--elf", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--objcopy", default=os.environ.get("LEDGER_OBJCOPY", "arm-none-eabi-objcopy"))
    args = parser.parse_args()
    if args.check_configuration:
        configuration()
        print("Root Ledger manifest and all Cargo network policies verified; publication gates remain pending")
        return
    if not all((args.device, args.network, args.output)):
        parser.error("--device, --network and --output are required")
    elf = args.elf or ROOT / f"apps/ledger/target/artifacts/pearl-{args.device}-{args.network}.elf"
    print(json.dumps(package(args.device, args.network, elf.resolve(), args.output.resolve(), args.objcopy), indent=2))


if __name__ == "__main__":
    main()
