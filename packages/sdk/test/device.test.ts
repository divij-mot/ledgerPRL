import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as sdk from "../src/index.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = sdk.accountFromJson(fixture.publicAccount),
  bundle = () => sdk.bundleFromJson(fixture.bundle);
const ok = (data: Uint8Array = new Uint8Array()) =>
  sdk.concat(data, Uint8Array.of(0x90, 0));
class PublicFixtureDevice implements sdk.ApduTransport {
  commands: Uint8Array[] = [];
  closed = false;
  chunks: Uint8Array[] = [];
  active = false;
  offset = 0;
  next = 0;
  digest: Uint8Array = new Uint8Array();
  hook?: (
    apdu: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<Uint8Array | undefined>;
  async close() {
    this.closed = true;
    this.active = false;
    this.chunks = [];
  }
  async exchange(apdu: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    this.commands.push(apdu.slice());
    assert.equal(this.closed, false);
    if (this.hook) {
      const response = await this.hook(apdu, signal);
      if (response) return response;
    }
    assert.equal(apdu[0], 0xe0);
    assert.equal(apdu[2], 0);
    assert.equal(apdu[3], 0);
    assert.equal(apdu[4], apdu.length - 5);
    const data = apdu.slice(5),
      r = new sdk.Reader(data);
    switch (apdu[1]) {
      case sdk.INS.CAPABILITIES:
        return ok(Uint8Array.of(1, 0, 1, 0, 3, 16, 0xe3, 5));
      case sdk.INS.EXPORT_ACCOUNT:
        assert.equal(r.u32(), 0);
        return ok(
          sdk.concat(
            account.masterFingerprint,
            account.publicKey,
            account.chainCode,
            Uint8Array.of(3),
            sdk.u32(0),
          ),
        );
      case sdk.INS.VERIFY_ADDRESS:
        assert.equal(r.u32(), 0);
        return ok(
          new TextEncoder().encode(
            sdk.deriveAddress(account, r.byte() as 0 | 1, r.u32()).address,
          ),
        );
      case sdk.INS.BEGIN:
        assert.equal(this.active, false);
        assert.equal(r.u16(), sdk.fromHex(fixture.bundleHex).length);
        this.digest = r.take(32);
        this.active = true;
        this.offset = 0;
        this.next = 0;
        this.chunks = [];
        return ok();
      case sdk.INS.APPEND:
        assert.equal(this.active, true);
        assert.equal(r.u16(), this.offset);
        const chunk = r.take(r.remaining);
        this.offset += chunk.length;
        this.chunks.push(chunk);
        return ok();
      case sdk.INS.REVIEW:
        assert.equal(sdk.hex(sdk.concat(...this.chunks)), fixture.bundleHex);
        return ok(sdk.concat(Uint8Array.of(2), this.digest));
      case sdk.INS.SIGNATURE:
        assert.equal(r.byte(), this.next);
        const sig = sdk.fromHex(fixture.signatures[this.next++]);
        if (this.next === 2) this.active = false;
        return ok(sig);
      case sdk.INS.ABORT:
        this.active = false;
        this.chunks = [];
        return ok();
      default:
        throw new Error("Unexpected command");
    }
  }
}
test("account export and device-verified receive address", async () => {
  const device = new PublicFixtureDevice(),
    client = new sdk.LedgerPearlClient(device, "regtest");
  assert.deepEqual(await client.exportAccount(0), account);
  assert.equal(
    await client.verifyAddress(account, 0, 0),
    fixture.addresses.input,
  );
  assert.equal(client.sessionState, "ready");
});
test("chunks are contiguous, bounded, reviewed then independently verified", async () => {
  const device = new PublicFixtureDevice(),
    client = new sdk.LedgerPearlClient(device, "regtest");
  const phases: string[] = [];
  const tx = await client.signBundle(bundle(), account, {
    onProgress: (phase) => phases.push(phase),
  });
  assert.equal(tx.txid, fixture.txid);
  assert.equal(client.sessionState, "ready");
  assert.equal(device.active, false);
  assert.ok(device.commands.every((a) => a.length <= 260));
  assert.deepEqual(
    device.commands.map((a) => a[1]),
    [0, 0x10, 0x11, 0x11, 0x12, 0x13, 0x13],
  );
  assert.ok(phases.includes("review"));
});
test("sign request snapshots all caller-mutable values before first await", async () => {
  const device = new PublicFixtureDevice(),
    client = new sdk.LedgerPearlClient(device, "regtest"),
    b = bundle();
  const result = client.signBundle(b, account);
  b.outputs[0]!.amount--;
  b.inputs[0]!.scriptPubKey.fill(0);
  assert.equal((await result).txid, fixture.txid);
});
for (const status of [0x6700, 0x6985, 0x6986, 0x6a80, 0x6f00])
  test(`status ${status.toString(16)} is terminal; no automatic retry`, async () => {
    const d = new PublicFixtureDevice(),
      c = new sdk.LedgerPearlClient(d, "regtest");
    d.hook = async (a) =>
      a[1] === sdk.INS.REVIEW
        ? Uint8Array.of(status >> 8, status & 255)
        : undefined;
    await assert.rejects(c.signBundle(bundle(), account), sdk.DeviceError);
    assert.equal(c.sessionState, "failed");
    assert.equal(d.closed, true);
    const count = d.commands.length;
    await assert.rejects(c.capabilities());
    assert.equal(d.commands.length, count);
    assert.equal(d.commands.filter((a) => a[1] === sdk.INS.REVIEW).length, 1);
  });
for (const mode of [
  "network",
  "limits",
  "review-hash",
  "signature",
  "short-response",
  "transport-error",
])
  test(`fail closed on ${mode}`, async () => {
    const d = new PublicFixtureDevice(),
      c = new sdk.LedgerPearlClient(d, "regtest");
    d.hook = async (a) => {
      if (mode === "network" && a[1] === 0)
        return ok(Uint8Array.of(1, 0, 1, 0, 0, 16, 0xe3, 5));
      if (mode === "limits" && a[1] === 0)
        return ok(Uint8Array.of(1, 0, 1, 0, 3, 255, 0xe3, 5));
      if (mode === "review-hash" && a[1] === 0x12)
        return ok(sdk.concat(Uint8Array.of(2), new Uint8Array(32)));
      if (mode === "signature" && a[1] === 0x13) return ok(new Uint8Array(64));
      if (mode === "short-response") return Uint8Array.of(0x90);
      if (mode === "transport-error") throw new Error("Disconnected");
      return undefined;
    };
    await assert.rejects(c.signBundle(bundle(), account));
    assert.equal(c.sessionState, "failed");
    assert.equal(d.closed, true);
  });
test("cancel before transfer sends no APDUs and makes operation terminal", async () => {
  const d = new PublicFixtureDevice(),
    c = new sdk.LedgerPearlClient(d, "regtest"),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(
    c.signBundle(bundle(), account, { signal: abort.signal }),
  );
  assert.equal(d.commands.length, 0);
  assert.equal(c.sessionState, "failed");
});
test("cancel while waiting for approval never fetches a signature", async () => {
  const d = new PublicFixtureDevice(),
    c = new sdk.LedgerPearlClient(d, "regtest"),
    abort = new AbortController();
  d.hook = async (a) => {
    if (a[1] === sdk.INS.REVIEW) {
      abort.abort();
      return ok(
        sdk.concat(Uint8Array.of(2), sdk.fromHex(fixture.bundleSha256)),
      );
    }
    return undefined;
  };
  await assert.rejects(
    c.signBundle(bundle(), account, { signal: abort.signal }),
  );
  assert.equal(c.sessionState, "failed");
  assert.equal(
    d.commands.some((a) => a[1] === sdk.INS.SIGNATURE),
    false,
  );
});
test("concurrent operations cannot interleave", async () => {
  const d = new PublicFixtureDevice(),
    c = new sdk.LedgerPearlClient(d, "regtest");
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  d.hook = async (a) => {
    if (a[1] === sdk.INS.BEGIN) await gate;
    return undefined;
  };
  const signing = c.signBundle(bundle(), account);
  await assert.rejects(c.exportAccount(0), /busy/);
  release();
  assert.equal((await signing).txid, fixture.txid);
  assert.equal(
    d.commands.some((a) => a[1] === sdk.INS.EXPORT_ACCOUNT),
    false,
  );
});
test("failed client requires explicit transport recovery and reset", async () => {
  const d = new PublicFixtureDevice(),
    c = new sdk.LedgerPearlClient(d, "regtest");
  d.hook = async () => Uint8Array.of(0x69, 0x85);
  await assert.rejects(c.capabilities());
  d.closed = false;
  d.hook = undefined;
  await c.reset();
  assert.equal(c.sessionState, "ready");
  assert.equal((await c.signBundle(bundle(), account)).txid, fixture.txid);
});
test("wrong input origin never begins a transfer", async () => {
  const d = new PublicFixtureDevice(),
    c = new sdk.LedgerPearlClient(d, "regtest"),
    b = bundle();
  b.inputs[0]!.index = 1;
  assert.throws(() => c.signBundle(b, account));
  assert.equal(d.commands.length, 0);
});
test("Speculos loopback boundary rejects remote, credential and redirect URLs", () => {
  for (const url of [
    "https://127.0.0.1:5000",
    "http://example.com",
    "http://user:password@localhost:5000",
    "http://localhost:5000/path",
    "http://localhost:5000?x=1",
  ])
    assert.throws(() => new sdk.SpeculosTransport(url));
  for (const url of [
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://[::1]:5000",
  ])
    assert.doesNotThrow(() => new sdk.SpeculosTransport(url));
});
test("Speculos uses documented POST /apdu and verifies HTTP response", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://127.0.0.1:5000/apdu");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.body, JSON.stringify({ data: "e000000000" }));
    return new Response(JSON.stringify({ data: "9000" }));
  };
  const transport = new sdk.SpeculosTransport(undefined, 1000, fetcher);
  assert.equal(sdk.hex(await transport.exchange(sdk.command(0))), "9000");
  await transport.close();
  await assert.rejects(transport.exchange(sdk.command(0)));
});
