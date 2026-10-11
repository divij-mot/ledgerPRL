/** Private parent/child JSONL protocol. No HTTP listener or caller-supplied URL. */
export interface PublicAccount {
  network: "mainnet";
  account: 0;
  masterFingerprint: string;
  publicKey: string;
  chainCode: string;
}
export interface ProfileRequest {
  dataDir: string;
  account: PublicAccount;
  minimumIndex: [number, number];
}
export interface Tip { height: number; hash: string }
export interface LightStatus {
  schema: 1;
  sourceCommit: "2f8b770cac8f8b74be05c1fc51c2baeb76ce0701";
  watchOnly: true;
  network: "mainnet";
  account: 0;
  publicAccount: PublicAccount;
  genesisHash: string;
  tip: Tip;
  headerHeight: number;
  filterHeight: number;
  bestPeerHeight: number;
  connections: number;
  walletSynced: boolean;
  /** Native peer/header/filter/wallet readiness, independent of address coverage. */
  synced: boolean;
  ready: boolean;
  registeredThrough: [number, number];
  lastUsed: [number, number];
  needsRegistration: boolean;
  /** Register stopped all native workers and rewound the database. Await exit, then restart. */
  restartRequired: boolean;
  coverage: {
    externalScannedThrough: number;
    changeScannedThrough: number;
    gapLimit: 20;
    /** Bounds alone are registration, not a completed historical scan. */
    scanComplete: boolean;
  };
}
export interface LightSnapshot extends LightStatus {
  complete: true;
  transactions: Array<{ txid: string; rawTransaction: string; block: Tip | null }>;
  unspent: Array<{ txid: string; vout: number }>;
}
export type LightRequest =
  | { id: string; method: "status" | "snapshot"; params: Record<string, never> }
  | { id: string; method: "register"; params: { minimumIndex: [number, number] } }
  | { id: string; method: "blockHash"; params: { height: number } }
  | { id: string; method: "broadcast"; params: { rawTransaction: string; expectedTxid: string } };
export type LightResponse =
  | { id: string; result: LightStatus | LightSnapshot | { height: number; hash: string; tip: Tip } | { txid: string } }
  | { id: string; error: { code: "UNAVAILABLE" | "BROADCAST_UNKNOWN"; message: string } };
