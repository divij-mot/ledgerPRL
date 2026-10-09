import { HDKey } from "@scure/bip32";
import { bech32m } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { assert, exactKeys, concat, equal, hex, fromHex } from "./bytes.js";
import {
  network,
  checkedIndex,
  checkedBranch,
  derivationPath,
  type NetworkName,
} from "./network.js";
export { sha256 };
export interface AccountPublicKey {
  network: NetworkName;
  account: number;
  masterFingerprint: Uint8Array;
  publicKey: Uint8Array;
  chainCode: Uint8Array;
}
export function taggedHash(tag: string, ...messages: Uint8Array[]): Uint8Array {
  const h = sha256(new TextEncoder().encode(tag));
  return sha256(concat(h, h, ...messages));
}
export function validateAccount(account: AccountPublicKey): void {
  network(account.network);
  checkedIndex(account.account);
  assert(
    account.masterFingerprint instanceof Uint8Array &&
      account.masterFingerprint.length === 4,
    "Invalid master fingerprint",
  );
  assert(
    account.chainCode instanceof Uint8Array && account.chainCode.length === 32,
    "Invalid chaincode",
  );
  assert(
    account.publicKey instanceof Uint8Array &&
      account.publicKey.length === 33 &&
      (account.publicKey[0] === 2 || account.publicKey[0] === 3),
    "Invalid compressed account key",
  );
  secp256k1.ProjectivePoint.fromHex(account.publicKey).assertValidity();
}
/** Account exports contain only public material. No seed/private-key import surface exists. */
export function derivePublicKey(
  account: AccountPublicKey,
  branch: 0 | 1,
  index: number,
): Uint8Array {
  validateAccount(account);
  checkedBranch(branch);
  checkedIndex(index);
  const root = new HDKey({
    publicKey: account.publicKey,
    chainCode: account.chainCode,
    depth: 3,
    index: 0x80000000 + account.account,
  });
  const branchKey = root.deriveChild(branch);
  assert(
    branchKey.index === branch,
    "BIP32 skipped branch: policy refuses path ambiguity",
  );
  const child = branchKey.deriveChild(index);
  assert(
    child.index === index,
    "BIP32 skipped index: policy refuses path ambiguity",
  );
  assert(child.publicKey, "Public derivation failed");
  return child.publicKey;
}
export function taprootOutputKey(publicKey: Uint8Array): Uint8Array {
  assert(
    publicKey.length === 32 || publicKey.length === 33,
    "Invalid internal key length",
  );
  assert(
    publicKey.length === 32 || publicKey[0] === 2 || publicKey[0] === 3,
    "Invalid compressed internal key prefix",
  );
  const x = publicKey.slice(-32);
  const point = secp256k1.ProjectivePoint.fromHex(concat(Uint8Array.of(2), x));
  const tweak = BigInt("0x" + hex(taggedHash("TapTweak", x)));
  assert(tweak < secp256k1.CURVE.n, "Invalid TapTweak scalar");
  const output =
    tweak === 0n
      ? point
      : point.add(secp256k1.ProjectivePoint.BASE.multiply(tweak));
  assert(!output.equals(secp256k1.ProjectivePoint.ZERO), "Invalid tweaked key");
  return output.toRawBytes(true).slice(1);
}
export function validateP2trScript(script: Uint8Array): void {
  assert(
    script instanceof Uint8Array &&
      script.length === 34 &&
      script[0] === 0x51 &&
      script[1] === 0x20,
    "Only witness v1 32-byte P2TR is supported",
  );
  secp256k1.ProjectivePoint.fromHex(
    concat(Uint8Array.of(2), script.slice(2)),
  ).assertValidity();
}
export function scriptToAddress(script: Uint8Array, name: NetworkName): string {
  validateP2trScript(script);
  return bech32m.encode(network(name).hrp, [
    1,
    ...bech32m.toWords(script.slice(2)),
  ]);
}
export function addressToScript(
  address: string,
  name: NetworkName,
): Uint8Array {
  assert(
    typeof address === "string" && address.length <= 90,
    "Invalid address",
  );
  const decoded = bech32m.decode(address as `${string}1${string}`, 90);
  assert(decoded.prefix === network(name).hrp, "Wrong address network");
  assert(decoded.words[0] === 1, "Only witness v1 recipients supported");
  const program = bech32m.fromWords(decoded.words.slice(1));
  const script = concat(Uint8Array.of(0x51, 0x20), program);
  validateP2trScript(script);
  return script;
}
export function deriveAddress(
  account: AccountPublicKey,
  branch: 0 | 1,
  index: number,
) {
  const publicKey = derivePublicKey(account, branch, index);
  const internalKey = publicKey.slice(1);
  const outputKey = taprootOutputKey(publicKey);
  const scriptPubKey = concat(Uint8Array.of(0x51, 0x20), outputKey);
  return {
    address: scriptToAddress(scriptPubKey, account.network),
    scriptPubKey,
    internalKey,
    outputKey,
    path: derivationPath(account.network, account.account, branch, index),
  };
}
export function assertOwnedScript(
  account: AccountPublicKey,
  branch: 0 | 1,
  index: number,
  script: Uint8Array,
): void {
  assert(
    equal(deriveAddress(account, branch, index).scriptPubKey, script),
    "Script is not empty-tree Taproot for the declared account/path",
  );
}
export function accountToJson(a: AccountPublicKey) {
  validateAccount(a);
  return {
    network: a.network,
    account: a.account,
    masterFingerprint: hex(a.masterFingerprint),
    publicKey: hex(a.publicKey),
    chainCode: hex(a.chainCode),
  };
}
export function accountFromJson(value: unknown): AccountPublicKey {
  exactKeys(
    value,
    ["network", "account", "masterFingerprint", "publicKey", "chainCode"],
    "public account",
  );
  const v = value as Record<string, unknown>;
  assert(
    typeof v.masterFingerprint === "string" &&
      typeof v.publicKey === "string" &&
      typeof v.chainCode === "string",
    "Public account keys must be hex",
  );
  const a = {
    network: v.network as NetworkName,
    account: v.account as number,
    masterFingerprint: fromHex(v.masterFingerprint),
    publicKey: fromHex(v.publicKey),
    chainCode: fromHex(v.chainCode),
  };
  validateAccount(a);
  return a;
}
