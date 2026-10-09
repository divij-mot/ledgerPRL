import { assert } from "./bytes.js";
export const GRAINS_PER_PRL = 100_000_000n;
export const MAX_GRAINS = 2_100_000_000_000_000_000n;
export function checkedGrains(value: bigint, allowZero = true): bigint {
  assert(
    typeof value === "bigint" &&
      value >= (allowZero ? 0n : 1n) &&
      value <= MAX_GRAINS,
    "Amount outside Pearl range",
  );
  return value;
}
/** Atomic amounts are decimal strings, never JSON numbers or floating point. */
export function parseGrains(value: string): bigint {
  assert(
    typeof value === "string" &&
      value.length <= 19 &&
      /^(0|[1-9][0-9]*)$/.test(value),
    "Expected canonical integer grain string",
  );
  return checkedGrains(BigInt(value));
}
export function parsePrl(value: string): bigint {
  assert(
    typeof value === "string" &&
      value.length <= 20 &&
      /^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(value),
    "Expected decimal PRL string with at most 8 decimals",
  );
  const [whole, fraction = ""] = value.split(".");
  return checkedGrains(
    BigInt(whole!) * GRAINS_PER_PRL + BigInt(fraction.padEnd(8, "0")),
  );
}
export function formatPrl(value: bigint): string {
  checkedGrains(value);
  return `${value / GRAINS_PER_PRL}.${(value % GRAINS_PER_PRL).toString().padStart(8, "0")}`;
}
export function sumGrains(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const v of values) {
    checkedGrains(v);
    total = checkedGrains(total + v);
  }
  return total;
}
