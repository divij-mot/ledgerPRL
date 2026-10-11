import { base58check } from "@scure/base";
import {
  accountFromJson,
  accountToJson,
  assert,
  checkedIndex,
  equal,
  fromHex,
  hex,
  MAX_GRAINS,
  MAX_INPUTS,
  network,
  networkFromId,
  sha256,
  validateAccount,
  type AccountPublicKey,
  type NetworkName,
} from "@pearl-ledger/sdk";
import { DefaultWalletPolicy } from "./upstream/policy.js";

export const BITCOIN_PRL_PROTOCOL = Object.freeze({
  cla: 0xe1,
  version: 1,
  GET_EXTENDED_PUBKEY: 0x00,
  GET_WALLET_ADDRESS: 0x03,
  SIGN_PSBT: 0x04,
  GET_MASTER_FINGERPRINT: 0x05,
  GET_NETWORK_INFO: 0x06,
  FRAMEWORK_CLA: 0xf8,
  CONTINUE: 0x01,
});
export interface PrlNetworkInfo {
  readonly protocol: "ledger-bitcoin-prl-v1";
  readonly network: NetworkName;
  readonly coinType: number;
  readonly genesisHash: string;
  readonly maxMoney: bigint;
  readonly maxInputs: number;
  readonly maxOutputs: number;
  readonly capabilityFlags: number;
}
/** The binding is required on every operation. Bitcoin/PRL1 apps fail closed. */
export function parseNetworkInfo(
  bytes: Uint8Array,
  expectedNetwork: NetworkName,
): PrlNetworkInfo {
  assert(
    bytes instanceof Uint8Array && bytes.length === 58,
    "Invalid PRL network info length",
  );
  assert(
    hex(bytes.slice(0, 4)) === "50524c42" && bytes[4] === 1,
    "Unsupported PRL app/protocol",
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const name = networkFromId(bytes[5]!);
  const config = network(expectedNetwork);
  assert(
    name === expectedNetwork && view.getUint32(6) === config.coinType,
    "Wrong device network or coin type",
  );
  assert(
    equal(bytes.slice(10, 42), fromHex(config.genesisHash)),
    "Wrong device genesis",
  );
  const maxMoney = view.getBigUint64(42),
    maxInputs = view.getUint16(50),
    maxOutputs = view.getUint16(52),
    capabilityFlags = view.getUint32(54);
  assert(maxMoney === MAX_GRAINS, "Wrong device maximum amount");
  assert(
    maxInputs === MAX_INPUTS && maxOutputs === 2,
    "Unsupported native transaction limits",
  );
  assert(capabilityFlags === 3, "Unsupported native signing profile");
  return {
    protocol: "ledger-bitcoin-prl-v1",
    network: name,
    coinType: config.coinType,
    genesisHash: config.genesisHash,
    maxMoney,
    maxInputs,
    maxOutputs,
    capabilityFlags,
  };
}
const base58 = base58check(sha256);
export interface AccountXpub {
  readonly xpub: string;
  readonly account: AccountPublicKey;
  readonly parentFingerprint: Uint8Array;
}
/** xpub/tpub are Ledger policy transport versions, not Pearl wallet import prefixes. */
export function parseAccountXpub(
  xpub: string,
  fingerprint: Uint8Array,
  name: NetworkName,
  account: number,
): AccountXpub {
  checkedIndex(account);
  network(name);
  assert(
    typeof xpub === "string" && xpub.length >= 100 && xpub.length <= 120,
    "Invalid account xpub length",
  );
  assert(
    fingerprint instanceof Uint8Array && fingerprint.length === 4,
    "Invalid master fingerprint",
  );
  const bytes = base58.decode(xpub);
  assert(
    bytes.length === 78 && base58.encode(bytes) === xpub,
    "Invalid serialized account xpub",
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(
    view.getUint32(0) === (name === "mainnet" ? 0x0488b21e : 0x043587cf),
    "Wrong Ledger policy xpub version",
  );
  assert(
    bytes[4] === 3 && view.getUint32(9) === 0x80000000 + account,
    "Account xpub depth/index mismatch",
  );
  const result: AccountPublicKey = {
    network: name,
    account,
    masterFingerprint: fingerprint.slice(),
    chainCode: bytes.slice(13, 45),
    publicKey: bytes.slice(45),
  };
  validateAccount(result);
  return { xpub, account: result, parentFingerprint: bytes.slice(5, 9) };
}
export function snapshotAccount(account: AccountPublicKey): AccountPublicKey {
  return accountFromJson(accountToJson(account));
}
export function assertSameAccount(
  actual: AccountPublicKey,
  expected: AccountPublicKey,
): void {
  validateAccount(actual);
  validateAccount(expected);
  assert(
    actual.network === expected.network &&
      actual.account === expected.account &&
      equal(actual.masterFingerprint, expected.masterFingerprint) &&
      equal(actual.publicKey, expected.publicKey) &&
      equal(actual.chainCode, expected.chainCode),
    "Device account differs from approved public account",
  );
}
/** Only the unnamed standard BIP86 policy is reachable from this adapter. */
export function createPrlWalletPolicy(
  account: AccountPublicKey,
  xpub: string,
): DefaultWalletPolicy {
  const parsed = parseAccountXpub(
    xpub,
    account.masterFingerprint,
    account.network,
    account.account,
  );
  assertSameAccount(parsed.account, account);
  const key = `[${hex(account.masterFingerprint)}/86'/${network(account.network).coinType}'/${account.account}']${xpub}`;
  return new DefaultWalletPolicy("tr(@0/**)", key);
}
export function u32be(value: number): Uint8Array {
  assert(
    Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
    "Invalid u32",
  );
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}
