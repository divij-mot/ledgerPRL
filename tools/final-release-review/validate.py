#!/usr/bin/env python3
"""Read-only, artifact-specific crosscheck of final502 qualification and rebuild evidence.

No builds, emulators, devices, network, or modification of inputs. Requires original
qualification/reproduction run directories, including binaries and raw JSON outputs.
This verifies recorded evidence and independently reruns the pinned APDU decoder;
it does not replay native/runtime tests or establish human/hardware approval.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

CRYPTO = "50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1"
VERIFIER = "1576e2760092dab80f719140e190bf75fea7b6545ca36bafbc483d1a4941f600"
MODELS = {"nanosp": "nanosplus", "nanox": "nanox", "stax": "stax", "flex": "flex", "apex_p": "apex_p"}
NETWORKS = ("mainnet", "testnet", "testnet2", "regtest", "simnet")
SUITES = ("canonical", "warnings", "faults", "node-16", "node-parity", "stability")
SOURCES = {"Cargo.toml", "apps/ledger/Cargo.toml", "apps/ledger/Cargo.lock", "apps/ledger/rust-toolchain.toml", "crates/pearl-core/Cargo.toml", "apps/ledger/patches/strict-transport.patch", "scripts/ledger-build.sh", "scripts/ledger-prepare-sdk.sh", "scripts/ledger-build-manifest.py"}
TESTS = {"apps/companion/src/bridge.ts", "apps/companion/src/operation.ts", "fixtures/protocol-v1.json", "package-lock.json", "tests/e2e/native-node-roundtrip.ts", "tests/e2e/parity-vectors.json", "tests/e2e/retain-evidence.py"}

def require(ok, label):
    if not ok:
        raise ValueError(label)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text())

def inside(root, relative):
    p = (root / relative).resolve()
    require(p.is_relative_to(root), "Input path escapes requested root")
    return p

def hashes(repo, keys):
    return {k: sha(inside(repo, k)) for k in sorted(keys)}

def indexed(rows, fields, expected):
    result = {tuple(row[k] for k in fields): row for row in rows}
    require(len(result) == len(rows) and set(result) == expected, "Missing/duplicate/unexpected matrix entries")
    return result

def verify(args):
    repo, run, repro = args.repo.resolve(), args.qualification_dir.resolve(), args.reproduction_dir.resolve()
    output = args.output.resolve()
    require(not any(output.is_relative_to(p) for p in (repo, run, repro)), "Output must be outside all input trees")
    require(not output.exists(), "Output must be new")
    initial = {"qualification": sha(run / "qualification-report.json"), "reproduction": sha(repro / "canonical-all25-comparison.json"), "identities": sha(repo / "tools/compiled-cleanup-review/identities.json")}
    q = read(run / "qualification-report.json")
    rr = read(repro / "canonical-all25-comparison.json")
    ids = read(repo / "tools/compiled-cleanup-review/identities.json")
    require(q["cryptoSha256"] == ids["cryptoSha256"] == sha(repo / "apps/ledger/src/crypto.rs") == CRYPTO, "Wrong crypto source")
    source_keys = set(SOURCES)
    for folder in ("apps/ledger/src", "apps/ledger/icons", "apps/ledger/.cargo", "crates/pearl-core/src"):
        source_keys.update(str(p.relative_to(repo)) for p in (repo / folder).rglob("*") if p.is_file())
    sources = hashes(repo, source_keys)
    require(read(run / "sources-before.json") == rr["sourceManifest"] == sources, "Native source inventory/hash mismatch")
    require(q["nativeSourceMapSha256"] == sha(run / "sources-before.json") and q["nativeSourcesUnchanged"] is True, "Source-map binding mismatch")
    for p in run.glob("sources-after-*.json"):
        require(read(p) == sources, "Native sources changed during qualification")
    test_keys = set(TESTS)
    for folder in ("packages/sdk/src", "packages/wallet/src"):
        test_keys.update(str(p.relative_to(repo)) for p in (repo / folder).glob("*.ts"))
    test_keys.update(str(p.relative_to(repo)) for p in (repo / "apps/ledger/tests").iterdir() if p.suffix in (".ts", ".py") or p.name == "tsconfig.json")
    tests = hashes(repo, test_keys)
    expected_variants = {(d, n) for d in MODELS.values() for n in NETWORKS}
    variants = indexed(q["buildNetworkPackageMatrix"], ("device", "network"), expected_variants)
    identities = indexed(ids["artifacts"], ("device", "network"), expected_variants)
    rebuilt = indexed(rr["variants"], ("device", "network"), expected_variants)
    require(rr["count"] == 25, "Rebuild count mismatch")
    verifier_path = repo / "apps/ledger/tests/package-independent.py"
    require(sha(verifier_path) == VERIFIER, "Independent APDU decoder changed")
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("package_independent_review", verifier_path)
    decoder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(decoder)
    build_results = []
    for (device, network), row in sorted(variants.items()):
        label, base = f"{device}-{network}", f"pearl-{device}-{network}"
        elf, manifest = run / "artifacts" / f"{base}.elf", run / "artifacts" / f"{base}.build.json"
        identity, rebuilt_row, m = identities[device, network], rebuilt[device, network], read(manifest)
        digest = sha(elf)
        require(digest == row["elfSha256"] == identity["elfSha256"] == m["elfSha256"] == rebuilt_row["elfSha256"], f"{label}: ELF mismatch")
        require(sha(manifest) == row["buildManifestSha256"] == identity["manifestSha256"], f"{label}: manifest mismatch")
        require(m["sources"] == sources and (m["device"], m["network"]) == (device, network), f"{label}: source/target mismatch")
        require(m["rustSdk"] == identity["rustSdk"] == "4123d2dc85a2085115e6a36826460a9fe742cfb1" and m["secureSdk"] == identity["secureSdk"] == "6709cd2bdfebb224ee070f7c1211b54254262579", f"{label}: SDK mismatch")
        nd = run / "network-runtime" / label
        n = read(nd / "evidence.json")
        require(sha(nd / "evidence.json") == row["networkSmokeEvidenceSha256"], f"{label}: network evidence mismatch")
        require(n["status"] == row["status"] == "passed" and n["firmware"]["sha256"] == sha(nd / "tested-firmware.elf") == digest, f"{label}: network snapshot/status mismatch")
        require(n["capabilities"]["network"] == n["account"]["network"] == network and n["capabilities"]["maxInputs"] == 16 and n["capabilities"]["maxBundleSize"] == 1507, f"{label}: capabilities mismatch")
        require(n["addresses"] == row["addresses"] and set(n["addresses"]) == {"0", "1"} and len(n["checks"]) == 4, f"{label}: network checks mismatch")
        require(n["sourceSha256"]["harness"] == sha(run / "tools/network-smoke.mts") and n["sourceSha256"]["driver"] == tests["apps/ledger/tests/speculos-driver.ts"] and n["sourceSha256"]["lockfile"] == tests["package-lock.json"], f"{label}: network test source mismatch")
        require(n["sdkSourceHashes"] == {Path(k).name: v for k, v in tests.items() if k.startswith("packages/sdk/src/")}, f"{label}: SDK source inventory mismatch")
        pd, fresh = run / "packages" / label, repro / "control-packages" / label
        package, prior = read(pd / "package.json"), read(run / "packages" / f"{label}-independent.json")
        require(sha(pd / "package.json") == row["packageEvidenceSha256"] and sha(run / "packages" / f"{label}-independent.json") == row["independentPackageEvidenceSha256"], f"{label}: package report hash mismatch")
        require(package["status"] == "offline-verified-not-installed" and prior["status"].startswith("PASS:"), f"{label}: package status mismatch")
        expected_files = {f"{base}.{ext}" for ext in ("elf", "build.json", "hex", "apdu", "sha256")}
        require(set(package["files"]) == expected_files, f"{label}: package inventory mismatch")
        for name, expected_hash in package["files"].items():
            require(sha(pd / name) == expected_hash, f"{label}: package file hash mismatch")
            require((pd / name).read_bytes() == (fresh / name).read_bytes(), f"{label}: canonical rebuild bytes differ")
        require((pd / "package.json").read_bytes() == (fresh / "package.json").read_bytes(), f"{label}: canonical package report differs")
        require(elf.read_bytes() == (repro / "control-artifacts" / f"{base}.elf").read_bytes() == (pd / f"{base}.elf").read_bytes(), f"{label}: control ELF differs")
        require(manifest.read_bytes() == (repro / "control-artifacts" / f"{base}.build.json").read_bytes(), f"{label}: control manifest differs")
        for candidate_elf, candidate_apdu in ((elf, pd / f"{base}.apdu"), (repro / "control-artifacts" / f"{base}.elf", fresh / f"{base}.apdu")):
            decoded = decoder.verify(candidate_elf, candidate_apdu)
            require(decoded["elfSha256"] == digest and decoded["appHash"] == row["applicationHash"] == prior["appHash"] == package["applicationHash"] == rebuilt_row["applicationHash"], f"{label}: fresh independent application hash mismatch")
            require(decoded["apduSha256"] == row["apduSha256"] == prior["apduSha256"] and decoded["network"] == network and decoded["apiLevel"] == row["apiLevel"] == 27, f"{label}: fresh independent APDU mismatch")
        info = decoder.elf_info(elf)
        require(sha(elf) == rebuilt_row["elfSha256"] and len(info["raw"]) == rebuilt_row["elfBytes"] and hashlib.sha256(info["image"]).hexdigest() == rebuilt_row["loadImageSha256"] and len(info["image"]) == rebuilt_row["loadImageBytes"], f"{label}: load image summary mismatch")
        require(all(v is True for v in rebuilt_row["comparisons"].values()), f"{label}: reported comparison failed")
        build_results.append({"device": device, "network": network, "elfSha256": digest, "networkChecks": 4, "packageFilesVerified": 5, "canonicalBytesEqual": True, "independentApduDecodes": 2})
    expected_suites = {(m, s) for m in MODELS for s in SUITES}
    runtime = indexed(q["runtimeMatrix"], ("model", "suite"), expected_suites)
    runner = indexed(read(run / "runtime-summary.json")["results"], ("model", "suite"), expected_suites)
    runtime_results = []
    for (model, suite), row in sorted(runtime.items()):
        label, p = f"{model}-{suite}", run / "runtime" / f"{model}-{suite}"
        r = runner[model, suite]
        epath = p / ("summary.json" if suite == "stability" else "evidence.json")
        e = read(epath)
        require(sha(epath) == row["evidenceSha256"], f"{label}: evidence hash mismatch")
        require(row["status"] == r["status"] == "passed" and r["exitCode"] == 0, f"{label}: runner status mismatch")
        require(read(p / "test-source-hashes-before.json") == read(p / "test-source-hashes-after.json") == tests, f"{label}: test source inventory/hash mismatch")
        digest = variants[MODELS[model], "simnet"]["elfSha256"]
        require(digest == row["elfSha256"] == r["elfSha256"], f"{label}: runtime artifact mismatch")
        snapshots = list(p.rglob("*.elf"))
        expected_count = (16 if model in ("nanosp", "nanox") else 15) if suite == "faults" else 1
        require(len(snapshots) == row["snapshotCount"] == r["snapshotCount"] == expected_count and all(sha(x) == digest for x in snapshots), f"{label}: snapshot bytes/count mismatch")
        for entry in e if isinstance(e, list) else [e]:
            require(entry["status"] == "passed" and entry["firmware"]["sha256"] == digest, f"{label}: underlying status/artifact mismatch")
        result = {"model": model, "suite": suite, "evidenceSha256": sha(epath), "snapshotsVerified": expected_count}
        if suite == "faults":
            names = [x["name"] for x in e]
            require(names == row["cases"] and len(set(names)) == expected_count, f"{label}: fault count mismatch")
            result["faultCases"] = len(names)
        elif suite in ("canonical", "warnings"):
            require(e["checks"] == row["checks"] and len(set(e["checks"])) == (6 if suite == "canonical" else 5), f"{label}: test check count mismatch")
            result["checks"] = len(e["checks"])
        elif suite.startswith("node-"):
            tx = e["transaction"]
            inputs = 16 if suite == "node-16" else 4
            require(e["network"] == "simnet" and e["inputCount"] == tx["inputs"] == inputs and len(tx["signatures"]) == inputs and tx == row["transaction"], f"{label}: transaction summary mismatch")
            require(len(e["cases"]) == row["caseCount"] == 22 and all(x["status"] == "passed" for x in e["cases"]), f"{label}: node case count/status mismatch")
            require(len({x["name"] for x in e["cases"]}) == 22, f"{label}: duplicate node cases")
            if suite == "node-parity":
                require(e["parityCoverage"] == row["parityCoverage"] and {(v["internalParity"], v["outputParity"]) for v in e["parityCoverage"]} == {(0, 0), (0, 1), (1, 0), (1, 1)}, f"{label}: parity coverage mismatch")
            result.update(nodeCases=22, finalTransactionSignatures=inputs)
        else:
            records = e["records"]
            require(len(records) == e["completedSessions"] == e["requestedSessions"] == row["completedSessions"] == 20 and [x["round"] for x in records] == list(range(1, 21)), f"{label}: session count/index mismatch")
            require(all(x["status"] == "passed" for x in records) and e["failure"] is None and e["buildKind"] == "release-stability", f"{label}: stability failure/build-kind mismatch")
            require(dict(Counter(x["kind"] for x in records)) == e["sessionKinds"] == row["sessionKinds"], f"{label}: session kind count mismatch")
            complete = sum(x.get("verifiedSignatures", 0) for x in records if x["kind"] != "partial-signature-abort")
            partial = sum(x.get("verifiedSignatures", 0) for x in records if x["kind"] == "partial-signature-abort")
            require({"complete": complete, "partial": partial} == e["checkedSignatures"] == row["checkedSignatures"], f"{label}: signature totals mismatch")
            require(e["sourceUnchanged"] is True and e["apduCount"] == row["apduCount"], f"{label}: stability source/APDU mismatch")
            result.update(sessions=20, completeSignatures=complete, partialSignatures=partial)
        runtime_results.append(result)
    log = (run / "package-tests.log").read_text()
    require(sha(run / "package-tests.log") == q["packagerUnitTests"]["logSha256"] and q["packagerUnitTests"]["passed"] == 11 and len(re.findall(r"^test_.* \.\.\. ok$", log, re.M)) == 11 and "\nOK\n" in log and "skipped" not in log, "Package test log count/status mismatch")
    require(initial == {"qualification": sha(run / "qualification-report.json"), "reproduction": sha(repro / "canonical-all25-comparison.json"), "identities": sha(repo / "tools/compiled-cleanup-review/identities.json")}, "Reports changed during check")
    require(hashes(repo, source_keys) == sources and hashes(repo, test_keys) == tests, "Live sources changed during check")
    result = {"status": "PASS", "scope": "Recorded provenance/count/status verification and fresh pinned independent APDU decode; not a runtime/hardware replay", "cryptoSha256": CRYPTO, "inputReportSha256": initial, "nativeSourceFilesVerified": len(sources), "runtimeSourceFilesVerifiedPerSuite": len(tests), "buildNetworkPackageVariants": len(build_results), "networkReadOnlyChecks": sum(x["networkChecks"] for x in build_results), "independentPackageDecodes": sum(x["independentApduDecodes"] for x in build_results), "runtimeSuites": len(runtime_results), "runtimeSnapshotsVerified": sum(x["snapshotsVerified"] for x in runtime_results), "faultCases": sum(x.get("faultCases", 0) for x in runtime_results), "nodeCases": sum(x.get("nodeCases", 0) for x in runtime_results), "nodeFinalTransactionSignatures": sum(x.get("finalTransactionSignatures", 0) for x in runtime_results), "stabilitySessions": sum(x.get("sessions", 0) for x in runtime_results), "stabilitySignatures": sum(x.get("completeSignatures", 0) + x.get("partialSignatures", 0) for x in runtime_results), "packagerUnitTests": 11, "variants": build_results, "runtime": runtime_results, "limits": ["Native runtime not replayed", "Package decoder reused at a pinned reviewed hash", "Canonical logical-path rebuild only; arbitrary-prefix reproducibility is not established", "No physical device, loaded-account browser, real IndexedDB, human audit, or vendor approval"]}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("repo", "qualification-dir", "reproduction-dir", "output"):
        p.add_argument("--" + name, required=True, type=Path)
    try:
        result = verify(p.parse_args())
    except (ValueError, KeyError, OSError, TypeError) as e:
        p.exit(1, f"FAIL: {e}\n")
    print(json.dumps({k: v for k, v in result.items() if k not in ("variants", "runtime")}, indent=2))

if __name__ == "__main__":
    main()
