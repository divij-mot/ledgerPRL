import {
  assert,
  exactKeys,
  concat,
  fromHex,
  hex,
  i32,
  Reader,
  u32,
  u64,
} from "./bytes.js";
import { checkedGrains, parseGrains, sumGrains } from "./amount.js";
import {
  checkedBranch,
  checkedIndex,
  network,
  networkFromId,
  type NetworkName,
} from "./network.js";
import {
  assertOwnedScript,
  scriptToAddress,
  validateAccount,
  validateP2trScript,
  type AccountPublicKey,
} from "./keys.js";
export const MAX_INPUTS = 16;
export const MAX_BUNDLE_SIZE = 1507;
export interface BundleInput {
  txid: string;
  vout: number;
  amount: bigint;
  scriptPubKey: Uint8Array;
  sequence: number;
  branch: 0 | 1;
  index: number;
}
export interface BundleOutput {
  amount: bigint;
  scriptPubKey: Uint8Array;
  role: "recipient" | "change";
  branch: 0 | 1;
  index: number;
}
export interface SigningBundle {
  network: NetworkName;
  account: number;
  version: 1;
  lockTime: 0;
  inputs: BundleInput[];
  outputs: BundleOutput[];
}
export function validateBundle(
  bundle: SigningBundle,
  account?: AccountPublicKey,
): { inputTotal: bigint; outputTotal: bigint; fee: bigint } {
  exactKeys(
    bundle,
    ["network", "account", "version", "lockTime", "inputs", "outputs"],
    "bundle",
  );
  network(bundle.network);
  checkedIndex(bundle.account);
  assert(
    bundle.version === 1 && bundle.lockTime === 0,
    "Only version 1 and locktime 0 supported",
  );
  assert(
    Array.isArray(bundle.inputs) &&
      bundle.inputs.length >= 1 &&
      bundle.inputs.length <= MAX_INPUTS,
    "Input count outside limit",
  );
  assert(
    Array.isArray(bundle.outputs) &&
      bundle.outputs.length >= 1 &&
      bundle.outputs.length <= 2,
    "Output count outside limit",
  );
  if (account) {
    validateAccount(account);
    assert(
      account.network === bundle.network && account.account === bundle.account,
      "Account/network mismatch",
    );
  }
  const seen = new Set<string>();
  for (const input of bundle.inputs) {
    exactKeys(
      input,
      ["txid", "vout", "amount", "scriptPubKey", "sequence", "branch", "index"],
      "input",
    );
    assert(
      typeof input.txid === "string" && /^[0-9a-f]{64}$/.test(input.txid),
      "txid must be canonical lowercase display hex",
    );
    u32(input.vout);
    checkedGrains(input.amount, false);
    validateP2trScript(input.scriptPubKey);
    assert(input.sequence === 0xffffffff, "Unsupported input sequence");
    checkedBranch(input.branch);
    checkedIndex(input.index);
    const key = `${input.txid}:${input.vout}`;
    assert(!seen.has(key), "Duplicate input outpoint");
    seen.add(key);
    if (account)
      assertOwnedScript(account, input.branch, input.index, input.scriptPubKey);
  }
  let recipients = 0,
    changes = 0;
  for (const output of bundle.outputs) {
    exactKeys(
      output,
      ["amount", "scriptPubKey", "role", "branch", "index"],
      "output",
    );
    checkedGrains(output.amount, false);
    validateP2trScript(output.scriptPubKey);
    checkedBranch(output.branch);
    checkedIndex(output.index);
    if (output.role === "recipient") {
      recipients++;
      assert(
        output.branch === 0 && output.index === 0,
        "Recipient must not declare key origin",
      );
    } else {
      assert(output.role === "change", "Unsupported output role");
      changes++;
      assert(output.branch === 1, "Change must use branch 1");
      if (account)
        assertOwnedScript(account, 1, output.index, output.scriptPubKey);
    }
  }
  assert(
    recipients === 1 && changes <= 1,
    "Exactly one recipient and at most one change required",
  );
  const inputTotal = sumGrains(bundle.inputs.map((i) => i.amount));
  const outputTotal = sumGrains(bundle.outputs.map((o) => o.amount));
  assert(outputTotal <= inputTotal, "Outputs exceed inputs");
  return { inputTotal, outputTotal, fee: inputTotal - outputTotal };
}
export function encodeBundle(bundle: SigningBundle): Uint8Array {
  validateBundle(bundle);
  return concat(
    new TextEncoder().encode("PRL1"),
    Uint8Array.of(network(bundle.network).id),
    u32(bundle.account),
    i32(bundle.version),
    u32(bundle.lockTime),
    Uint8Array.of(bundle.inputs.length, bundle.outputs.length),
    ...bundle.inputs.map((i) =>
      concat(
        fromHex(i.txid).reverse(),
        u32(i.vout),
        u64(i.amount),
        i.scriptPubKey,
        u32(i.sequence),
        Uint8Array.of(i.branch),
        u32(i.index),
      ),
    ),
    ...bundle.outputs.map((o) =>
      concat(
        u64(o.amount),
        o.scriptPubKey,
        Uint8Array.of(o.role === "recipient" ? 0 : 1, o.branch),
        u32(o.index),
      ),
    ),
  );
}
export function decodeBundle(bytes: Uint8Array): SigningBundle {
  assert(
    bytes instanceof Uint8Array && bytes.length <= MAX_BUNDLE_SIZE,
    "Bundle too large",
  );
  const r = new Reader(bytes);
  assert(hex(r.take(4)) === "50524c31", "Invalid bundle magic");
  const name = networkFromId(r.byte()),
    account = r.u32(),
    version = r.i32(),
    lockTime = r.u32(),
    inputsCount = r.byte(),
    outputsCount = r.byte();
  assert(version === 1 && lockTime === 0, "Unsupported version/locktime");
  assert(
    inputsCount >= 1 &&
      inputsCount <= MAX_INPUTS &&
      outputsCount >= 1 &&
      outputsCount <= 2,
    "Invalid bundle counts",
  );
  assert(
    bytes.length === 19 + 87 * inputsCount + 48 * outputsCount,
    "Incorrect bundle size",
  );
  const inputs: BundleInput[] = [];
  for (let i = 0; i < inputsCount; i++)
    inputs.push({
      txid: hex(r.take(32).reverse()),
      vout: r.u32(),
      amount: r.u64(),
      scriptPubKey: r.take(34),
      sequence: r.u32(),
      branch: checkedBranch(r.byte()),
      index: r.u32(),
    });
  const outputs: BundleOutput[] = [];
  for (let i = 0; i < outputsCount; i++) {
    const amount = r.u64(),
      scriptPubKey = r.take(34),
      role = r.byte(),
      branch = checkedBranch(r.byte()),
      index = r.u32();
    assert(role === 0 || role === 1, "Invalid output role");
    outputs.push({
      amount,
      scriptPubKey,
      role: role === 0 ? "recipient" : "change",
      branch,
      index,
    });
  }
  r.end();
  const bundle: SigningBundle = {
    network: name,
    account,
    version,
    lockTime,
    inputs,
    outputs,
  };
  validateBundle(bundle);
  return bundle;
}
export function bundleToJson(bundle: SigningBundle) {
  validateBundle(bundle);
  return {
    ...bundle,
    inputs: bundle.inputs.map((i) => ({
      ...i,
      amount: i.amount.toString(),
      scriptPubKey: hex(i.scriptPubKey),
    })),
    outputs: bundle.outputs.map((o) => ({
      ...o,
      amount: o.amount.toString(),
      scriptPubKey: hex(o.scriptPubKey),
    })),
  };
}
export function bundleFromJson(value: unknown): SigningBundle {
  exactKeys(
    value,
    ["network", "account", "version", "lockTime", "inputs", "outputs"],
    "bundle JSON",
  );
  const v = value as Record<string, unknown>;
  assert(
    Array.isArray(v.inputs) && Array.isArray(v.outputs),
    "Missing inputs/outputs",
  );
  const bundle = {
    ...v,
    inputs: v.inputs.map((i) => {
      exactKeys(
        i,
        [
          "txid",
          "vout",
          "amount",
          "scriptPubKey",
          "sequence",
          "branch",
          "index",
        ],
        "input JSON",
      );
      return {
        ...i,
        amount: parseGrains(i.amount as string),
        scriptPubKey: fromHex(i.scriptPubKey as string),
      };
    }),
    outputs: v.outputs.map((o) => {
      exactKeys(
        o,
        ["amount", "scriptPubKey", "role", "branch", "index"],
        "output JSON",
      );
      return {
        ...o,
        amount: parseGrains(o.amount as string),
        scriptPubKey: fromHex(o.scriptPubKey as string),
      };
    }),
  } as SigningBundle;
  validateBundle(bundle);
  return bundle;
}
export function inspectBundle(bundle: SigningBundle) {
  const sums = validateBundle(bundle);
  return {
    network: bundle.network,
    account: bundle.account,
    inputs: bundle.inputs.length,
    ...sums,
    outputs: bundle.outputs.map((o) => ({
      role: o.role,
      address: scriptToAddress(o.scriptPubKey, bundle.network),
      amount: o.amount,
    })),
  };
}
