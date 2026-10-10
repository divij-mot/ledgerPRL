import type { ChainTip, HistoryEntry } from "@pearl-ledger/wallet";

export function historyConfirmations(
  entry: HistoryEntry,
  tip: ChainTip | undefined,
  historyTip: ChainTip | null,
): number | null {
  if (
    entry.state !== "confirmed" ||
    !entry.block ||
    !tip ||
    !historyTip ||
    tip.hash !== historyTip.hash ||
    tip.height !== historyTip.height ||
    entry.block.height > tip.height
  )
    return null;
  return tip.height - entry.block.height + 1;
}

export function pageItems<T>(
  items: readonly T[],
  requestedPage: number,
  size = 10,
) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  return { items: items.slice(page * size, (page + 1) * size), page, pages };
}
