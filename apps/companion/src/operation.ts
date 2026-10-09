import type { IncomingMessage, ServerResponse } from "node:http";
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
