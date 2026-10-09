import { schnorr } from "@noble/curves/secp256k1";
import {
  assert,
  compactSize,
  concat,
  fromHex,
  hex,
  i32,
  Reader,
  u32,
  u64,
} from "./bytes.js";
import { checkedGrains, MAX_GRAINS } from "./amount.js";
import { sha256, taggedHash } from "./keys.js";
import { validateBundle, type SigningBundle } from "./bundle.js";
export function hash256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}
export function serializeOutput(output: {
  amount: bigint;
  scriptPubKey: Uint8Array;
}): Uint8Array {
  return concat(
    u64(output.amount),
    compactSize(output.scriptPubKey.length),
    output.scriptPubKey,
  );
}
/** BIP341 epoch=0, SIGHASH_DEFAULT, ext_flag=0, no annex, all inputs/outputs bound. */
export function computeSighash(
  bundle: SigningBundle,
  inputIndex: number,
): Uint8Array {
  validateBundle(bundle);
  assert(
    Number.isInteger(inputIndex) &&
      inputIndex >= 0 &&
      inputIndex < bundle.inputs.length,
    "Input index outside bundle",
  );
  return taggedHash(
    "TapSighash",
    concat(
      Uint8Array.of(0, 0),
      i32(bundle.version),
      u32(bundle.lockTime),
      sha256(
        concat(
          ...bundle.inputs.map((i) =>
            concat(fromHex(i.txid).reverse(), u32(i.vout)),
          ),
        ),
      ),
      sha256(concat(...bundle.inputs.map((i) => u64(i.amount)))),
      sha256(
        concat(
          ...bundle.inputs.map((i) =>
            concat(compactSize(i.scriptPubKey.length), i.scriptPubKey),
          ),
        ),
      ),
      sha256(concat(...bundle.inputs.map((i) => u32(i.sequence)))),
      sha256(concat(...bundle.outputs.map(serializeOutput))),
      Uint8Array.of(0),
      u32(inputIndex),
    ),
  );
}
export function verifySignature(
  bundle: SigningBundle,
  inputIndex: number,
  signature: Uint8Array,
): boolean {
  if (!(signature instanceof Uint8Array) || signature.length !== 64)
    return false;
  try {
    return schnorr.verify(
      signature,
      computeSighash(bundle, inputIndex),
      bundle.inputs[inputIndex]!.scriptPubKey.slice(2),
    );
  } catch {
    return false;
  }
}
export function serializeUnsignedTransaction(
  bundle: SigningBundle,
): Uint8Array {
  validateBundle(bundle);
  return concat(
    i32(bundle.version),
    compactSize(bundle.inputs.length),
    ...bundle.inputs.map((i) =>
      concat(
        fromHex(i.txid).reverse(),
        u32(i.vout),
        Uint8Array.of(0),
        u32(i.sequence),
      ),
    ),
    compactSize(bundle.outputs.length),
    ...bundle.outputs.map(serializeOutput),
    u32(bundle.lockTime),
  );
}
export interface FinalizedTransaction {
  signatures: Uint8Array[];
  rawTx: string;
  txid: string;
  wtxid: string;
  vsize: number;
  bytes: Uint8Array;
}
export function finalizeTransaction(
  bundle: SigningBundle,
  signatures: readonly Uint8Array[],
): FinalizedTransaction {
  validateBundle(bundle);
  assert(
    signatures.length === bundle.inputs.length,
    "Signature count mismatch",
  );
  signatures.forEach((s, i) =>
    assert(verifySignature(bundle, i, s), `Invalid signature for input ${i}`),
  );
  const unsigned = serializeUnsignedTransaction(bundle);
  const bytes = concat(
    unsigned.slice(0, 4),
    Uint8Array.of(0, 1),
    unsigned.slice(4, -4),
    ...signatures.map((s) => concat(Uint8Array.of(1, 64), s)),
    unsigned.slice(-4),
  );
  return {
    signatures: signatures.map((s) => s.slice()),
    rawTx: hex(bytes),
    bytes,
    txid: hex(hash256(unsigned).reverse()),
    wtxid: hex(hash256(bytes).reverse()),
    vsize: Math.ceil((unsigned.length * 3 + bytes.length) / 4),
  };
}
export interface ParsedTxInput {
  txid: string;
  vout: number;
  scriptSig: Uint8Array;
  sequence: number;
  witness: Uint8Array[];
}
export interface ParsedTransaction {
  txid: string;
  wtxid: string;
  version: number;
  lockTime: number;
  inputs: ParsedTxInput[];
  outputs: { amount: bigint; scriptPubKey: Uint8Array }[];
  coinbase: boolean;
  bytes: Uint8Array;
}
/** Parse the raw prior transaction before using amounts. RPC floating PRL numbers are unsafe. */
export function parseTransaction(raw: string | Uint8Array): ParsedTransaction {
  assert(
    typeof raw !== "string" || raw.length <= 8_000_000,
    "Transaction too large",
  );
  const bytes = typeof raw === "string" ? fromHex(raw) : Uint8Array.from(raw);
  assert(bytes.length <= 4_000_000, "Transaction too large");
  const r = new Reader(bytes),
    version = r.i32();
  let hasWitness = false;
  let count = r.compactSize(100_000);
  if (count === 0) {
    assert(r.byte() === 1, "Unsupported witness flags");
    hasWitness = true;
    count = r.compactSize(100_000);
  }
  assert(count > 0, "Transaction has no inputs");
  const inputs: ParsedTxInput[] = [];
  for (let i = 0; i < count; i++)
    inputs.push({
      txid: hex(r.take(32).reverse()),
      vout: r.u32(),
      scriptSig: r.take(r.compactSize()),
      sequence: r.u32(),
      witness: [],
    });
  const outputCount = r.compactSize(100_000);
  assert(outputCount > 0, "Transaction has no outputs");
  const outputs: { amount: bigint; scriptPubKey: Uint8Array }[] = [];
  let total = 0n;
  for (let i = 0; i < outputCount; i++) {
    const amount = checkedGrains(r.u64());
    total += amount;
    assert(
      total <= MAX_GRAINS,
      "Previous transaction aggregate amount exceeds limit",
    );
    outputs.push({ amount, scriptPubKey: r.take(r.compactSize()) });
  }
  let witnessed = false;
  if (hasWitness)
    for (const input of inputs) {
      const items = r.compactSize(100_000);
      witnessed ||= items > 0;
      for (let j = 0; j < items; j++)
        input.witness.push(r.take(r.compactSize()));
    }
  assert(!hasWitness || witnessed, "Superfluous witness serialization");
  const lockTime = r.u32();
  r.end();
  const unsigned = concat(
    i32(version),
    compactSize(inputs.length),
    ...inputs.map((i) =>
      concat(
        fromHex(i.txid).reverse(),
        u32(i.vout),
        compactSize(i.scriptSig.length),
        i.scriptSig,
        u32(i.sequence),
      ),
    ),
    compactSize(outputs.length),
    ...outputs.map(serializeOutput),
    u32(lockTime),
  );
  return {
    txid: hex(hash256(unsigned).reverse()),
    wtxid: hex(hash256(bytes).reverse()),
    version,
    lockTime,
    inputs,
    outputs,
    coinbase:
      inputs.length === 1 &&
      inputs[0]!.txid === "0".repeat(64) &&
      inputs[0]!.vout === 0xffffffff,
    bytes,
  };
}
