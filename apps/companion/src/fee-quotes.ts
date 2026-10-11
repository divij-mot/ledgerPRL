import {
  assert,
  checkedGrains,
  deriveAddress,
  formatPrl,
  MAX_INPUTS,
  parsePrl,
  serializeOutput,
  sumGrains,
  type NetworkName,
} from "@pearl-ledger/sdk";
import {
  DEFAULT_RELAY_POLICY,
  exactKeys,
  outpoint,
  record,
  preparePayment,
  previewPaymentPolicy,
  type PaymentRequest,
  type WatchSnapshot,
} from "@pearl-ledger/wallet";
import type { BlockbookSource } from "./blockbook-source.js";
import { maximumPayment, selectablePaymentCoins } from "./coin-selection.js";

export const FEE_TARGETS = [1, 10, 25] as const;
export const FEE_QUOTE_LIFETIME_MS = 120_000;
export interface FeeQuote {
  blocks: (typeof FEE_TARGETS)[number];
  network: "mainnet" | "testnet2";
  grainsPerKvB: bigint;
  receivedAt: number;
}

/** Approximate target time, never a confirmation guarantee. Pinned Pearl
 * 2f8b770 node/chaincfg/params.go sets mainnet and testnet2 to 194 seconds. */
export function confirmationTime(blocks: FeeQuote["blocks"]): string {
  assert(FEE_TARGETS.includes(blocks), "Unsupported fee target");
  const minutes = Math.round((blocks * 194) / 60);
  const hours = Math.floor(minutes / 60),
    remaining = minutes % 60;
  return hours
    ? `≈${hours} h${remaining ? ` ${remaining} min` : ""}`
    : `≈${minutes} min`;
}

/** Pearl EstimateFee uses virtual size and returns PRL/kvB; never parse through Number. */
export function parseFeeQuote(
  value: unknown,
  blocks: FeeQuote["blocks"],
  network: FeeQuote["network"],
  receivedAt = Date.now(),
): FeeQuote {
  assert(FEE_TARGETS.includes(blocks), "Unsupported fee target");
  assert(
    network === "mainnet" || network === "testnet2",
    "Unsupported fee network",
  );
  const result = record(value, "fee estimate");
  exactKeys(result, ["result"], "fee estimate");
  assert(
    typeof result.result === "string",
    "Fee estimate must be a decimal PRL/kvB string",
  );
  const grainsPerKvB = parsePrl(result.result);
  assert(
    grainsPerKvB >= DEFAULT_RELAY_POLICY.minRelayFeeGrainsPerKvB,
    "Fee estimate unavailable or below relay policy",
  );
  return { blocks, network, grainsPerKvB, receivedAt };
}

export async function loadFeeQuotes(
  source: BlockbookSource,
): Promise<FeeQuote[]> {
  await source.tip();
  const quotes = await Promise.all(
    FEE_TARGETS.map(async (blocks) => {
      try {
        return parseFeeQuote(
          await source.get(`/api/v1/estimatefee/${blocks}`),
          blocks,
          source.network,
        );
      } catch {
        return undefined;
      }
    }),
  );
  return quotes.filter((quote): quote is FeeQuote => quote !== undefined);
}

function checkedRate(grainsPerKvB: bigint): bigint {
  checkedGrains(grainsPerKvB, false);
  assert(
    grainsPerKvB >= DEFAULT_RELAY_POLICY.minRelayFeeGrainsPerKvB,
    "Fee rate is below the pinned relay floor",
  );
  return grainsPerKvB;
}
function feeForSize(grainsPerKvB: bigint, vsize: number): bigint {
  return checkedGrains((grainsPerKvB * BigInt(vsize) + 999n) / 1000n, false);
}
function inputCandidates(
  snapshot: WatchSnapshot,
  reserved: ReadonlySet<string>,
  selection?: readonly string[],
) {
  if (selection) return [[...selection]];
  const available = selectablePaymentCoins(snapshot, reserved)
    .slice(0, MAX_INPUTS)
    .map(outpoint);
  assert(available.length > 0, "No available unreserved confirmed inputs");
  return available.map((_, i) => available.slice(0, i + 1));
}

/** Shared exact-size probe; the supported payment profile has one recipient and optional change. */
function selectedShape(
  snapshot: WatchSnapshot,
  request: Pick<PaymentRequest, "recipient" | "changeIndex">,
  selected: readonly string[],
  reserved: ReadonlySet<string>,
) {
  assert(
    selected.length > 0 &&
      selected.length <= MAX_INPUTS &&
      new Set(selected).size === selected.length,
    "Select 1–16 distinct available inputs",
  );
  const total = sumGrains(
    selected.map((id) => {
      const coin = snapshot.coins.find(
        (candidate) => outpoint(candidate) === id,
      );
      assert(coin, "Selected UTXO is missing");
      return coin.amount;
    }),
  );
  // A zero-fee size probe also enforces current ownership, maturity and reservations.
  // No size-probe request is returned or prepared for signing.
  const noChange = previewPaymentPolicy(
    snapshot,
    {
      ...request,
      selected: [...selected],
      amountPrl: formatPrl(total),
      feePrl: "0",
    },
    reserved,
  );
  // Adding the second output changes no CompactSize prefix or witness length.
  const changeBytes = serializeOutput({
    amount: 0n,
    scriptPubKey: deriveAddress(snapshot.account, 1, request.changeIndex)
      .scriptPubKey,
  }).length;
  return {
    total,
    noChangeVsize: noChange.vsize,
    changeVsize: noChange.vsize + changeBytes,
    dust: noChange.dustThreshold,
  };
}

