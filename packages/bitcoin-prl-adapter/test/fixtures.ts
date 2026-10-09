/** Test-only published BIP32 vector 1. These addresses must never receive funds. */
import { readFileSync } from "node:fs";
import { HDKey } from "@scure/bip32";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1";
import {
  accountFromJson,
  bundleFromJson,
  computeSighash,
  concat,
  deriveAddress,
  fromHex,
  hex,
  MAX_GRAINS,
  network,
  taggedHash,
  type AccountPublicKey,
  type NetworkName,
  type SigningBundle,
} from "@pearl-ledger/sdk";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
export function publicFixture() {
  return {
    account: accountFromJson(fixture.publicAccount),
    bundle: bundleFromJson(fixture.bundle),
    signatures: fixture.signatures.map(fromHex) as Uint8Array[],
    rawTx: fixture.rawTx as string,
    txid: fixture.txid as string,
    wtxid: fixture.wtxid as string,
  };
}
export function testAccount(name: NetworkName = "regtest", account = 0) {
  // Public BIP32 specification vector. Test-only signing, never an application API.
  const master = HDKey.fromMasterSeed(
    fromHex("000102030405060708090a0b0c0d0e0f"),
    name === "mainnet"
      ? { public: 0x0488b21e, private: 0x0488ade4 }
      : { public: 0x043587cf, private: 0x04358394 },
  );
  const child = master.derive(`m/86'/${network(name).coinType}'/${account}'`);
  const publicAccount: AccountPublicKey = {
    network: name,
    account,
    masterFingerprint: fromHex(
      master.fingerprint.toString(16).padStart(8, "0"),
    ),
    publicKey: child.publicKey!,
    chainCode: child.chainCode!,
  };
  return {
    master,
    child,
    account: publicAccount,
    xpub: child.publicExtendedKey,
  };
}
export function signFixture(bundle: SigningBundle): Uint8Array[] {
  const account = testAccount(bundle.network, bundle.account).child;
  return bundle.inputs.map((input, i) => {
    const key = account.deriveChild(input.branch).deriveChild(input.index);
    let scalar = BigInt("0x" + hex(key.privateKey!));
    if (key.publicKey![0] === 3) scalar = secp256k1.CURVE.n - scalar;
    scalar =
      (scalar +
        BigInt("0x" + hex(taggedHash("TapTweak", key.publicKey!.slice(1))))) %
      secp256k1.CURVE.n;
    return schnorr.sign(
      computeSighash(bundle, i),
      fromHex(scalar.toString(16).padStart(64, "0")),
      new Uint8Array(32),
    );
  });
}
export function networkInfo(name: NetworkName = "regtest"): Uint8Array {
  const bytes = new Uint8Array(58),
    view = new DataView(bytes.buffer),
    net = network(name);
  bytes.set(new TextEncoder().encode("PRLB"));
  bytes[4] = 1;
  bytes[5] = net.id;
  view.setUint32(6, net.coinType);
  bytes.set(fromHex(net.genesisHash), 10);
  view.setBigUint64(42, MAX_GRAINS);
  view.setUint16(50, 16);
  view.setUint16(52, 2);
  view.setUint32(54, 3);
  return bytes;
}
export function yielded(
  bundle: SigningBundle,
  signatures: readonly Uint8Array[],
  index: number,
) {
  return concat(
    Uint8Array.of(0x10, index, 32),
    bundle.inputs[index]!.scriptPubKey.slice(2),
    signatures[index]!,
  );
}
export function withAmount(amount: bigint): SigningBundle {
  const { bundle } = publicFixture();
  return {
    ...bundle,
    inputs: [{ ...bundle.inputs[0]!, amount }],
    outputs: [{ ...bundle.outputs[0]!, amount: amount - 1000n }],
  };
}
export function p2mrFixture() {
  const { account, bundle } = publicFixture();
  bundle.outputs[0]!.scriptPubKey = concat(
    Uint8Array.of(0x52, 0x20),
    new Uint8Array(32),
  );
  return {
    account,
    bundle,
    signatures: signFixture(bundle),
    address: deriveAddress(account, 0, 0).address,
  };
}
