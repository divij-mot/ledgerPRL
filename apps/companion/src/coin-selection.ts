import {
  assert,
  formatPrl,
  MAX_INPUTS,
  parsePrl,
  sumGrains,
} from "@pearl-ledger/sdk";
import {
  coinEligibility,
  DEFAULT_DUST_GRAINS,
  outpoint,
  preparePayment,
  type PaymentRequest,
  type WatchSnapshot,
} from "@pearl-ledger/wallet";

export function selectablePaymentCoins(
  snapshot: WatchSnapshot,
  reserved: ReadonlySet<string>,
) {
  return snapshot.coins
    .filter(
      (coin) =>
        !reserved.has(outpoint(coin)) &&
        coinEligibility(coin, snapshot.tip) === "eligible",
    )
    .slice()
    .sort((a, b) =>
      a.amount === b.amount
        ? outpoint(a).localeCompare(outpoint(b))
        : a.amount > b.amount
          ? -1
          : 1,
    );
}

/** Prefer fewer inputs without changing the user's amount or exact fee. */
export function selectPaymentInputs(
  snapshot: WatchSnapshot,
  amount: string,
  fee: string,
  reserved: ReadonlySet<string>,
): string[] {
  const target = parsePrl(amount) + parsePrl(fee);
  assert(target > 0n, "Enter an amount to send");
  const coins = selectablePaymentCoins(snapshot, reserved);
  const selected: string[] = [];
  let total = 0n;
  for (const coin of coins.slice(0, MAX_INPUTS)) {
    selected.push(outpoint(coin));
    total += coin.amount;
    if (total === target || total >= target + DEFAULT_DUST_GRAINS)
      return selected;
  }
  assert(
    total >= target,
    coins.length > MAX_INPUTS
      ? "This payment needs more than 16 inputs. Send a smaller amount or choose inputs in coin control."
      : "Insufficient available balance for this amount and fee.",
  );
  throw new Error(
    "The remaining change is too small. Adjust the amount or choose inputs in coin control; the fee is never increased automatically.",
  );
}

/** Max spends only the chosen eligible inputs and never adjusts the explicit fee. */
export function maximumPayment(
  snapshot: WatchSnapshot,
  request: Omit<PaymentRequest, "selected" | "amountPrl">,
  reserved: ReadonlySet<string>,
  selection?: readonly string[],
): PaymentRequest {
  const selected = selection
    ? [...selection]
    : selectablePaymentCoins(snapshot, reserved)
        .slice(0, MAX_INPUTS)
        .map(outpoint);
  assert(
    selected.length > 0 &&
      selected.length <= MAX_INPUTS &&
      new Set(selected).size === selected.length,
    "Select 1–16 available inputs for Max",
  );
  const total = sumGrains(
    selected.map((id) => {
      const coin = snapshot.coins.find((item) => outpoint(item) === id);
      assert(coin, "Selected UTXO is missing");
      assert(!reserved.has(id), "Selected UTXO is already reserved");
      assert(
        coinEligibility(coin, snapshot.tip) === "eligible",
        "Input is unconfirmed or immature",
      );
      return coin.amount;
    }),
  );
  const fee = parsePrl(request.feePrl);
  assert(total > fee, "The selected balance must exceed the fee");
  const maximum = { ...request, selected, amountPrl: formatPrl(total - fee) };
  // Apply the same dust, exact-size relay and ownership policy as preparation.
  preparePayment(snapshot, maximum, reserved);
  return maximum;
}