/** Calculate an explicit rate, not a live estimate. Preserve amount; never absorb dust into fees. */
export function paymentAtRate(
  snapshot: WatchSnapshot,
  request: Omit<PaymentRequest, "feePrl">,
  reserved: ReadonlySet<string>,
  grainsPerKvB: bigint,
  manualSelection: boolean,
): PaymentRequest {
  const rate = checkedRate(grainsPerKvB),
    amount = parsePrl(request.amountPrl);
  assert(amount > 0n, "Enter a positive amount to send");
  const candidates = inputCandidates(
    snapshot,
    reserved,
    manualSelection ? request.selected : undefined,
  );
  let smallChange = false;
  // Evaluate each bounded input prefix once, with both exact output shapes.
  // This cannot oscillate between change/no-change fees when an input is added.
  for (const selected of candidates) {
    const shape = selectedShape(snapshot, request, selected, reserved);
    assert(
      amount >= shape.dust,
      "Recipient amount is dust under the pinned relay policy",
    );
    const excess = shape.total - amount;
    const noChangeFee = feeForSize(rate, shape.noChangeVsize);
    let fee: bigint | undefined;
    if (excess === noChangeFee) fee = noChangeFee;
    else {
      const changeFee = feeForSize(rate, shape.changeVsize);
      if (excess >= changeFee + shape.dust) fee = changeFee;
    }
    if (fee === undefined) {
      smallChange ||= excess >= noChangeFee;
      continue;
    }
    const next = {
      ...request,
      selected: [...selected],
      feePrl: formatPrl(fee),
    };
    preparePayment(snapshot, next, reserved);
    return next;
  }
  assert(
    !smallChange,
    "Remaining change is too small at this fee rate; choose more inputs or use Max",
  );
  throw new Error(
    "Available inputs do not cover the amount and fee within the limit of 16 inputs",
  );
}

/** Explicit Max changes only the amount/fee and uses the requested eligible input set. */
export function maximumPaymentAtRate(
  snapshot: WatchSnapshot,
  request: Pick<PaymentRequest, "recipient" | "changeIndex">,
  reserved: ReadonlySet<string>,
  grainsPerKvB: bigint,
  selection?: readonly string[],
): PaymentRequest {
  const rate = checkedRate(grainsPerKvB);
  let best: { selected: string[]; fee: bigint; amount: bigint } | undefined;
  // Larger eligible coins come first. Compare each size so uneconomic extra
  // inputs cannot reduce Max; an explicit manual selection remains exact.
  for (const selected of inputCandidates(snapshot, reserved, selection)) {
    const shape = selectedShape(snapshot, request, selected, reserved);
    const fee = feeForSize(rate, shape.noChangeVsize),
      amount = shape.total - fee;
    if (!best || amount > best.amount) best = { selected, fee, amount };
  }
  assert(best, "Select available inputs for Max");
  return maximumPayment(
    snapshot,
    { ...request, feePrl: formatPrl(best.fee) },
    reserved,
    best.selected,
  );
}

/** Validate a live quote independently of the caller's selected transaction inputs. */
export function quoteRate(
  quote: FeeQuote,
  network: NetworkName,
  now = Date.now(),
): bigint {
  assert(
    (quote.network === "mainnet" || quote.network === "testnet2") &&
      quote.network === network,
    "Fee estimate network mismatch",
  );
  assert(
    Number.isSafeInteger(now) &&
      Number.isSafeInteger(quote.receivedAt) &&
      now >= quote.receivedAt &&
      now - quote.receivedAt <= FEE_QUOTE_LIFETIME_MS,
    "Fee estimate expired; refresh estimates",
  );
  assert(
    FEE_TARGETS.includes(quote.blocks),
    "Fee estimate unavailable or below relay policy",
  );
  return checkedRate(quote.grainsPerKvB);
}

/** Explicit quote choice; preserve amount and round its total fee upward to whole grains. */
export function quotedPayment(
  snapshot: WatchSnapshot,
  request: PaymentRequest,
  reserved: ReadonlySet<string>,
  quote: FeeQuote,
  manualSelection: boolean,
  now = Date.now(),
): PaymentRequest {
  const rate = quoteRate(quote, snapshot.account.network, now);
  // Retain quote application’s stale-selection admission check. Automatic fee
  // calculation itself does not depend on a previously entered total fee.
  previewPaymentPolicy(snapshot, request, reserved);
  return paymentAtRate(snapshot, request, reserved, rate, manualSelection);
}
