/** Bounded, exact binary primitives. Number is used only for <=32-bit fields. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function fromHex(value: string): Uint8Array {
  assert(
    typeof value === "string" &&
      value.length % 2 === 0 &&
      /^[a-fA-F0-9]*$/.test(value),
    "Invalid hex",
  );
  return Uint8Array.from(value.match(/../g) ?? [], (b) => parseInt(b, 16));
}
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
export function u32(value: number): Uint8Array {
  assert(
    Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
    "Invalid u32",
  );
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value, true);
  return b;
}
export function i32(value: number): Uint8Array {
  assert(
    Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
    "Invalid i32",
  );
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, value, true);
  return b;
}
export function u16(value: number): Uint8Array {
  assert(
    Number.isInteger(value) && value >= 0 && value <= 65535,
    "Invalid u16",
  );
  return Uint8Array.of(value & 255, value >>> 8);
}
export function u64(value: bigint): Uint8Array {
  assert(
    typeof value === "bigint" && value >= 0n && value <= 0xffffffffffffffffn,
    "Invalid u64",
  );
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, value, true);
  return b;
}
export function compactSize(value: number): Uint8Array {
  assert(
    Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff,
    "Invalid CompactSize",
  );
  return value < 253
    ? Uint8Array.of(value)
    : value <= 65535
      ? concat(Uint8Array.of(253), u16(value))
      : concat(Uint8Array.of(254), u32(value));
}
export class Reader {
  private at = 0;
  constructor(readonly bytes: Uint8Array) {}
  get remaining() {
    return this.bytes.length - this.at;
  }
  get offset() {
    return this.at;
  }
  take(n: number): Uint8Array {
    assert(
      Number.isInteger(n) && n >= 0 && n <= this.remaining,
      "Truncated data",
    );
    const out = Uint8Array.from(this.bytes.subarray(this.at, this.at + n));
    this.at += n;
    return out;
  }
  byte() {
    return this.take(1)[0]!;
  }
  u16() {
    return new DataView(this.take(2).buffer).getUint16(0, true);
  }
  u32() {
    return new DataView(this.take(4).buffer).getUint32(0, true);
  }
  i32() {
    return new DataView(this.take(4).buffer).getInt32(0, true);
  }
  u64() {
    return new DataView(this.take(8).buffer).getBigUint64(0, true);
  }
  compactSize(limit = 4_000_000): number {
    const first = this.byte();
    let n: bigint;
    if (first < 253) n = BigInt(first);
    else if (first === 253) {
      n = BigInt(this.u16());
      assert(n >= 253n, "Noncanonical CompactSize");
    } else if (first === 254) {
      n = BigInt(this.u32());
      assert(n > 65535n, "Noncanonical CompactSize");
    } else {
      n = this.u64();
      assert(n > 0xffffffffn, "Noncanonical CompactSize");
    }
    assert(n <= BigInt(limit), "CompactSize exceeds limit");
    return Number(n);
  }
  end() {
    assert(this.remaining === 0, "Trailing bytes");
  }
}

export function exactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `Invalid ${label}`,
  );
  const actual = Object.keys(value);
  assert(
    actual.length === keys.length && actual.every((key) => keys.includes(key)),
    `Unexpected or missing ${label} fields`,
  );
}
