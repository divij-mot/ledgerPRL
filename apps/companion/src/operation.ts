import type { IncomingMessage, ServerResponse } from "node:http";
import { addAbortSignal } from "node:stream";
import { assert } from "@pearl-ledger/sdk";

/** Bound both incoming bytes and time spent waiting for the unfinished body. */
export async function readJsonBody(
  request: IncomingMessage,
  signal: AbortSignal,
): Promise<unknown> {
  assert(
    request.headers["content-type"] === "application/json",
    "JSON required",
  );
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of addAbortSignal(signal, request)) {
    const chunk = Buffer.from(value);
    total += chunk.length;
    assert(total <= 4 * 1024 * 1024, "Request too large");
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Total deadline plus client disconnect cancellation; no abandoned request can monopolize the bridge. */
export function requestOperation(
  request: IncomingMessage,
  response: ServerResponse,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      new Error("Request cancelled or operation deadline exceeded"),
    );
  const closed = () => {
    if (!response.writableEnded) abort();
  };
  request.once("aborted", abort);
  response.once("close", closed);
  const timer = setTimeout(abort, timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      request.off("aborted", abort);
      response.off("close", closed);
      // Promise.all can reject while sibling fetches are still pending. End
      // their shared scope before the caller releases its request slot.
      controller.abort(new Error("Request operation completed"));
    },
  };
}
export async function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    throw signal.reason;
  }
  let listener: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        listener = () =>
          reject(signal.reason ?? new Error("Operation cancelled"));
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
