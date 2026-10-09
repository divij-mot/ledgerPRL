import {
  type AccountPublicKey,
  fromHex,
  deriveAddress,
  concat,
  i32,
  compactSize,
  u32,
  u64,
  hex,
  hash256,
  type NetworkName,
  NETWORKS,
} from "@pearl-ledger/sdk";
/** Public-only deterministic fixture. No seed/private-key material exists in this fixture. */
export const publicAccount: AccountPublicKey = {
  network: "regtest",
  account: 0,
  masterFingerprint: fromHex("11223344"),
  publicKey: fromHex(
    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  ),
  chainCode: new Uint8Array(32).fill(0x42),
};
export const blockHash = (height: number) =>
  height.toString(16).padStart(64, "0");
export function rawTransaction(
  amount = 500_000_000n,
  index = 0,
  coinbase = true,
  account = publicAccount,
) {
  const script = deriveAddress(account, 0, index).scriptPubKey;
  const raw = concat(
    i32(1),
    Uint8Array.of(1),
    new Uint8Array(32).fill(coinbase ? 0 : 0x11),
    u32(coinbase ? 0xffffffff : 0),
    Uint8Array.of(2, 1, index),
    u32(0xffffffff),
    Uint8Array.of(1),
    u64(amount),
    compactSize(script.length),
    script,
    u32(0),
  );
  return {
    rawTransaction: hex(raw),
    txid: hex(hash256(raw).reverse()),
    vout: 0,
    branch: 0,
    index,
    block: { height: 1, hash: blockHash(1) },
  };
}
export function snapshotFixture(
  coins = [rawTransaction()],
  height = 200,
  network: NetworkName = "regtest",
) {
  const account = { ...publicAccount, network };
  return {
    schema: 1,
    account: {
      ...account,
      masterFingerprint: hex(account.masterFingerprint),
      publicKey: hex(account.publicKey),
      chainCode: hex(account.chainCode),
    },
    genesisHash: NETWORKS[network].genesisHash,
    tip: { height, hash: blockHash(height) },
    coverage: {
      externalScannedThrough: 19,
      changeScannedThrough: 19,
      gapLimit: 20,
    },
    coins,
  };
}
