/** Read a fetch body with a real allocation bound, including chunked/compressed replies. */
import { assert } from "./bytes.js";

export async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  assert(
    Number.isSafeInteger(maxBytes) && maxBytes > 0,
    "Invalid response bound",
  );
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (
      !/^(0|[1-9][0-9]*)$/.test(declared) ||
      !Number.isSafeInteger(size) ||
      size > maxBytes
    ) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Response exceeds byte limit");
    }
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Response exceeds byte limit");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, maxBytes)) as unknown;
}
