/** Host-only security regressions. Published BIP32 vector 1 only; never fund it. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1";
import {
  computeSighash, deriveAddress, finalizeTransaction, parseTransaction,
  verifySignature, MAX_GRAINS, type ApduTransport, type SigningBundle,
  type FinalizedTransaction, type NetworkName,
} from "@pearl-ledger/sdk";
import {
  buildPrlPsbt, LedgerBitcoinPrlClient, parsePrlPsbt, serializePrlPsbt,
  VerifiedSigningResultError, verifyAndFinalize,
} from "@pearl-ledger/bitcoin-prl-adapter";
import {
  networkInfo, testAccount,
} from "../../packages/bitcoin-prl-adapter/test/fixtures.js";
import { signedRecoveryBackup } from "../../apps/companion/src/signed-recovery.js";
import { importWalletBackup } from "@pearl-ledger/wallet";

// Independent byte oracle: deliberately no SDK serialization, hashes or Merkle helpers.
const b = (...parts: (Uint8Array | number[])[]) => Buffer.concat(parts.map(p => Buffer.from(p)));
const h = (v: Uint8Array) => createHash("sha256").update(v).digest();
const h2 = (v: Uint8Array) => h(h(v));
const tagged = (tag: string, v: Uint8Array) => b(h(Buffer.from(tag)), h(Buffer.from(tag)), v);
function le(n: number | bigint, size: number): Buffer {
  let v = BigInt(n);
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) { out[i] = Number(v & 255n); v >>= 8n; }
  assert.equal(v, 0n);
  return out;
}
const cs = (n: number) => n < 253 ? Buffer.from([n]) : n <= 65535 ? b([253], le(n, 2)) : b([254], le(n, 4));
const output = (o: SigningBundle["outputs"][number] | SigningBundle["inputs"][number]) => b(le(o.amount, 8), cs(o.scriptPubKey.length), o.scriptPubKey);
function independentDigest(bundle: SigningBundle, index: number): Buffer {
  return h(tagged("TapSighash", b(
    [0, 0], le(bundle.version, 4), le(bundle.lockTime, 4),
    h(b(...bundle.inputs.map(i => b(Buffer.from(i.txid, "hex").reverse(), le(i.vout, 4))))),
    h(b(...bundle.inputs.map(i => le(i.amount, 8)))),
    h(b(...bundle.inputs.map(i => b(cs(i.scriptPubKey.length), i.scriptPubKey)))),
    h(b(...bundle.inputs.map(i => le(i.sequence, 4)))),
    h(b(...bundle.outputs.map(output))), [0], le(index, 4),
  )));
}
function independentFinal(bundle: SigningBundle, signatures: readonly Uint8Array[]) {
  const body = b(cs(bundle.inputs.length), ...bundle.inputs.map(i => b(
    Buffer.from(i.txid, "hex").reverse(), le(i.vout, 4), [0], le(i.sequence, 4),
  )), cs(bundle.outputs.length), ...bundle.outputs.map(output));
  const unsigned = b(le(bundle.version, 4), body, le(bundle.lockTime, 4));
  const signed = b(le(bundle.version, 4), [0, 1], body, ...signatures.map(s => b([1, 64], s)), le(bundle.lockTime, 4));
  return {
    rawTx: signed.toString("hex"), bytes: signed,
    txid: h2(unsigned).reverse().toString("hex"),
    wtxid: h2(signed).reverse().toString("hex"),
    vsize: Math.ceil((3 * unsigned.length + signed.length) / 4),
  };
}
function independentSignatureAtPath(bundle: SigningBundle, inputIndex: number, branch: 0 | 1, addressIndex: number) {
  const child = testAccount(bundle.network, bundle.account).child;
  const key = child.deriveChild(branch).deriveChild(addressIndex);
  let k = BigInt("0x" + Buffer.from(key.privateKey!).toString("hex"));
  if (key.publicKey![0] === 3) k = secp256k1.CURVE.n - k;
  k = (k + BigInt("0x" + h(tagged("TapTweak", key.publicKey!.slice(1))).toString("hex"))) % secp256k1.CURVE.n;
  return schnorr.sign(independentDigest(bundle, inputIndex), Buffer.from(k.toString(16).padStart(64, "0"), "hex"), new Uint8Array(32));
}
function independentSign(bundle: SigningBundle) {
  return bundle.inputs.map((input, index) => independentSignatureAtPath(bundle, index, input.branch, input.index));
}
function fixture(name: NetworkName, count: number, total: bigint, p2mr = false) {
  const { account, xpub } = testAccount(name, 3);
  const each = total / BigInt(count);
  const inputs = Array.from({ length: count }, (_, i) => {
    const branch = (i % 2) as 0 | 1, index = i === count - 1 ? 0x7fffffff : i;
    return {
      txid: h(Buffer.from(`public-vector:${name}:${i}`)).toString("hex"), vout: i,
      amount: each + (i === 0 ? total % BigInt(count) : 0n),
      scriptPubKey: deriveAddress(account, branch, index).scriptPubKey,
      sequence: 0xffffffff, branch, index,
    };
  });
  const recipient = p2mr ? b([0x52, 0x20], Buffer.alloc(32, 0xff)) : deriveAddress(account, 0, 9).scriptPubKey;
  const bundle: SigningBundle = { network: name, account: 3, version: 1, lockTime: 0, inputs,
    outputs: [
      { amount: total - 4000n, scriptPubKey: recipient, role: "recipient", branch: 0, index: 0 },
      { amount: 3000n, scriptPubKey: deriveAddress(account, 1, 7).scriptPubKey, role: "change", branch: 1, index: 7 },
    ],
  };
  return { account, xpub, bundle, signatures: independentSign(bundle) };
}

const ok = (data: Uint8Array = Buffer.alloc(0)) => b(data, [0x90, 0]);
const interrupted = (data: Uint8Array) => b(data, [0xe0, 0]);
const yieldSignature = (bundle: SigningBundle, signatures: readonly Uint8Array[], index: number) => b([0x10, index, 32], bundle.inputs[index]!.scriptPubKey.slice(2), signatures[index]!);
class MockTransport implements ApduTransport {
  commands: Buffer[] = [];
  closed = false;
  constructor(readonly handler: (apdu: Buffer) => Uint8Array | Promise<Uint8Array>) {}
  async exchange(apdu: Uint8Array) { this.commands.push(Buffer.from(apdu)); return this.handler(Buffer.from(apdu)); }
  async close() { this.closed = true; }
}
function transportFor(f: ReturnType<typeof fixture>, script: (header: Buffer) => Generator<Buffer, Buffer | undefined, Buffer>) {
  let flow: Generator<Buffer, Buffer | undefined, Buffer> | undefined;
  return new MockTransport(apdu => {
    if (apdu[0] === 0xe1) {
      if (apdu[1] === 6) return ok(networkInfo(f.account.network));
      if (apdu[1] === 5) return ok(f.account.masterFingerprint);
      if (apdu[1] === 0) return ok(Buffer.from(f.xpub));
      assert.equal(apdu[1], 4); flow = script(apdu.subarray(5));
      const next = flow.next();
      return next.done ? ok(next.value) : interrupted(next.value);
    }
    assert.equal(apdu[0], 0xf8); assert.equal(apdu[1], 1); assert(flow);
    const next = flow.next(apdu.subarray(5));
    return next.done ? ok(next.value) : interrupted(next.value);
  });
}

for (const name of ["mainnet", "testnet", "testnet2", "regtest", "simnet"] as const) {
  test(`independent exact digest/finalization: ${name}, 16 inputs, MAX_GRAINS, P2MR`, () => {
    const f = fixture(name, 16, MAX_GRAINS, true);
    const psbt = buildPrlPsbt(f.bundle, f.account);
    const parsedBundle = parsePrlPsbt(serializePrlPsbt(psbt), f.account).bundle;
    assert.equal(parsedBundle.inputs.reduce((n, i) => n + i.amount, 0n), MAX_GRAINS);
    for (let i = 0; i < 16; i++) {
      assert.equal(Buffer.from(computeSighash(parsedBundle, i)).toString("hex"), independentDigest(f.bundle, i).toString("hex"));
      assert(verifySignature(parsedBundle, i, f.signatures[i]!));
    }
    const expected = independentFinal(f.bundle, f.signatures);
    const final = verifyAndFinalize(parsedBundle, f.account, f.signatures.map((signature, inputIndex) => ({ signature, inputIndex, pubkey: f.bundle.inputs[inputIndex]!.scriptPubKey.slice(2) })).reverse());
    for (const key of ["rawTx", "txid", "wtxid", "vsize"] as const) assert.equal(final[key], expected[key]);
    assert.deepEqual(parseTransaction(final.rawTx).outputs.map(o => o.amount), [MAX_GRAINS - 4000n, 3000n]);
  });
}

test("all signatures bind another input and output fields at >2^53 granularity, including input/output permutation", () => {
  const f = fixture("regtest", 3, 9007199254740993n * 3n);
  const mutations: [string, (bundle: SigningBundle) => void][] = [
    ["other input amount +1", b => b.inputs[2]!.amount++],
    ["other input outpoint", b => b.inputs[2]!.txid = "ab".repeat(32)],
    ["other input vout", b => b.inputs[2]!.vout++],
    ["other input owned key", b => { b.inputs[2]!.scriptPubKey = deriveAddress(f.account, 0, 88).scriptPubKey; b.inputs[2]!.branch = 0; b.inputs[2]!.index = 88; }],
    ["input permutation", b => b.inputs.reverse()],
    ["recipient amount -1", b => b.outputs[0]!.amount--],
    ["recipient address", b => b.outputs[0]!.scriptPubKey = deriveAddress(f.account, 0, 22).scriptPubKey],
    ["change amount -1", b => b.outputs[1]!.amount--],
    ["change address and path", b => { b.outputs[1]!.scriptPubKey = deriveAddress(f.account, 1, 23).scriptPubKey; b.outputs[1]!.index = 23; }],
    ["output permutation", b => b.outputs.reverse()],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(f.bundle); mutate(changed);
    for (let i = 0; i < 3; i++) assert.equal(verifySignature(changed, i, f.signatures[i]!), false, `${label}, signature ${i}`);
    assert.throws(() => finalizeTransaction(changed, f.signatures), /Invalid signature/, label);
  }
});

// Pull PSBT values through the actual host continuation protocol. Independently check
// domain-separated RFC6962-shape proof, then hash the reconstructed preimage.
function proofDirections(size: number, index: number): boolean[] {
  if (size === 1) return [];
  let split = 1; while (split * 2 < size) split *= 2;
  return index < split ? [...proofDirections(split, index), true] : [...proofDirections(size - split, index - split), false];
}
function* leaf(root: Buffer, size: number, index: number): Generator<Buffer, Buffer, Buffer> {
  const response = yield b([0x41], root, cs(size), cs(index));
  const hash = response.subarray(0, 32), length = response[32]!, included = response[33]!;
  assert.equal(length, included); assert.equal(response.length, 34 + 32 * length);
  let folded = Buffer.from(hash);
  const directions = proofDirections(size, index); assert.equal(directions.length, length);
  directions.forEach((left, i) => { const peer = response.subarray(34 + 32 * i, 66 + 32 * i); folded = h(left ? b([1], folded, peer) : b([1], peer, folded)); });
  assert.deepEqual(folded, root);
  const initial = yield b([0x40, 0], hash);
  let at = 0;
  const tag = initial[at++]!;
  const total = tag < 253 ? tag : tag === 253 ? (at += 2, initial.readUInt16LE(at - 2)) : (at += 4, initial.readUInt32LE(at - 4));
  const take = initial[at++]!; assert.equal(initial.length, at + take);
  let preimage = Buffer.from(initial.subarray(at));
  while (preimage.length < total) {
    const more = yield Buffer.from([0xa0]);
    assert.equal(more[1], 1); assert.equal(more.length, 2 + more[0]!);
    preimage = b(preimage, more.subarray(2));
  }
  assert.equal(preimage.length, total); assert.equal(preimage[0], 0); assert.deepEqual(h(preimage), hash);
  return preimage.subarray(1);
}
function* readMap(commitment: Buffer): Generator<Buffer, Map<string, Buffer>, Buffer> {
  assert.equal(commitment.length, 65);
  const size = commitment[0]!, keys = commitment.subarray(1, 33), values = commitment.subarray(33, 65);
  const map = new Map<string, Buffer>();
  for (let i = 0; i < size; i++) map.set((yield* leaf(keys, size, i)).toString("hex"), yield* leaf(values, size, i));
  assert.equal(map.size, size); assert.deepEqual([...map.keys()], [...map.keys()].sort());
  return map;
}
test("Merkle-served PSBT reconstructs exact input order, recipient/change and chunked previous transactions despite caller mutation", async () => {
  const f = fixture("regtest", 3, MAX_GRAINS, true);
  const prev = b(le(1, 4), [1], Buffer.alloc(32), le(0xffffffff, 4), cs(400), Buffer.alloc(400, 0x61), le(0xffffffff, 4), cs(3), ...f.bundle.inputs.map(output), le(0, 4));
  const prevId = h2(prev).reverse().toString("hex");
  f.bundle.inputs.forEach((input, i) => { input.txid = prevId; input.vout = i; });
  f.signatures = independentSign(f.bundle);
  const pristine = structuredClone(f.bundle), expected = independentFinal(pristine, f.signatures), previous = f.bundle.inputs.map(() => Buffer.from(prev));
  let saved = 0, reconstructed = false;
  const transport = transportFor(f, function* (header) {
    assert.equal(header.length, 195);
    const global = yield* readMap(header.subarray(0, 65));
    assert.equal(header[65], 3); assert.equal(header[98], 2);
    const inputMaps = [], outputMaps = [];
    for (let i = 0; i < 3; i++) inputMaps.push(yield* readMap(yield* leaf(header.subarray(66, 98), 3, i)));
    for (let i = 0; i < 2; i++) outputMaps.push(yield* readMap(yield* leaf(header.subarray(99, 131), 2, i)));
    const parsed = parsePrlPsbt(serializePrlPsbt({ globalMap: global, inputMaps, outputMaps }), f.account).bundle;
    assert.deepEqual(parsed, pristine);
    inputMaps.forEach((m, i) => { assert.deepEqual(m.get("00"), prev); assert.equal(m.get("0f")!.readUInt32LE(), i); });
    assert.equal(outputMaps[0]!.get("03")!.readBigUInt64LE(), MAX_GRAINS - 4000n);
    assert.equal(outputMaps[1]!.get("03")!.readBigUInt64LE(), 3000n);
    reconstructed = true;
    for (const i of [2, 0, 1]) yield yieldSignature(pristine, f.signatures, i);
    assert.equal(saved, 1);
    throw new Error("Simulated final ACK loss");
  });
  const client = new LedgerBitcoinPrlClient(transport, "regtest");
  const pending = client.signBundle(f.bundle, f.account, { previousTransactions: previous, onVerifiedSigned(tx) { saved++; assert.equal(tx.rawTx, expected.rawTx); tx.bytes.fill(0); tx.signatures[0]!.fill(0); } });
  f.bundle.inputs.reverse(); f.bundle.outputs[0]!.amount--; previous.forEach(p => p.fill(0));
  const final = await pending;
  assert(reconstructed); assert.equal(saved, 1); assert.equal(final.rawTx, expected.rawTx);
  assert.equal(final.completionWarning, "device-acknowledgement-unconfirmed");
  assert.equal(client.sessionState, "failed"); assert(transport.closed);
  assert(transport.commands.some(a => a[0] === 0xf8 && a[4]! > 250), "Long preimage continuation exercised");
});

for (const phase of ["partial", "complete"] as const) for (const mode of ["duplicate", "unknown-root", "noncanonical-proof", "empty-more", "truncated-yield", "extra-yield-byte", "empty-interrupt"] as const) {
  test(`${phase} signature set followed by hostile ${mode} is terminal and preserves only complete bytes`, async () => {
    const f = fixture("regtest", 2, 9007199254740993n);
    let saved = 0;
    const expected = independentFinal(f.bundle, f.signatures);
    const transport = transportFor(f, function* (header) {
      yield yieldSignature(f.bundle, f.signatures, 0);
      if (phase === "complete") yield yieldSignature(f.bundle, f.signatures, 1);
      if (mode === "duplicate") yield yieldSignature(f.bundle, f.signatures, 0);
      else if (mode === "unknown-root") yield b([0x41], Buffer.alloc(32, 0xfe), [2, 0]);
      else if (mode === "noncanonical-proof") yield b([0x41], header.subarray(66, 98), [253, 2, 0, 0]);
      else if (mode === "empty-more") yield Buffer.from([0xa0]);
      else if (mode === "truncated-yield") yield yieldSignature(f.bundle, f.signatures, 1).subarray(0, 98);
      else if (mode === "extra-yield-byte") yield b(yieldSignature(f.bundle, f.signatures, 1), [0]);
      else yield Buffer.alloc(0);
      assert.fail("Host must not acknowledge malformed continuation");
    });
    const client = new LedgerBitcoinPrlClient(transport, "regtest");
    const pending = client.signBundle(f.bundle, f.account, { onVerifiedSigned(tx) { saved++; assert.equal(tx.rawTx, expected.rawTx); } });
    if (phase === "partial") await assert.rejects(pending);
    else { const result = await pending; assert.equal(result.rawTx, expected.rawTx); assert.equal(result.completionWarning, "device-acknowledgement-unconfirmed"); }
    assert.equal(saved, phase === "complete" ? 1 : 0); assert.equal(client.sessionState, "failed"); assert(transport.closed);
    const calls = transport.commands.length; await assert.rejects(client.capabilities(), /failed/); assert.equal(transport.commands.length, calls);
  });
}

test("imported PSBT bytes/account cannot change during async signing, and storage failure yields an importable exact recovery backup", async () => {
  const f = fixture("regtest", 2, MAX_GRAINS);
  // Wallet recovery deliberately reserves the maximum change index as its
  // exhaustion marker; remain inside that narrower wallet profile here.
  f.bundle.inputs[1]!.index = 8;
  f.bundle.inputs[1]!.scriptPubKey = deriveAddress(f.account, 1, 8).scriptPubKey;
  f.signatures = independentSign(f.bundle);
  const expected = independentFinal(f.bundle, f.signatures), owner = structuredClone(f.account);
  const bytes = Buffer.from(serializePrlPsbt(buildPrlPsbt(f.bundle, f.account)));
  const transport = transportFor(f, function* () {
    yield yieldSignature(f.bundle, f.signatures, 1); yield yieldSignature(f.bundle, f.signatures, 0);
    assert.fail("No ACK after failed durable storage");
  });
  const client = new LedgerBitcoinPrlClient(transport, "regtest");
  // Device metadata must not alias the caller's mutable public account.
  const callerAccount = structuredClone(f.account);
  const pending = client.signPsbt(bytes, callerAccount, { onVerifiedSigned() { throw new Error("simulated disk full"); } });
  bytes.fill(0); callerAccount.publicKey.fill(0); callerAccount.chainCode.fill(0); callerAccount.masterFingerprint.fill(0);
  await assert.rejects(pending, (error: unknown) => {
    assert(error instanceof VerifiedSigningResultError);
    assert.equal(error.signedTransaction.rawTx, expected.rawTx);
    const backup = signedRecoveryBackup(owner, f.bundle, error.signedTransaction, "review-payment-01", 1_800_000_000_000);
    const restored = importWalletBackup(backup);
    assert.equal(restored.journal.payments[0]!.rawTx, expected.rawTx);
    assert.equal(restored.journal.payments[0]!.txid, expected.txid);
    assert.deepEqual(restored.journal.payments[0]!.outpoints, f.bundle.inputs.map(i => `${i.txid}:${i.vout}`));
    return true;
  });
  assert.equal(client.sessionState, "failed"); assert(transport.closed);
});

for (const finalSignature of [false, true]) {
  test(`signature yield interrupts undrained preimage queue: complete=${finalSignature}, no continuation escapes`, async () => {
    const f = fixture("regtest", 2, MAX_GRAINS);
    const prev = b(le(1, 4), [1], Buffer.alloc(32), le(0xffffffff, 4), cs(400), Buffer.alloc(400, 0x62), le(0xffffffff, 4), cs(2), ...f.bundle.inputs.map(output), le(0, 4));
    f.bundle.inputs.forEach((i, n) => { i.txid = h2(prev).reverse().toString("hex"); i.vout = n; });
    f.signatures = independentSign(f.bundle);
    const expected = independentFinal(f.bundle, f.signatures);
    const preimageHash = h(b([0], prev));
    let saved = 0;
    const transport = transportFor(f, function* () {
      if (finalSignature) yield yieldSignature(f.bundle, f.signatures, 0);
      const response = yield b([0x40, 0], preimageHash);
      assert.equal(response[0], 253); assert(response.length < prev.length);
      // A hostile device abandons GET_MORE_ELEMENTS and instead yields a
      // cryptographically valid signature. Retain complete bytes if they exist,
      // but the interpreter must terminally reject the undrained queue.
      yield yieldSignature(f.bundle, f.signatures, 1);
      assert.fail("No ACK allowed after queue interleaving");
    });
    const client = new LedgerBitcoinPrlClient(transport, "regtest");
    const pending = client.signBundle(f.bundle, f.account, { previousTransactions: [prev, prev], onVerifiedSigned(tx) { saved++; assert.equal(tx.rawTx, expected.rawTx); } });
    if (finalSignature) {
      const result = await pending;
      assert.equal(result.rawTx, expected.rawTx); assert.equal(result.completionWarning, "device-acknowledgement-unconfirmed");
    } else await assert.rejects(pending, /Pending continuation queue/);
    assert.equal(saved, finalSignature ? 1 : 0);
    assert.equal(client.sessionState, "failed"); assert(transport.closed);
  });
}

// Source-review follow-up: model a failed native path re-derivation yielding
// account /0/0 over the UNCHANGED approved transaction digest. This does not
// execute native code or establish the fault's reachability on a device.
for (const branch of [0, 1] as const) for (const priorValid of [false, true]) for (const reportedKey of ["fallback", "approved"] as const) {
  test(`device-error defense: approved /${branch}/7, /0/0 signer, priorValid=${priorValid}, key=${reportedKey}`, async () => {
    const f = fixture("regtest", priorValid ? 2 : 1, 9007199254740993n);
    const target = priorValid ? 1 : 0;
    Object.assign(f.bundle.inputs[target]!, { branch, index: 7, scriptPubKey: deriveAddress(f.account, branch, 7).scriptPubKey });
    f.signatures = independentSign(f.bundle);
    const approvedDigest = independentDigest(f.bundle, target);
    const fallbackKey = deriveAddress(f.account, 0, 0).scriptPubKey.slice(2);
    const approvedKey = f.bundle.inputs[target]!.scriptPubKey.slice(2);
    const fallbackSignature = independentSignatureAtPath(f.bundle, target, 0, 0);
    assert.notDeepEqual(fallbackKey, approvedKey);
    // The hostile response is a genuine /0/0 signature on the approved
    // transaction, not a dummy/zero signature or an altered-payment digest.
    assert(schnorr.verify(fallbackSignature, approvedDigest, fallbackKey));
    assert.equal(schnorr.verify(fallbackSignature, approvedDigest, approvedKey), false);
    assert.equal(Buffer.from(computeSighash(f.bundle, target)).toString("hex"), approvedDigest.toString("hex"));
    let saved = 0, yieldedGood = 0, yieldedWrong = 0, faultAcknowledged = false;
    const transport = transportFor(f, function* () {
      if (priorValid) { yieldedGood++; yield yieldSignature(f.bundle, f.signatures, 0); }
      yieldedWrong++;
      yield b([0x10, target, 32], reportedKey === "fallback" ? fallbackKey : approvedKey, fallbackSignature);
      faultAcknowledged = true;
      return undefined;
    });
    const client = new LedgerBitcoinPrlClient(transport, "regtest");
    await assert.rejects(client.signBundle(f.bundle, f.account, { onVerifiedSigned() { saved++; } }), (error: unknown) => {
      assert(error instanceof Error); assert.match(error.message, /Device signature failed independent verification/);
      assert.equal(error instanceof VerifiedSigningResultError, false);
      assert.equal("signedTransaction" in error, false);
      return true;
    });
    assert.equal(yieldedGood, Number(priorValid)); assert.equal(yieldedWrong, 1);
    assert.equal(saved, 0); assert.equal(faultAcknowledged, false);
    assert.equal(client.sessionState, "failed"); assert(transport.closed);
    const calls = transport.commands.length;
    assert.equal(calls, priorValid ? 5 : 4);
    await assert.rejects(client.capabilities(), /failed/); assert.equal(transport.commands.length, calls);
  });
}

for (const yieldedIndex of [undefined, 0, 1] as const) {
  test(`device-error defense: SW_OK with ${yieldedIndex === undefined ? "zero signatures" : `only signature ${yieldedIndex}`} never completes payment`, async () => {
    const f = fixture("regtest", 2, MAX_GRAINS);
    // Explicit nonzero receive/change paths, matching the reviewed failure context.
    f.bundle.inputs.forEach((input, i) => Object.assign(input, { branch: i as 0 | 1, index: 7, scriptPubKey: deriveAddress(f.account, i as 0 | 1, 7).scriptPubKey }));
    f.signatures = independentSign(f.bundle);
    let saved = 0, swOkReturned = false;
    const transport = transportFor(f, function* () {
      if (yieldedIndex !== undefined) yield yieldSignature(f.bundle, f.signatures, yieldedIndex);
      swOkReturned = true;
      return undefined; // transportFor converts this to the genuine 0x9000 response.
    });
    const client = new LedgerBitcoinPrlClient(transport, "regtest");
    await assert.rejects(client.signBundle(f.bundle, f.account, { onVerifiedSigned() { saved++; } }), (error: unknown) => {
      assert(error instanceof Error); assert.match(error.message, /Missing native signature/);
      assert.equal(error instanceof VerifiedSigningResultError, false);
      assert.equal("signedTransaction" in error, false);
      return true;
    });
    assert(swOkReturned); assert.equal(saved, 0); assert.equal(client.sessionState, "failed"); assert(transport.closed);
    const calls = transport.commands.length;
    assert.equal(calls, yieldedIndex === undefined ? 4 : 5);
    await assert.rejects(client.capabilities(), /failed/); assert.equal(transport.commands.length, calls);
  });
}
