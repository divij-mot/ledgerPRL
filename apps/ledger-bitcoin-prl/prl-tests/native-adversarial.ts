/** Native policy rejection with cryptographically honest Merkle proofs of hostile data. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Buffer } from "buffer";
import { Emulator, type Model } from "./emulator.ts";
import {
  bundleFromJson,
  SpeculosTransport,
  u32,
  u64,
  concat,
  fromHex,
  MAX_GRAINS,
  sha256,
} from "../../../packages/sdk/src/index.ts";
import {
  buildPrlPsbt,
  PRL_NETWORK_KEY,
} from "../../../packages/bitcoin-prl-adapter/src/index.ts";
import { WalletPolicy } from "../../../packages/bitcoin-prl-adapter/src/upstream/policy.ts";
import {
  apdu,
  response,
  publicAccount,
  clonePsbt,
  rawSign,
} from "./raw-protocol.ts";
const root = resolve(import.meta.dirname, "../../..");
const model = (process.env.SPECULOS_MODEL ?? "nanosp") as Model;
const target = model === "nanosp" ? "nanos2" : model;
const output =
  process.env.PEARL_EVIDENCE ??
  (await mkdtemp("/workspace/shared/prl-bitcoin-adversarial-"));
const elf =
  process.env.PEARL_APP_ELF ??
  join(root, `apps/ledger-bitcoin-prl/build/${target}/bin/app.elf`);
const emulator = new Emulator(
  model,
  elf,
  output,
  Number(process.env.SPECULOS_API_PORT ?? 5121),
);
const evidence: { case: string; status: string; commands?: number }[] = [];
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
try {
  await emulator.start();
  const transport = new SpeculosTransport(emulator.url, 30000);
  const { account, policy } = await publicAccount(transport, "regtest", (op) =>
    emulator.approve(op, "Approve public key", "account"),
  );
  const good = buildPrlPsbt(
    bundleFromJson({ ...fixture.bundle, network: "regtest" }),
    account,
  );
  const reject = async (
    name: string,
    mutate: (p: ReturnType<typeof clonePsbt>) => void,
    opts: Parameters<typeof rawSign>[3] = {},
  ) => {
    const p = clonePsbt(good);
    mutate(p);
    const result = await rawSign(transport, p, policy, {
      ...opts,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(result.yields.length, 0, `${name}: native signature escaped`);
    assert(
      [0x6a80, 0x6a82, 0x6a87].includes(result.status),
      `${name}: unexpected status0x${result.status.toString(16)}`,
    );
    evidence.push({
      case: name,
      status: `0x${result.status.toString(16)}`,
      commands: result.commands,
    });
    console.log(`PASS ${name}`);
  };
  for (const [name, bytes, sw] of [
    [
      "silent-export-forbidden",
      apdu(0, concat(Uint8Array.of(0, 3), fromHex("800000568000000180000000"))),
      0x6a80,
    ],
    ["registration-disabled", apdu(2), 0x6d00],
    ["message-signing-disabled", apdu(0x10), 0x6d00],
    ["protocol-v0-disabled", apdu(6, new Uint8Array(), 0xe1, 0, 0), 0x6a86],
    ["reserved-p1-rejected", apdu(6, new Uint8Array(), 0xe1, 1, 1), 0x6a86],
    ["info-trailing-data", apdu(6, Uint8Array.of(0)), 0x6a80],
    ["fingerprint-trailing-data", apdu(5, Uint8Array.of(0)), 0x6a87],
    [
      "bitcoin-path-forbidden",
      apdu(0, concat(Uint8Array.of(1, 3), fromHex("800000568000000080000000"))),
      0x6a82,
    ],
    [
      "legacy-path-forbidden",
      apdu(0, concat(Uint8Array.of(1, 3), fromHex("8000002c8000000180000000"))),
      0x6a82,
    ],
    ["master-key-forbidden", apdu(0, Uint8Array.of(1, 0)), 0x6a82],
  ] as const) {
    assert.equal(response(await transport.exchange(bytes)).status, sw, name);
    evidence.push({ case: name, status: `0x${sw.toString(16)}` });
  }
  await reject("zero-inputs", (p) => {
    p.inputMaps = [];
    p.globalMap.set("04", Uint8Array.of(0));
  });
  await reject("zero-outputs", (p) => {
    p.outputMaps = [];
    p.globalMap.set("05", Uint8Array.of(0));
  });
  await reject("oversized-input-map-uint64", () => {}, {
    mapCommitment: (kind, index, b) =>
      kind === "input" && index === 0
        ? Buffer.from(concat(new Uint8Array(9).fill(0xff), b.subarray(1)))
        : b,
  });
  await reject("trailing-input-map-commitment", () => {}, {
    mapCommitment: (kind, index, b) =>
      kind === "input" && index === 0
        ? Buffer.concat([b, Buffer.from([0])])
        : b,
  });
  await reject("oversized-output-map", () => {}, {
    mapCommitment: (kind, index, b) =>
      kind === "output" && index === 0
        ? Buffer.from(concat(Uint8Array.of(9), b.subarray(1)))
        : b,
  });
  await reject("trailing-output-map-commitment", () => {}, {
    mapCommitment: (kind, index, b) =>
      kind === "output" && index === 0
        ? Buffer.concat([b, Buffer.from([0])])
        : b,
  });
  for (const kind of ["policy", "merkle-leaf", "stream"] as const) {
    let forced = false,
      emptyChunks = 0;
    const fakePrevious = Buffer.alloc(300, 0);
    const streamHash = Buffer.from(
      sha256(concat(Uint8Array.of(0), fakePrevious)),
    );
    await reject(
      `zero-progress-${kind}`,
      (p) => {
        if (kind === "stream") p.inputMaps[0]!.set("00", fakePrevious);
      },
      {
        respond: (req, standard) => {
          if (req[0] === 0xa0 && forced) {
            assert.equal(
              ++emptyChunks,
              1,
              "Device requested another empty continuation",
            );
            return Buffer.from([0, 1]);
          }
          const a = standard(),
            hash = req.subarray(2);
          if (
            !forced &&
            req[0] === 0x40 &&
            (kind === "policy"
              ? hash.equals(policy.getId())
              : kind === "stream"
                ? hash.equals(streamHash)
                : !hash.equals(policy.getId()))
          ) {
            const size =
              a[0]! < 0xfd ? 1 : a[0] === 0xfd ? 3 : a[0] === 0xfe ? 5 : 9;
            assert(a.length > size + 2);
            forced = true;
            return Buffer.concat([
              a.subarray(0, size),
              Buffer.from([1]),
              a.subarray(size + 1, size + 2),
            ]);
          }
          return a;
        },
      },
    );
    assert(
      forced && emptyChunks === 1,
      `${kind}: zero-progress read was not reached`,
    );
  }
  let proofStarted = false,
    emptyProofs = 0;
  await reject("zero-progress-merkle-proof", () => {}, {
    respond: (req, standard) => {
      if (req[0] === 0xa0 && proofStarted) {
        assert.equal(++emptyProofs, 1);
        return Buffer.from([0, 32]);
      }
      const a = standard();
      if (!proofStarted && req[0] === 0x41 && a[32]! > 0) {
        proofStarted = true;
        return Buffer.concat([a.subarray(0, 33), Buffer.from([0])]);
      }
      return a;
    },
  });
  assert(proofStarted && emptyProofs === 1);
  await reject("preimage-trailing-response", () => {}, {
    mutateResponse: (req, a) =>
      req[0] === 0x40 ? Buffer.concat([a, Buffer.from([0])]) : a,
  });
  await reject("merkle-proof-trailing-response", () => {}, {
    mutateResponse: (req, a) =>
      req[0] === 0x41 ? Buffer.concat([a, Buffer.from([0])]) : a,
  });
  const tooLargePrevious = Buffer.alloc(65537, 0);
  await reject("previous-tx-over-65536-bytes", (p) =>
    p.inputMaps[0]!.set("00", tooLargePrevious),
  );
  await reject("missing-network", (p) => {
    p.globalMap.delete(PRL_NETWORK_KEY);
  });
  await reject("wrong-network-id", (p) => {
    p.globalMap.get(PRL_NETWORK_KEY)![1] = 4;
  });
  await reject("wrong-genesis", (p) => {
    const v = p.globalMap.get(PRL_NETWORK_KEY)!;
    v[2] = v[2]! ^ 1;
  });
  await reject("wrong-binding-schema", (p) => {
    p.globalMap.get(PRL_NETWORK_KEY)![0] = 2;
  });
  await reject("trailing-binding-byte", (p) => {
    p.globalMap.set(
      PRL_NETWORK_KEY,
      concat(p.globalMap.get(PRL_NETWORK_KEY)!, Uint8Array.of(0)),
    );
  });
  await reject("wrong-psbt-version", (p) => {
    p.globalMap.set("fb", u32(0));
  });
  await reject("wrong-tx-version", (p) => {
    p.globalMap.set("02", u32(2));
  });
  await reject("nonzero-locktime", (p) => {
    p.globalMap.set("03", u32(1));
  });
  await reject("modifiable-transaction", (p) => {
    p.globalMap.set("06", Uint8Array.of(1));
  });
  await reject("count-mismatch", (p) => {
    p.globalMap.set("04", Uint8Array.of(1));
  });
  await reject("unknown-global", (p) => {
    p.globalMap.delete("06");
    p.globalMap.set("09", Uint8Array.of(0));
  });
  await reject("nonzero-wallet-hmac", () => {}, {
    hmac: new Uint8Array(32).fill(1),
  });
  await reject("trailing-apdu", () => {}, { suffix: Uint8Array.of(0) });
  for (const key of ["11", "12", "15", "18", "1b", "07", "08"])
    await reject(`forbidden-input-${key}`, (p) => {
      p.inputMaps[0]!.set(key, Uint8Array.of(0));
    });
  await reject("sighash-all-forbidden", (p) => {
    p.inputMaps[0]!.set("03", u32(1));
  });
  await reject("sighash-anyonecanpay-forbidden", (p) => {
    p.inputMaps[0]!.set("03", u32(0x81));
  });
  await reject("rbf-sequence-forbidden", (p) => {
    p.inputMaps[0]!.set("10", u32(0xfffffffd));
  });
  await reject("missing-sequence", (p) => {
    p.inputMaps[0]!.delete("10");
  });
  await reject("missing-witness-utxo", (p) => {
    p.inputMaps[0]!.delete("01");
  });
  await reject("missing-internal-key", (p) => {
    p.inputMaps[0]!.delete("17");
  });
  await reject("wrong-internal-key", (p) => {
    const v = p.inputMaps[0]!.get("17")!;
    v[0] = v[0]! ^ 1;
  });
  await reject("wrong-derivation-key", (p) => {
    const m = p.inputMaps[0]!,
      k = [...m.keys()].find((k) => k.startsWith("16"))!,
      v = m.get(k)!;
    m.delete(k);
    m.set("16" + "ff".repeat(32), v);
  });
  await reject("taproot-leafhash-forbidden", (p) => {
    const m = p.inputMaps[0]!,
      k = [...m.keys()].find((k) => k.startsWith("16"))!;
    m.get(k)![0] = 1;
  });
  await reject("wrong-coin-origin", (p) => {
    const m = p.inputMaps[0]!,
      k = [...m.keys()].find((k) => k.startsWith("16"))!;
    m.get(k)![9] = 2;
  });
  await reject("hardened-address-index", (p) => {
    const m = p.inputMaps[0]!,
      k = [...m.keys()].find((k) => k.startsWith("16"))!;
    m.get(k)![24] = 0x80;
  });
  await reject("duplicate-outpoint", (p) => {
    p.inputMaps[1]!.set("0e", p.inputMaps[0]!.get("0e")!.slice());
    p.inputMaps[1]!.set("0f", p.inputMaps[0]!.get("0f")!.slice());
  });
  await reject("input-individual-max-plus-one", (p) => {
    p.inputMaps[0]!.get("01")!.set(u64(MAX_GRAINS + 1n));
  });
  await reject("input-sum-max-plus-one", (p) => {
    p.inputMaps[0]!.get("01")!.set(u64(MAX_GRAINS));
    p.inputMaps[1]!.get("01")!.set(u64(1n));
  });
  await reject("output-individual-max-plus-one", (p) => {
    p.outputMaps[0]!.set("03", u64(MAX_GRAINS + 1n));
  });
  await reject("output-sum-max-plus-one", (p) => {
    p.outputMaps[0]!.set("03", u64(MAX_GRAINS));
    p.outputMaps[1]!.set("03", u64(1n));
  });
  await reject("zero-recipient-amount", (p) => {
    p.outputMaps[0]!.set("03", u64(0n));
  });
  await reject("zero-change-amount", (p) => {
    p.outputMaps[1]!.set("03", u64(0n));
  });
  await reject("zero-input-amount", (p) => {
    p.inputMaps[0]!.get("01")!.set(u64(0n));
  });
  await reject("negative-fee", (p) => {
    p.outputMaps[0]!.set("03", u64(MAX_GRAINS - 100n));
    p.outputMaps[1]!.set("03", u64(1n));
  });
  await reject("legacy-recipient-forbidden", (p) => {
    p.outputMaps[0]!.set("04", fromHex("76a914" + "11".repeat(20) + "88ac"));
  });
  await reject("segwit0-recipient-forbidden", (p) => {
    p.outputMaps[0]!.set("04", fromHex("0014" + "11".repeat(20)));
  });
  await reject("segwit3-recipient-forbidden", (p) => {
    p.outputMaps[0]!.set("04", fromHex("5320" + "11".repeat(32)));
  });
  await reject("p2tr-zero-invalid-point", (p) => {
    p.outputMaps[0]!.set("04", fromHex("5120" + "00".repeat(32)));
  });
  await reject("p2tr-field-modulus", (p) => {
    p.outputMaps[0]!.set(
      "04",
      fromHex(
        "5120fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f",
      ),
    );
  });
  await reject("p2tr-invalid-point", (p) => {
    p.outputMaps[0]!.set("04", fromHex("5120" + "ff".repeat(32)));
  });
  await reject("p2mr-change-forbidden", (p) => {
    p.outputMaps[1]!.get("04")![0] = 0x52;
  });
  await reject("forged-change-script", (p) => {
    p.outputMaps[1]!.set("04", p.outputMaps[0]!.get("04")!.slice());
  });
  await reject("wrong-change-internal-key", (p) => {
    const v = p.outputMaps[1]!.get("05")!;
    v[0] = v[0]! ^ 1;
  });
  await reject("unmarked-second-recipient", (p) => {
    p.outputMaps[1] = new Map([
      ["03", p.outputMaps[1]!.get("03")!],
      ["04", p.outputMaps[1]!.get("04")!],
    ]);
  });
  await reject("output-taptree-forbidden", (p) => {
    p.outputMaps[1]!.set("06", Uint8Array.of(0));
  });
  let proofCorrupted = false;
  await reject("invalid-merkle-proof", () => {}, {
    mutateResponse: (req, answer) => {
      if (!proofCorrupted && req[0] === 0x41) {
        proofCorrupted = true;
        answer = Buffer.from(answer);
        answer[0] = answer[0]! ^ 1;
      }
      return answer;
    },
  });
  assert(proofCorrupted);
  // Still responsive with the same correct immutable identity after every rejection.
  assert.equal(response(await transport.exchange(apdu(6))).status, 0x9000);
  await writeFile(
    join(output, "adversarial.json"),
    JSON.stringify(
      { status: "passed", firmware: emulator.provenance, cases: evidence },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${model}: ${evidence.length} native hostile-host rejection cases`,
  );
} finally {
  await emulator.stop();
}
