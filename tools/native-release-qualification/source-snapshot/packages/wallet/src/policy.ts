import {
  assert,
  checkedGrains,
  compactSize,
  formatPrl,
  MAX_GRAINS,
  serializeOutput,
  serializeUnsignedTransaction,
  validateBundle,
  type SigningBundle,
} from "@pearl-ledger/sdk";

/** Relay policy from pinned Pearl 2f8b770/node/mempool/policy.go, not consensus. */
export interface RelayPolicy {
  readonly minRelayFeeGrainsPerKvB: bigint;
}
export const DEFAULT_RELAY_POLICY: Readonly<RelayPolicy> = Object.freeze({
  minRelayFeeGrainsPerKvB: 1000n,
});
const MAX_INT64 = (1n << 63n) - 1n;
function rate(policy: RelayPolicy): bigint {
  return checkedGrains(policy.minRelayFeeGrainsPerKvB);
}
/** Exact upstream floor, including its nonzero-rate fallback and overflow cap. */
export function minimumRelayFee(
  vsize: number,
  policy: RelayPolicy = DEFAULT_RELAY_POLICY,
): bigint {
  assert(
    Number.isSafeInteger(vsize) && vsize > 0,
    "Invalid transaction virtual size",
  );
  const relayRate = rate(policy),
    product = BigInt(vsize) * relayRate;
  if (product > MAX_INT64) return MAX_GRAINS;
  let minimum = product / 1000n;
  if (minimum === 0n && relayRate > 0n) minimum = relayRate;
  return minimum > MAX_GRAINS ? MAX_GRAINS : minimum;
}
function dustForOutput(scriptPubKey: Uint8Array, policy: RelayPolicy): bigint {
  // Pearl's witness dust policy uses a discounted 107-byte typical spend,
  // even for P2TR; it is distinct from our exact 64-byte key-path witness.
  const serialized = serializeOutput({ amount: 0n, scriptPubKey }).length;
  const spendSize = 32 + 4 + compactSize(0).length + 4 + Math.ceil(107 / 4);
  const scaled = BigInt(3 * (serialized + spendSize)) * rate(policy);
  return (scaled + 999n) / 1000n;
}
/** Only serialized length matters here; this is not an address or spendable output. */
export const DEFAULT_DUST_GRAINS = dustForOutput(
  new Uint8Array(34),
  DEFAULT_RELAY_POLICY,
);
export function inspectPaymentPolicy(
  bundle: SigningBundle,
  policy: RelayPolicy = DEFAULT_RELAY_POLICY,
) {
  const { fee } = validateBundle(bundle);
  const strippedSize = serializeUnsignedTransaction(bundle).length;
  // Marker/flag + a one-item witness with one 64-byte SIGHASH_DEFAULT signature.
  const witnessSize =
    2 +
    bundle.inputs.length *
      (compactSize(1).length + compactSize(64).length + 64);
  const vsize = strippedSize + Math.ceil(witnessSize / 4);
  return {
    inputCount: bundle.inputs.length,
    outputCount: bundle.outputs.length,
    vsize,
    fee,
    minimumFee: minimumRelayFee(vsize, policy),
    dustThreshold: dustForOutput(bundle.outputs[0]!.scriptPubKey, policy),
  };
}
/** Apply only to new preparation/signing. Existing signed backups remain readable. */
export function assertPaymentPolicy(
  bundle: SigningBundle,
  policy: RelayPolicy = DEFAULT_RELAY_POLICY,
) {
  const result = inspectPaymentPolicy(bundle, policy);
  assert(
    result.fee >= result.minimumFee,
    `Fee below declared relay policy: ${result.vsize} vB requires at least ${formatPrl(result.minimumFee)} PRL (${result.minimumFee} grains). Edit the fee explicitly.`,
  );
  for (const output of bundle.outputs) {
    const minimum = dustForOutput(output.scriptPubKey, policy);
    assert(
      output.amount >= minimum,
      `${output.role === "change" ? "Change" : "Recipient"} is dust under the declared relay policy; minimum ${minimum} grains. Edit the amount, fee or input selection.`,
    );
  }
  return result;
}
