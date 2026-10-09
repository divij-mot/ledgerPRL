import { assert } from "./bytes.js";
export type NetworkName =
  | "mainnet"
  | "testnet"
  | "testnet2"
  | "regtest"
  | "simnet";
export interface Network {
  readonly id: number;
  readonly name: NetworkName;
  readonly hrp: string;
  readonly coinType: number;
  readonly genesisHash: string;
}
export const NETWORKS: Readonly<Record<NetworkName, Network>> = Object.freeze({
  mainnet: Object.freeze({
    id: 0,
    name: "mainnet",
    hrp: "prl",
    coinType: 808276,
    genesisHash:
      "a18d3093b7ff618f0cdd073fa3d10374e2e0105fe7ef53ff48b55f41c58dadd7",
  }),
  testnet: Object.freeze({
    id: 1,
    name: "testnet",
    hrp: "tprl",
    coinType: 1,
    genesisHash:
      "10f0be7be9950f74021d0f7c62989d1e2541c4d46f3c95b74e61679864b43d18",
  }),
  testnet2: Object.freeze({
    id: 2,
    name: "testnet2",
    hrp: "tprl",
    coinType: 1,
    genesisHash:
      "b0c86d0cd8825f4d72260d2de46f470429eece413811d5d82b5f2e2ea0336f96",
  }),
  regtest: Object.freeze({
    id: 3,
    name: "regtest",
    hrp: "rprl",
    coinType: 1,
    genesisHash:
      "78d0ab27df6a51a8e9dbbdefffca1ebbbeb3818cb083ce2c2f43b047247e5832",
  }),
  simnet: Object.freeze({
    id: 4,
    name: "simnet",
    hrp: "rprl",
    coinType: 1,
    genesisHash:
      "78d0ab27df6a51a8e9dbbdefffca1ebbbeb3818cb083ce2c2f43b047247e5832",
  }),
});
export function network(name: NetworkName): Network {
  assert(
    typeof name === "string" && Object.hasOwn(NETWORKS, name),
    "Unknown Pearl network",
  );
  return NETWORKS[name];
}
export function networkFromId(id: number): NetworkName {
  const found = Object.values(NETWORKS).find((n) => n.id === id);
  assert(found, "Unknown network ID");
  return found.name;
}
export function checkedIndex(value: number): number {
  assert(
    Number.isInteger(value) && value >= 0 && value < 0x80000000,
    "Invalid non-hardened index",
  );
  return value;
}
export function checkedBranch(value: number): 0 | 1 {
  assert(value === 0 || value === 1, "Invalid branch");
  return value;
}
export function accountPath(name: NetworkName, account: number): string {
  return `m/86'/${network(name).coinType}'/${checkedIndex(account)}'`;
}
export function derivationPath(
  name: NetworkName,
  account: number,
  branch: number,
  index: number,
): string {
  return `${accountPath(name, account)}/${checkedBranch(branch)}/${checkedIndex(index)}`;
}
