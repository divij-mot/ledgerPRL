import { setup, flush } from "./harness.ts";
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const timers = new Map<
  ReturnType<typeof setTimeout>,
  { ms: number | undefined; stack: string | undefined }
>();
globalThis.setTimeout = ((
  callback: (...args: any[]) => void,
  ms: number | undefined,
  ...args: any[]
) => {
  const handle = realSetTimeout(() => {
    timers.delete(handle);
    callback(...args);
  }, ms);
  timers.set(handle, { ms, stack: new Error().stack });
  return handle;
}) as typeof setTimeout;
globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
  timers.delete(handle);
  return realClearTimeout(handle);
}) as typeof clearTimeout;
const h = setup();
const transport = await h.ledger.connectLedger();
console.log("After connection", [...timers.values()]);
const ev = new Event("disconnect");
Object.assign(ev, { device: h.device });
h.hid.dispatchEvent(ev);
await flush();
console.log("After physical-disconnect event and cleanup", [
  ...timers.values(),
]);
h.assertClean();
await transport.close();
console.log("State", {
  events: h.state.events,
  closes: h.device.closes,
  listeners: h.listeners(),
  callbacks: typeof h.device.oninputreport,
});
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;

await new Promise<void>((resolve) => realSetTimeout(resolve, 6_050));
console.log("After retention deadline", {
  timers: [...timers.values()],
  sessions: h.state.dmks.map((dmk) => dmk.listConnectedDevices().length),
  reports: h.device.reports.length,
  opens: h.device.opens,
  closes: h.device.closes,
});
h.assertClean();
