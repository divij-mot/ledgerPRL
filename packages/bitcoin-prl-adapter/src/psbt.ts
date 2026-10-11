import { Buffer } from "buffer";
import {
  assert,
  checkedBranch,
  checkedIndex,
  checkedGrains,
  compactSize,
  concat,
  decodeBundle,
  deriveAddress,
  encodeBundle,
  equal,
  fromHex,
  hex,
  i32,
  MAX_INPUTS,
  network,
  networkFromId,
  parseTransaction,
  Reader,
  serializeOutput,
  u32,
  u64,
  validateAccount,
  validateBundle,
  type AccountPublicKey,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import { MerkleMap } from "./upstream/merkleMap.js";

/** BIP174 proprietary key: identifier "PRL", subtype 1, no key data. */
export const PRL_NETWORK_KEY = "fc0350524c01";
export const MAX_PSBT_BYTES = 2_000_000;
export const MAX_PREVIOUS_TX_BYTES = 65_536;
const MAX_MAP_ENTRIES = 32;
const MAGIC = Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff);
export type PsbtMap = ReadonlyMap<string, Uint8Array>;
export interface PrlPsbtV2 {
  readonly globalMap: PsbtMap;
  readonly inputMaps: readonly PsbtMap[];
  readonly outputMaps: readonly PsbtMap[];
}
export interface PsbtOptions {
  /** Optional exact raw prevtx per input, verified against txid/vout/value/script. */
  readonly previousTransactions?: readonly (Uint8Array | string)[];
}
function singleton(type: number, value: Uint8Array): [string, Uint8Array] {
  return [type.toString(16).padStart(2, "0"), value];
}
function readExact<T>(value: Uint8Array, fn: (r: Reader) => T): T {
  const r = new Reader(value),
    result = fn(r);
  r.end();
  return result;
}
function required(map: PsbtMap, key: string): Uint8Array {
  const value = map.get(key);
  assert(value !== undefined, `Missing PSBT field ${key}`);
  return value;
}
function assertFields(map: PsbtMap, expected: readonly string[]): void {
  assert(
    map.size === expected.length && expected.every((k) => map.has(k)),
    "Unsupported, missing or extra PSBT fields",
  );
}
function origin(
  account: AccountPublicKey,
  branch: 0 | 1,
  index: number,
): Uint8Array {
  return concat(
    Uint8Array.of(0),
    account.masterFingerprint,
    u32(0x80000000 + 86),
    u32(0x80000000 + network(account.network).coinType),
    u32(0x80000000 + account.account),
    u32(branch),
    u32(index),
  );
}
function parseOrigin(value: Uint8Array, account: AccountPublicKey) {
  return readExact(value, (r) => {
    assert(r.compactSize(0) === 0, "Taproot script paths are not supported");
    assert(
      equal(r.take(4), account.masterFingerprint),
      "Wrong master fingerprint",
    );
    assert(
      r.u32() === 0x80000000 + 86 &&
        r.u32() === 0x80000000 + network(account.network).coinType &&
        r.u32() === 0x80000000 + account.account,
      "Wrong BIP86 account origin",
    );
    return { branch: checkedBranch(r.u32()), index: checkedIndex(r.u32()) };
  });
}
function checkedPreviousTransaction(
  raw: Uint8Array | string,
  input: SigningBundle["inputs"][number],
) {
  assert(
    typeof raw !== "string" || raw.length <= MAX_PREVIOUS_TX_BYTES * 2,
    "Previous transaction exceeds adapter limit",
  );
  const bytes = typeof raw === "string" ? fromHex(raw) : Uint8Array.from(raw);
  assert(
    bytes.length <= MAX_PREVIOUS_TX_BYTES,
    "Previous transaction exceeds adapter limit",
  );
  const tx = parseTransaction(bytes),
    output = tx.outputs[input.vout];
  assert(
    tx.txid === input.txid && output !== undefined,
    "Previous transaction does not match input outpoint",
  );
  assert(
    output.amount === input.amount &&
      equal(output.scriptPubKey, input.scriptPubKey),
    "Previous transaction value/script mismatch",
  );
  return bytes;
}
/** Build only the existing bounded, ordinary BIP86 payment profile, with exact u64 values. */
export function buildPrlPsbt(
  bundle: SigningBundle,
  account: AccountPublicKey,
  options: PsbtOptions = {},
): PrlPsbtV2 {
  validateBundle(bundle, account);
  if (options.previousTransactions !== undefined)
    assert(
      options.previousTransactions.length === bundle.inputs.length,
      "Previous transaction count mismatch",
    );
  const net = network(bundle.network);
  const globalMap = new Map<string, Uint8Array>([
    singleton(0x02, i32(bundle.version)),
    singleton(0x03, u32(bundle.lockTime)),
    singleton(0x04, compactSize(bundle.inputs.length)),
    singleton(0x05, compactSize(bundle.outputs.length)),
    singleton(0x06, Uint8Array.of(0)),
    singleton(0xfb, u32(2)),
    [
      PRL_NETWORK_KEY,
      concat(Uint8Array.of(1, net.id), fromHex(net.genesisHash)),
    ],
  ]);
  const inputMaps = bundle.inputs.map((input, i) => {
    const internal = deriveAddress(
      account,
      input.branch,
      input.index,
    ).internalKey;
    const map = new Map<string, Uint8Array>([
      singleton(0x01, serializeOutput(input)),
      singleton(0x03, u32(0)),
      singleton(0x0e, fromHex(input.txid).reverse()),
      singleton(0x0f, u32(input.vout)),
      singleton(0x10, u32(input.sequence)),
      ["16" + hex(internal), origin(account, input.branch, input.index)],
      singleton(0x17, internal),
    ]);
    if (options.previousTransactions !== undefined)
      map.set(
        "00",
        checkedPreviousTransaction(options.previousTransactions[i]!, input),
      );
    return map;
  });
  const outputMaps = bundle.outputs.map((output) => {
    const map = new Map<string, Uint8Array>([
      singleton(0x03, u64(output.amount)),
      singleton(0x04, output.scriptPubKey.slice()),
    ]);
    if (output.role === "change") {
      const internal = deriveAddress(account, 1, output.index).internalKey;
      map.set("05", internal);
      map.set("07" + hex(internal), origin(account, 1, output.index));
    }
    return map;
  });
  const result = { globalMap, inputMaps, outputMaps };
  // Apply serialized size bounds and semantic validation to generated data too.
  const decoded = parsePrlPsbt(serializePrlPsbt(result), account);
  assert(
    equal(encodeBundle(decoded.bundle), encodeBundle(bundle)),
    "PSBT construction mismatch",
  );
  return result;
}
function serializeMap(map: PsbtMap): Uint8Array {
  assert(
    map instanceof Map && map.size <= MAX_MAP_ENTRIES,
    "PSBT map exceeds limit",
  );
  const keys = [...map.keys()].sort();
  return concat(
    ...keys.map((key) => {
      assert(/^(?:[0-9a-f]{2})+$/.test(key), "Noncanonical PSBT key");
      const keyBytes = fromHex(key),
        value = required(map, key);
      assert(
        keyBytes.length <= 65 &&
          value instanceof Uint8Array &&
          value.length <= MAX_PREVIOUS_TX_BYTES,
        "PSBT key/value exceeds adapter limits",
      );
      return concat(
        compactSize(keyBytes.length),
        keyBytes,
        compactSize(value.length),
        value,
      );
    }),
    Uint8Array.of(0),
  );
}
/** Canonical lexicographic map serialization; amounts are already exact raw LE u64 bytes. */
export function serializePrlPsbt(psbt: PrlPsbtV2): Uint8Array {
  assert(
    psbt.inputMaps.length >= 1 &&
      psbt.inputMaps.length <= MAX_INPUTS &&
      psbt.outputMaps.length >= 1 &&
      psbt.outputMaps.length <= 2,
    "PSBT counts outside adapter limits",
  );
  const parts = [
    MAGIC,
    serializeMap(psbt.globalMap),
    ...psbt.inputMaps.map(serializeMap),
    ...psbt.outputMaps.map(serializeMap),
  ];
  assert(
    parts.reduce((n, p) => n + p.length, 0) <= MAX_PSBT_BYTES,
    "PSBT exceeds adapter size limit",
  );
  return concat(...parts);
}
function parseMap(r: Reader): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (;;) {
    const length = r.compactSize(65);
    if (length === 0) return map;
    assert(map.size < MAX_MAP_ENTRIES, "PSBT map exceeds entry limit");
    const key = hex(r.take(length));
    assert(!map.has(key), "Duplicate PSBT key");
    map.set(key, r.take(r.compactSize(MAX_PREVIOUS_TX_BYTES)));
  }
}
/** Strict PSBTv2+BIP371 parser. Unsupported fields are rejected, never ignored. */
export function parsePrlPsbt(
  bytes: Uint8Array,
  account: AccountPublicKey,
): { psbt: PrlPsbtV2; bundle: SigningBundle } {
  validateAccount(account);
  assert(
    bytes instanceof Uint8Array && bytes.length <= MAX_PSBT_BYTES,
    "PSBT exceeds adapter size limit",
  );
  const r = new Reader(Uint8Array.from(bytes));
  assert(equal(r.take(5), MAGIC), "Invalid PSBT magic");
  const globalMap = parseMap(r);
  assertFields(globalMap, [
    "02",
    "03",
    "04",
    "05",
    "06",
    "fb",
    PRL_NETWORK_KEY,
  ]);
  assert(
    readExact(required(globalMap, "fb"), (r) => r.u32()) === 2,
    "Only PSBTv2 is supported",
  );
  assert(
    readExact(required(globalMap, "02"), (r) => r.i32()) === 1 &&
      readExact(required(globalMap, "03"), (r) => r.u32()) === 0,
    "Unsupported transaction version/locktime",
  );
  assert(
    equal(required(globalMap, "06"), Uint8Array.of(0)),
    "Transaction modification is forbidden",
  );
  const inputCount = readExact(required(globalMap, "04"), (r) =>
    r.compactSize(MAX_INPUTS),
  );
  const outputCount = readExact(required(globalMap, "05"), (r) =>
    r.compactSize(2),
  );
  assert(inputCount > 0 && outputCount > 0, "Empty PSBT");
  readExact(required(globalMap, PRL_NETWORK_KEY), (r) => {
    assert(r.byte() === 1, "Unsupported PRL network binding schema");
    assert(networkFromId(r.byte()) === account.network, "Wrong PSBT network");
    assert(
      equal(r.take(32), fromHex(network(account.network).genesisHash)),
      "Wrong PSBT genesis",
    );
  });
  const inputMaps = Array.from({ length: inputCount }, () => parseMap(r));
  const outputMaps = Array.from({ length: outputCount }, () => parseMap(r));
  r.end();
  const inputs = inputMaps.map((map) => {
    const internal = required(map, "17");
    assert(internal.length === 32, "Invalid Taproot internal key");
    const derivationKey = "16" + hex(internal);
    assertFields(map, [
      "01",
      "03",
      "0e",
      "0f",
      "10",
      derivationKey,
      "17",
      ...(map.has("00") ? ["00"] : []),
    ]);
    const path = parseOrigin(required(map, derivationKey), account);
    assert(
      equal(
        deriveAddress(account, path.branch, path.index).internalKey,
        internal,
      ),
      "Foreign Taproot internal key",
    );
    const previousTxid = required(map, "0e");
    assert(previousTxid.length === 32, "Invalid previous txid length");
    const utxo = readExact(required(map, "01"), (r) => ({
      amount: checkedGrains(r.u64(), false),
      scriptPubKey: r.take(r.compactSize(34)),
    }));
    assert(
      readExact(required(map, "03"), (r) => r.u32()) === 0,
      "Only SIGHASH_DEFAULT is supported",
    );
    const input = {
      txid: hex(previousTxid.slice().reverse()),
      vout: readExact(required(map, "0f"), (r) => r.u32()),
      sequence: readExact(required(map, "10"), (r) => r.u32()),
      ...utxo,
      ...path,
    };
    if (map.has("00")) checkedPreviousTransaction(required(map, "00"), input);
    return input;
  });
  const outputs = outputMaps.map((map) => {
    const amount = checkedGrains(
      readExact(required(map, "03"), (r) => r.u64()),
      false,
    );
    const scriptPubKey = required(map, "04").slice();
    if (!map.has("05")) {
      assertFields(map, ["03", "04"]);
      return {
        amount,
        scriptPubKey,
        role: "recipient" as const,
        branch: 0 as const,
        index: 0,
      };
    }
    const internal = required(map, "05");
    assert(internal.length === 32, "Invalid change internal key");
    const derivationKey = "07" + hex(internal);
    assertFields(map, ["03", "04", "05", derivationKey]);
    const path = parseOrigin(required(map, derivationKey), account);
    assert(
      path.branch === 1 &&
        equal(deriveAddress(account, 1, path.index).internalKey, internal),
      "Foreign change key or path",
    );
    return { amount, scriptPubKey, role: "change" as const, ...path };
  });
  const bundle: SigningBundle = {
    network: account.network,
    account: account.account,
    version: 1,
    lockTime: 0,
    inputs,
    outputs,
  };
  validateBundle(bundle, account);
  return { psbt: { globalMap, inputMaps, outputMaps }, bundle };
}
/** Clone through the existing strict canonical bundle encoding before any asynchronous operation. */
export function snapshotBundle(
  bundle: SigningBundle,
  account: AccountPublicKey,
): SigningBundle {
  validateBundle(bundle, account);
  return decodeBundle(encodeBundle(bundle));
}
export function merkleMap(map: PsbtMap): MerkleMap {
  const keys = [...map.keys()].sort();
  return new MerkleMap(
    keys.map((k) => Buffer.from(k, "hex")),
    keys.map((k) => Buffer.from(required(map, k))),
  );
}
