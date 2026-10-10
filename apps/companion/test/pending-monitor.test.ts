import test from "node:test";
import assert from "node:assert/strict";
import { PendingMonitor, type PendingView } from "../src/pending-monitor.js";

function setup(count = 1) {
  let now = 0,
    serial = 0;
  const timers = new Map<number, { due: number; work: () => void }>();
  const clock = {
    now: () => now,
    set(work: () => void, delay: number) {
      timers.set(++serial, { due: now + delay, work });
      return serial as unknown as ReturnType<typeof setTimeout>;
    },
    clear(timer: ReturnType<typeof setTimeout>) {
      timers.delete(timer as unknown as number);
    },
  };
  const initial: PendingView = {
    owner: {},
    selection: null,
    transactions: Array.from({ length: count }, (_, i) => ({
      txid: String(i),
      status: "pending",
    })),
  };
  let view: PendingView | null = initial;
  const reads: string[] = [];
  let refreshes = 0;
  let read = async (_id: string, _signal: AbortSignal) => "pending";
  const monitor = new PendingMonitor(
    () => view,
    (id, signal) => {
      reads.push(id);
      return read(id, signal);
    },
    async (_signal, current) => {
      assert(current());
      refreshes++;
    },
    clock,
  );
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    monitor,
    reads,
    initial,
    refreshes: () => refreshes,
    setRead: (fn: typeof read) => {
      read = fn;
    },
    setView: (next: PendingView | null) => {
      view = next;
      monitor.update();
    },
    async advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers])
        if (timer.due <= now) {
          timers.delete(id);
          timer.work();
        }
      await settle();
    },
    settle,
  };
}
test("absolute early deadline survives rendering; unchanged pending costs one read/minute", async () => {
  const t = setup();
  t.monitor.update();
  await t.advance(4000);
  t.monitor.update();
  await t.advance(1000);
  assert.deepEqual(t.reads, ["0"]);
  for (let i = 0; i < 10; i++) t.monitor.update();
  await t.advance(59_999);
  assert.equal(t.reads.length, 1);
  await t.advance(1);
  assert.equal(t.reads.length, 2);
  assert.equal(t.refreshes(), 0);
});
test("at most four reads per cycle rotate fairly through known payments", async () => {
  const t = setup(7);
  t.monitor.update();
  await t.advance(5000);
  assert.deepEqual(t.reads, ["0", "1", "2", "3"]);
  await t.advance(60_000);
  assert.deepEqual(t.reads.slice(4), ["4", "5", "6", "0"]);
});
test("multiple status changes request one full scan per cycle", async () => {
  const t = setup(4);
  t.setRead(async () => "205:block");
  t.monitor.update();
  await t.advance(5000);
  assert.equal(t.reads.length, 4);
  assert.equal(t.refreshes(), 1);
  t.setView({ ...t.initial, transactions: [] });
  await t.advance(60_000);
  assert.equal(t.reads.length, 4);
});
test("hidden, busy, review, local and closed contexts cannot poll; returning resumes deadline", async () => {
  const t = setup();
  t.monitor.update();
  await t.advance(5000);
  t.setView(null);
  await t.advance(120_000);
  assert.equal(t.reads.length, 1);
  t.setView(t.initial);
  await t.advance(0);
  assert.equal(t.reads.length, 2);
});
test("missing or unavailable transactions never refresh or retry inside a cycle", async () => {
  const t = setup(4);
  t.setRead(async () => {
    throw Error("Unavailable or missing");
  });
  t.monitor.update();
  await t.advance(5000);
  assert.equal(t.reads.length, 4);
  assert.equal(t.refreshes(), 0);
  await t.advance(59_999);
  assert.equal(t.reads.length, 4);
});
for (const reason of ["owner", "selection", "hidden"] as const)
  test(`${reason} change aborts in-flight work and excludes late response`, async () => {
    const t = setup();
    let release!: (value: string) => void;
    let signal!: AbortSignal;
    t.setRead(async (_id, s) => {
      signal = s;
      return new Promise((r) => {
        release = r;
      });
    });
    t.monitor.update();
    await t.advance(5000);
    t.setView(
      reason === "hidden"
        ? null
        : {
            ...t.initial,
            ...(reason === "owner" ? { owner: {} } : { selection: "other" }),
          },
    );
    assert(signal.aborted);
    release("205:block");
    await t.settle();
    assert.equal(t.refreshes(), 0);
  });
