/** Test-only hostile host. Intentionally bypasses the production adapter validation.
 * Uses Merkle proofs against the actual emulator APDUs; never a software signer. */
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import {
  compactSize,
  concat,
  SpeculosTransport,
  type AccountPublicKey,
  type NetworkName,
} from "../../../packages/sdk/src/index.ts";
import {
  createPrlWalletPolicy,
  merkleMap,
  parseAccountXpub,
  u32be,
  type PrlPsbtV2,
} from "../../../packages/bitcoin-prl-adapter/src/index.ts";
import { ClientCommandInterpreter } from "../../../packages/bitcoin-prl-adapter/src/upstream/clientCommands.ts";
import {
  hashLeaf,
  Merkle,
} from "../../../packages/bitcoin-prl-adapter/src/upstream/merkle.ts";
import { WalletPolicy } from "../../../packages/bitcoin-prl-adapter/src/upstream/policy.ts";
export function apdu(
  ins: number,
  bytes: Uint8Array = new Uint8Array(),
  cla = 0xe1,
  p1 = 0,
  p2 = 1,
) {
  assert(bytes.length <= 255);
  return concat(Uint8Array.of(cla, ins, p1, p2, bytes.length), bytes);
}
export function response(bytes: Uint8Array) {
  assert(bytes.length >= 2);
  return {
    status: bytes.at(-2)! * 256 + bytes.at(-1)!,
    data: Buffer.from(bytes.subarray(0, -2)),
  };
}
export async function publicAccount(
  transport: SpeculosTransport,
  name: NetworkName = "regtest",
  approve: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  const fp = response(await transport.exchange(apdu(5)));
  assert.equal(fp.status, 0x9000);
  const result = response(
    await approve(() =>
      transport.exchange(
        apdu(
          0,
          concat(
            Uint8Array.of(1, 3),
            u32be(0x80000056),
            u32be(0x80000001),
            u32be(0x80000000),
          ),
        ),
      ),
    ),
  );
  assert.equal(result.status, 0x9000);
  const xpub = result.data.toString("ascii");
  const account = parseAccountXpub(xpub, fp.data, name, 0).account;
  return { account, policy: createPrlWalletPolicy(account, xpub) };
}
export function clonePsbt(psbt: PrlPsbtV2): {
  globalMap: Map<string, Uint8Array>;
  inputMaps: Map<string, Uint8Array>[];
  outputMaps: Map<string, Uint8Array>[];
} {
  return {
    globalMap: new Map(
      [...psbt.globalMap].map(([k, v]) => [k, Uint8Array.from(v)]),
    ),
    inputMaps: psbt.inputMaps.map(
      (m) => new Map([...m].map(([k, v]) => [k, Uint8Array.from(v)])),
    ),
    outputMaps: psbt.outputMaps.map(
      (m) => new Map([...m].map(([k, v]) => [k, Uint8Array.from(v)])),
    ),
  };
}
export async function rawSign(
  transport: SpeculosTransport,
  psbt: PrlPsbtV2,
  policy: WalletPolicy,
  options: {
    hmac?: Uint8Array;
    suffix?: Uint8Array;
    mutateResponse?: (request: Buffer, response: Buffer) => Buffer;
    signal?: AbortSignal;
    respond?: (
      request: Buffer,
      standard: () => Buffer,
    ) => Buffer | Promise<Buffer>;
    mapCommitment?: (
      kind: "input" | "output",
      index: number,
      commitment: Buffer,
    ) => Buffer;
  } = {},
) {
  const interpreter = new ClientCommandInterpreter();
  interpreter.addKnownWalletPolicy(policy);
  const g = merkleMap(psbt.globalMap),
    ins = psbt.inputMaps.map(merkleMap),
    outs = psbt.outputMaps.map(merkleMap);
  for (const m of [g, ...ins, ...outs]) interpreter.addKnownMapping(m);
  const ic = ins.map(
      (m, i) =>
        options.mapCommitment?.("input", i, m.commitment()) ?? m.commitment(),
    ),
    oc = outs.map(
      (m, i) =>
        options.mapCommitment?.("output", i, m.commitment()) ?? m.commitment(),
    );
  interpreter.addKnownList(ic);
  interpreter.addKnownList(oc);
  const data = concat(
    g.commitment(),
    compactSize(ins.length),
    new Merkle(ic.map((x) => hashLeaf(x))).getRoot(),
    compactSize(outs.length),
    new Merkle(oc.map((x) => hashLeaf(x))).getRoot(),
    policy.getId(),
    options.hmac ?? new Uint8Array(32),
    options.suffix ?? new Uint8Array(),
  );
  let result = response(
      await transport.exchange(apdu(4, data), options.signal),
    ),
    commands = 0;
  const yields: Buffer[] = [];
  while (result.status === 0xe000) {
    assert(++commands < 100000);
    if (result.data[0] === 0x10)
      yields.push(Buffer.from(result.data.subarray(1)));
    let answer = options.respond
      ? await options.respond(result.data, () =>
          interpreter.execute(result.data),
        )
      : interpreter.execute(result.data);
    if (options.mutateResponse)
      answer = options.mutateResponse(result.data, answer);
    result = response(
      await transport.exchange(apdu(1, answer, 0xf8), options.signal),
    );
  }
  return { ...result, commands, yields };
}
