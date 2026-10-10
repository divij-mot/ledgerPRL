import { assert, formatPrl, MAX_INPUTS, parsePrl } from "@pearl-ledger/sdk";
import {
  DEFAULT_RELAY_POLICY,
  exactKeys,
  record,
  preparePayment,
  previewPaymentPolicy,
  type PaymentRequest,
  type WatchSnapshot,
} from "@pearl-ledger/wallet";
import type { BlockbookSource } from "./blockbook-source.js";
import { selectPaymentInputs } from "./coin-selection.js";

export const FEE_TARGETS = [1, 10, 25] as const;
export const FEE_QUOTE_LIFETIME_MS = 120_000;
export interface FeeQuote {
  blocks: (typeof FEE_TARGETS)[number];
  network: "mainnet" | "testnet2";
  grainsPerKvB: bigint;
  receivedAt: number;
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

/** Explicit quote choice; preserve amount and round its total fee upward to whole grains. */
export function quotedPayment(
  snapshot: WatchSnapshot,
  request: PaymentRequest,
  reserved: ReadonlySet<string>,
  quote: FeeQuote,
  manualSelection: boolean,
  now = Date.now(),
): PaymentRequest {
  assert(
    quote.network === snapshot.account.network,
    "Fee estimate network mismatch",
  );
  assert(
    Number.isSafeInteger(quote.receivedAt) &&
      now >= quote.receivedAt &&
      now - quote.receivedAt <= FEE_QUOTE_LIFETIME_MS,
    "Fee estimate expired; refresh estimates",
  );
  assert(
    FEE_TARGETS.includes(quote.blocks) &&
      quote.grainsPerKvB >= DEFAULT_RELAY_POLICY.minRelayFeeGrainsPerKvB,
    "Fee estimate unavailable or below relay policy",
  );
  const forSize = (size: number) =>
    (quote.grainsPerKvB * BigInt(size) + 999n) / 1000n;
  let fee = forSize(previewPaymentPolicy(snapshot, request, reserved).vsize);
  // A larger fee may require another input. Only increase during this bounded
  // calculation, avoiding change/no-change oscillation; show the exact result before choice.
  for (let attempt = 0; attempt <= MAX_INPUTS; attempt++) {
    const next = {
      ...request,
      feePrl: formatPrl(fee),
      selected: manualSelection
        ? request.selected
        : selectPaymentInputs(
            snapshot,
            request.amountPrl,
            formatPrl(fee),
            reserved,
          ),
    };
    const required = forSize(
      previewPaymentPolicy(snapshot, next, reserved).vsize,
    );
    if (required > fee) {
      fee = required;
      continue;
    }
    preparePayment(snapshot, next, reserved);
    return next;
  }
  throw new Error("Fee estimate could not settle; enter a manual fee");
}
