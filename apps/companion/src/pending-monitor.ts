/** Read-only hints trigger a full account scan; they never authorize spending. */
export type PendingView = {
  owner: object;
  selection: string | null;
  transactions: { txid: string; status: string }[];
};
type Clock = {
  now(): number;
  set(work: () => void, delay: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
};
const clock: Clock = {
  now: () => Date.now(),
  set: (work, delay) => {
    const timer = setTimeout(work, delay);
    timer.unref?.();
    return timer;
  },
  clear: (timer) => clearTimeout(timer),
};
export class PendingMonitor {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: AbortController | undefined;
  private owner?: object;
  private selection: string | null = null;
  private nextAt = 0;
  private cursor = 0;
  private known = new Set<string>();
  constructor(
    private readonly view: () => PendingView | null,
    private readonly read: (
      txid: string,
      signal: AbortSignal,
    ) => Promise<string>,
    private readonly refresh: (
      signal: AbortSignal,
      current: () => boolean,
    ) => Promise<void>,
    private readonly time: Clock = clock,
  ) {}
  stop() {
    if (this.timer !== undefined) this.time.clear(this.timer);
    this.timer = undefined;
    this.active?.abort();
  }
  update() {
    if (this.timer !== undefined) this.time.clear(this.timer);
    this.timer = undefined;
    const view = this.view();
    if (!view?.transactions.length) {
      this.active?.abort();
      return;
    }
    if (view.owner !== this.owner || view.selection !== this.selection) {
      this.active?.abort();
      const ownerChanged = view.owner !== this.owner;
      this.owner = view.owner;
      this.selection = view.selection;
      if (ownerChanged) {
        this.cursor = 0;
        this.known.clear();
        this.nextAt = this.time.now() + 5_000;
      }
    }
    // A newly submitted payment gets one early check. Rendering the same view
    // never moves its absolute deadline or adds repeated requests.
    if (view.transactions.some(({ txid }) => !this.known.has(txid)))
      this.nextAt = Math.min(this.nextAt, this.time.now() + 5_000);
    this.known = new Set(view.transactions.map(({ txid }) => txid));
    if (this.active) return;
    this.timer = this.time.set(
      () => void this.poll(),
      Math.max(0, this.nextAt - this.time.now()),
    );
  }
  private async poll() {
    this.timer = undefined;
    const view = this.view();
    if (!view?.transactions.length) return;
    const controller = new AbortController();
    this.active = controller;
    this.nextAt = this.time.now() + 60_000;
    const current = () => {
      const next = this.view();
      return (
        !controller.signal.aborted &&
        next?.owner === view.owner &&
        next.selection === view.selection
      );
    };
    try {
      let changed = false;
      const count = Math.min(4, view.transactions.length);
      for (let i = 0; i < count && current(); i++) {
        const tx = view.transactions[this.cursor++ % view.transactions.length]!;
        try {
          const status = await this.read(tx.txid, controller.signal);
          if (current() && status !== tx.status) changed = true;
        } catch {
          // Missing, unavailable and malformed responses preserve the view.
        }
      }
      if (changed && current()) await this.refresh(controller.signal, current);
    } catch {
      // A failed full scan never becomes a balance or reservation update.
    } finally {
      if (this.active === controller) this.active = undefined;
      this.update();
    }
  }
}
