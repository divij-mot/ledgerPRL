import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedText, readBoundedJson } from "../src/http.js";

function source(total: number, headers: Record<string, string> = {}) {
  let emitted = 0,
    cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted === total) {
        controller.close();
        return;
      }
      const size = Math.min(total - emitted, 16 * 1024);
      emitted += size;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, { headers }),
    state: () => ({ emitted, cancelled }),
  };
}
for (const [label, headers] of [
  ["missing length", {}],
  ["false small length", { "content-length": "1" }],
  [
    "decoded compressed body",
    { "content-length": "100", "content-encoding": "gzip" },
  ],
] as const) {
  test(`bounded reader cancels oversized ${label}`, async () => {
    const body = source(8 * 1024 * 1024, headers);
    await assert.rejects(
      readBoundedText(body.response, 64 * 1024),
      /byte limit/,
    );
    assert.equal(body.state().cancelled, true);
    assert.ok(body.state().emitted < 8 * 1024 * 1024);
    assert.ok(body.state().emitted <= 96 * 1024);
  });
}
test("honest oversized declared length is cancelled before reading", async () => {
  const body = source(100, { "content-length": "100" });
  await assert.rejects(readBoundedText(body.response, 10), /byte limit/);
  assert.equal(body.state().cancelled, true);
});
test("exact-bound valid JSON succeeds and invalid UTF8 fails", async () => {
  assert.deepEqual(await readBoundedJson(new Response('{"a":1}'), 7), { a: 1 });
  await assert.rejects(readBoundedText(new Response(Uint8Array.of(255)), 10));
});
for (const length of ["-1", "1.5", "1e3", "999999999999999999999"]) {
  test(`invalid or unrepresentable length ${length} is rejected`, async () => {
    await assert.rejects(
      readBoundedText(
        new Response("x", { headers: { "content-length": length } }),
        10,
      ),
    );
  });
}
