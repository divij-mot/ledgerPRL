/** Host-only: actual production ledger.ts + installed DMK/WebHID, synthetic HID API. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { build } from "esbuild";
import { Observable } from "rxjs";
import type { DeviceManagementKit } from "@ledgerhq/device-management-kit";

const require = createRequire(import.meta.url);
const realDmk: typeof import("@ledgerhq/device-management-kit") = require("@ledgerhq/device-management-kit");
const root = fileURLToPath(new URL("../../", import.meta.url));
async function bundle(entry: string, external: string[]) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external,
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}
function evaluate<T>(source: string, resolve: (name: string) => unknown): T {
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    resolve,
    module,
    module.exports,
  );
  return module.exports as T;
}
const hidCode = await bundle(
  root + "node_modules/@ledgerhq/device-transport-kit-web-hid/lib/esm/index.js",
  ["@ledgerhq/device-management-kit", "rxjs", "purify-ts", "@sentry/minimal"],
);
const realHid = evaluate<
  typeof import("@ledgerhq/device-transport-kit-web-hid")
>(hidCode, require);
const ledgerCode = await bundle(root + "apps/companion/src/ledger.ts", [
  "@ledgerhq/device-management-kit",
  "@ledgerhq/device-transport-kit-web-hid",
  "rxjs",
]);

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
export async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise<void>((r) => setImmediate(r));
}
export async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await flush();
  }
  assert(check(), "Expected deterministic boundary was not reached");
}
export type Fault =
  | "start-sync"
  | "start-error"
  | "start-empty"
  | "stop-sync"
  | "stop-reject"
  | "connect-sync"
  | "connect-reject"
  | "connect-after-session";
export type Options = {
  chooser?: () => Promise<SyntheticDevice[]>;
  devices?: () => Promise<SyntheticDevice[]>;
  open?: () => Promise<void>;
  ping?: "reply" | "pending" | "send-reject";
  fault?: Fault;
  stopGate?: Promise<void>;
  closeThrows?: boolean;
  destroyThrows?: boolean;
};
export class SyntheticDevice {
  vendorId = 0x2c97;
  productId = 0x4011; // DMK's actual Nano X model mapping.
  productName = "Synthetic public-fixture HID";
  opened = false;
  oninputreport: ((event: { data: DataView }) => void) | null = null;
  opens = 0;
  closes = 0;
  reports: Uint8Array[] = [];
  constructor(readonly options: Options) {}
  async open() {
    this.opens++;
    await this.options.open?.();
    this.opened = true;
  }
  async close() {
    this.closes++;
    this.opened = false;
  }
  async sendReport(_id: number, report: Uint8Array) {
    this.reports.push(report.slice());
    if (this.options.ping === "send-reject")
      throw new DOMException("Synthetic report send failed", "NetworkError");
    if (this.options.ping === "pending") return;
    // No signing endpoint: only the installed DMK's public getAppAndVersion ping.
    const apdu = report.slice(7, 7 + ((report[5]! << 8) | report[6]!));
    assert.equal(
      Buffer.from(apdu).toString("hex"),
      "b001000000",
      "Unexpected application APDU in initial connection harness",
    );
    const response = Uint8Array.from([
      1,
      5,
      ...Buffer.from("Pearl"),
      5,
      ...Buffer.from("1.0.0"),
      1,
      0,
      0x90,
      0,
    ]);
    const frame = new Uint8Array(64);
    frame.set(report.subarray(0, 5));
    frame[5] = response.length >> 8;
    frame[6] = response.length & 255;
    frame.set(response, 7);
    setImmediate(() =>
      this.oninputreport?.({ data: new DataView(frame.buffer) }),
    );
  }
}
class SyntheticHid extends EventTarget {
  requests = 0;
  enumerations = 0;
  constructor(
    readonly device: SyntheticDevice,
    readonly options: Options,
  ) {
    super();
  }
  async requestDevice() {
    this.requests++;
    return this.options.chooser ? this.options.chooser() : [this.device];
  }
  async getDevices() {
    this.enumerations++;
    return this.options.devices ? this.options.devices() : [this.device];
  }
}
export function setup(options: Options = {}) {
  globalThis.fetch = () => {
    throw Error("Network prohibited in connection cleanup review");
  };
  const device = new SyntheticDevice(options);
  const hid = new SyntheticHid(device, options);
  const state = {
    dmks: [] as DeviceManagementKit[],
    factories: [] as Array<ReturnType<typeof realHid.webHidTransportFactory>>,
    starts: 0,
    stops: 0,
    connects: 0,
    disconnects: 0,
    closes: 0,
    destroys: 0,
    subscriptions: 0,
    events: [] as string[],
    sessionOptions: [] as unknown[],
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { hid },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: { isSecureContext: true },
    configurable: true,
    writable: true,
  });
  class ObservedBuilder extends realDmk.DeviceManagementKitBuilder {
    override build() {
      const dmk = super.build();
      state.dmks.push(dmk);
      const start = dmk.startDiscovering.bind(dmk);
      const stop = dmk.stopDiscovering.bind(dmk);
      const connect = dmk.connect.bind(dmk);
      const disconnect = dmk.disconnect.bind(dmk);
      const close = dmk.close.bind(dmk);
      dmk.startDiscovering = (args) => {
        state.starts++;
        state.events.push("start");
        // Force ordinary factory resolution before fault injection to exercise cleanup.
        const source = start(args);
        if (options.fault === "start-sync") throw Error("Injected start-sync");
        return new Observable((subscriber) => {
          state.subscriptions++;
          if (options.fault === "start-error") {
            subscriber.error(Error("Injected start-error"));
            state.subscriptions--;
            return;
          }
          if (options.fault === "start-empty") {
            subscriber.complete();
            state.subscriptions--;
            return;
          }
          const subscription = source.subscribe(subscriber);
          return () => {
            subscription.unsubscribe();
            state.subscriptions--;
          };
        });
      };
      dmk.stopDiscovering = () => {
        state.stops++;
        state.events.push("stop");
        if (options.fault === "stop-sync") throw Error("Injected stop-sync");
        if (options.fault === "stop-reject")
          return Promise.reject(Error("Injected stop-reject"));
        return options.stopGate ? options.stopGate.then(() => stop()) : stop();
      };
      dmk.connect = (args) => {
        state.connects++;
        state.events.push("connect");
        state.sessionOptions.push(args.sessionRefresherOptions);
        if (options.fault === "connect-sync")
          throw Error("Injected connect-sync");
        if (options.fault === "connect-reject")
          return Promise.reject(Error("Injected connect-reject"));
        if (options.fault === "connect-after-session")
          return connect(args).then(() => {
            throw Error("Injected connect-after-session");
          });
        return connect(args);
      };
      dmk.disconnect = (args) => {
        state.disconnects++;
        state.events.push("disconnect");
        return disconnect(args);
      };
      dmk.close = () => {
        state.closes++;
        state.events.push("close");
        close();
        if (options.closeThrows)
          throw Error("Injected close failure after actual cleanup");
      };
      return dmk;
    }
  }
  const ledger = evaluate<typeof import("../../apps/companion/src/ledger.js")>(
    ledgerCode,
    (name) => {
      if (name === "@ledgerhq/device-management-kit")
        return { ...realDmk, DeviceManagementKitBuilder: ObservedBuilder };
      if (name === "@ledgerhq/device-transport-kit-web-hid")
        return {
          ...realHid,
          webHidTransportFactory: (
            ...args: Parameters<typeof realHid.webHidTransportFactory>
          ) => {
            const factory = realHid.webHidTransportFactory(
              ...args,
            ) as ReturnType<typeof realHid.webHidTransportFactory> & {
              destroy(): void;
            };
            state.factories.push(factory);
            const destroy = factory.destroy.bind(factory);
            factory.destroy = () => {
              state.destroys++;
              state.events.push("destroy");
              destroy();
              if (options.destroyThrows)
                throw Error("Injected destroy failure after actual cleanup");
            };
            return factory;
          },
        };
      return require(name);
    },
  );
  function listeners() {
    return {
      connect: getEventListeners(hid, "connect").length,
      disconnect: getEventListeners(hid, "disconnect").length,
    };
  }
  function assertClean({ opened = false }: { opened?: boolean } = {}) {
    assert.deepEqual(listeners(), { connect: 0, disconnect: 0 });
    assert.equal(state.subscriptions, 0, "Discovery subscription leaked");
    assert.equal(device.opened, opened, "HID open state leaked");
    for (const dmk of state.dmks)
      assert.equal(dmk.listConnectedDevices().length, 0, "DMK session leaked");
  }
  return { options, device, hid, state, ledger, listeners, assertClean };
}

const mainBuild = await build({
  stdin: {
    contents:
      readFileSync(root + "apps/companion/src/main.ts", "utf8") +
      `\nexport function auditState(){return {busy,client,transport,notification,account,aborted:currentAbort?.signal.aborted};} export { connect as auditConnect };\n`,
    loader: "ts",
    resolveDir: root + "apps/companion/src",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
  plugins: [
    {
      name: "explicit-local-DOM-and-storage-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/ledger\.js$/ }, () => ({
          path: "connection-review-ledger",
          external: true,
        }));
        builder.onResolve({ filter: /^\.\/storage\.js$/ }, () => ({
          path: "storage",
          namespace: "review",
        }));
        builder.onLoad({ filter: /.*/, namespace: "review" }, () => ({
          contents:
            "export class WatchStorage{async journal(){return {schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1};} async load(){return undefined;} }",
          loader: "js",
        }));
      },
    },
  ],
});
export function mountMain(harness: ReturnType<typeof setup>) {
  const nodes = new Map<string, Record<string, any>>();
  const handlers = new Map<string, Function>();
  const dom = {
    _html: "",
    set innerHTML(value: string) {
      this._html = value;
      nodes.clear();
      for (const match of value.matchAll(/<[^>]+\sid="([^"]+)"[^>]*>/g)) {
        nodes.set(match[1]!, {
          disabled: /\sdisabled(?:\s|>)/.test(match[0]),
          addEventListener(type: string, fn: Function) {
            this[type] = fn;
          },
        });
      }
    },
    get innerHTML() {
      return this._html;
    },
  };
  Object.assign(globalThis, {
    document: {
      querySelector: () => dom,
      querySelectorAll: () => [],
      getElementById: (id: string) => nodes.get(id) ?? null,
    },
    window: {
      isSecureContext: true,
      addEventListener: (type: string, fn: Function) => handlers.set(type, fn),
    },
    BroadcastChannel: class {
      postMessage() {}
    },
    fetch: () => {
      throw Error("Network prohibited in connection cleanup review");
    },
  });
  const main = evaluate<{
    auditConnect: () => Promise<void>;
    auditState: () => {
      busy: boolean;
      client: unknown;
      transport: unknown;
      account: unknown;
      notification: string;
      aborted?: boolean;
    };
  }>(mainBuild.outputFiles[0]!.text, (name) =>
    name === "connection-review-ledger" ? harness.ledger : require(name),
  );
  return {
    main,
    dom,
    nodes,
    handlers,
    cancel() {
      const node = nodes.get("cancel-device");
      assert(node?.click);
      node.click();
    },
    unload() {
      const fn = handlers.get("beforeunload");
      assert(fn);
      fn({ preventDefault() {} });
    },
  };
}
