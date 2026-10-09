import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { abortable, readJsonBody, requestOperation } from "../src/operation.js";

function scope() {
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), { writableEnded: false });
  const operation = requestOperation(
    request as IncomingMessage,
    response as ServerResponse,
    60_000,
  );
  return { request, response, operation };
}

test("disposing a request cancels pending siblings and removes lifecycle listeners", async () => {
  const { request, response, operation } = scope();
  const siblings = Array.from({ length: 4 }, () =>
    abortable(new Promise<never>(() => {}), operation.signal),
  );
  operation.dispose();
  assert.equal(operation.signal.aborted, true);
  assert.equal(request.listenerCount("aborted"), 0);
  assert.equal(response.listenerCount("close"), 0);
  const results = await Promise.allSettled(siblings);
  assert.ok(results.every((result) => result.status === "rejected"));
  const reason = operation.signal.reason;
  operation.dispose();
  assert.equal(operation.signal.reason, reason);
});

test("disposing a completed request preserves its result", async () => {
  const { response, operation } = scope();
  const result = await abortable(Promise.resolve("complete"), operation.signal);
  response.writableEnded = true;
  response.emit("close");
  assert.equal(operation.signal.aborted, false);
  operation.dispose();
  assert.equal(result, "complete");
  assert.equal(operation.signal.aborted, true);
});

test("disposal preserves an earlier disconnect reason", () => {
  const { request, operation } = scope();
  request.emit("aborted");
  const reason = operation.signal.reason;
  assert.equal(operation.signal.aborted, true);
  operation.dispose();
  assert.equal(operation.signal.reason, reason);
});

function bodyStream() {
  return Object.assign(new PassThrough(), {
    headers: { "content-type": "application/json" },
  });
}

test("unfinished request bodies terminate when their operation is cancelled", async () => {
  const stream = bodyStream();
  const controller = new AbortController();
  const result = readJsonBody(
    stream as unknown as IncomingMessage,
    controller.signal,
  );
  const rejected = assert.rejects(result, { name: "AbortError" });
  stream.write('{"unfinished":');
  controller.abort();
  await rejected;
  assert.equal(stream.destroyed, true);
});

test("bounded JSON body succeeds and completed input survives later disposal", async () => {
  const stream = bodyStream();
  const controller = new AbortController();
  const result = readJsonBody(
    stream as unknown as IncomingMessage,
    controller.signal,
  );
  stream.write('{"value":');
  stream.end('"complete"}');
  assert.deepEqual(await result, { value: "complete" });
  controller.abort();
  assert.equal(stream.errored, null);
});

test("body readers reject oversize, malformed and pre-cancelled input", async () => {
  for (const [value, pattern] of [
    [" ".repeat(4 * 1024 * 1024 + 1), /Request too large/],
    ["{", /JSON/],
  ] as const) {
    const stream = bodyStream();
    const result = readJsonBody(
      stream as unknown as IncomingMessage,
      new AbortController().signal,
    );
    const rejected = assert.rejects(result, pattern);
    stream.end(value);
    await rejected;
  }
  const stream = bodyStream();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readJsonBody(stream as unknown as IncomingMessage, controller.signal),
    { name: "AbortError" },
  );
  assert.equal(stream.destroyed, true);
});
