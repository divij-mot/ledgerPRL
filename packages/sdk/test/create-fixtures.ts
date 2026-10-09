/** TEST-ONLY public BIP32 vector seed. Never use these publicly known keys with funds. */
import { HDKey } from "@scure/bip32";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1";
import { writeFileSync } from "node:fs";
import {
  accountToJson,
  bundleToJson,
  computeSighash,
  deriveAddress,
  encodeBundle,
  finalizeTransaction,
  fromHex,
  hex,
  sha256,
  taggedHash,
  type AccountPublicKey,
  type SigningBundle,
} from "../src/index.js";
const master = HDKey.fromMasterSeed(
  fromHex("000102030405060708090a0b0c0d0e0f"),
);
const account = master.derive("m/86'/1'/0'");
const publicAccount: AccountPublicKey = {
  network: "regtest",
  account: 0,
  masterFingerprint: fromHex(master.fingerprint.toString(16).padStart(8, "0")),
  publicKey: account.publicKey!,
  chainCode: account.chainCode!,
};
const input = deriveAddress(publicAccount, 0, 0),
  second = deriveAddress(publicAccount, 0, 7),
  change = deriveAddress(publicAccount, 1, 0),
  recipient = deriveAddress(publicAccount, 0, 99);
const bundle: SigningBundle = {
  network: "regtest",
  account: 0,
  version: 1,
  lockTime: 0,
  inputs: [
    {
      txid: "11".repeat(32),
      vout: 1,
      amount: 9007199254740993n,
      scriptPubKey: input.scriptPubKey,
      sequence: 0xffffffff,
      branch: 0,
      index: 0,
    },
    {
      txid: "22".repeat(32),
      vout: 3,
      amount: 1_000_000_000n,
      scriptPubKey: second.scriptPubKey,
      sequence: 0xffffffff,
      branch: 0,
      index: 7,
    },
  ],
  outputs: [
    {
      amount: 9007199254740000n,
      scriptPubKey: recipient.scriptPubKey,
      role: "recipient",
      branch: 0,
      index: 0,
    },
    {
      amount: 999_999_993n,
      scriptPubKey: change.scriptPubKey,
      role: "change",
      branch: 1,
      index: 0,
    },
  ],
};
const signatures = bundle.inputs.map((input, i) => {
  const key = account.deriveChild(input.branch).deriveChild(input.index);
  let secret = BigInt("0x" + hex(key.privateKey!));
  if (key.publicKey![0] === 3) secret = secp256k1.CURVE.n - secret;
  const tweaked =
    (secret +
      BigInt("0x" + hex(taggedHash("TapTweak", key.publicKey!.slice(1))))) %
    secp256k1.CURVE.n;
  return schnorr.sign(
    computeSighash(bundle, i),
    fromHex(tweaked.toString(16).padStart(64, "0")),
    new Uint8Array(32),
  );
});
const finalized = finalizeTransaction(bundle, signatures);
writeFileSync(
  new URL("../../../fixtures/protocol-v1.json", import.meta.url),
  JSON.stringify(
    {
      description:
        "PUBLIC TEST VECTOR ONLY. BIP32 vector 1 public seed. Never deposit funds at these addresses.",
      publicAccount: accountToJson(publicAccount),
      bundle: bundleToJson(bundle),
      bundleHex: hex(encodeBundle(bundle)),
      bundleSha256: hex(sha256(encodeBundle(bundle))),
      sighashes: bundle.inputs.map((_, i) => hex(computeSighash(bundle, i))),
      addresses: {
        input: input.address,
        second: second.address,
        recipient: recipient.address,
        change: change.address,
      },
      signatures: signatures.map(hex),
      rawTx: finalized.rawTx,
      txid: finalized.txid,
      wtxid: finalized.wtxid,
      vsize: finalized.vsize,
    },
    null,
    2,
  ) + "\n",
);
