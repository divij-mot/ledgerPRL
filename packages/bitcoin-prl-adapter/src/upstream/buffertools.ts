// Derived from LedgerHQ/app-bitcoin 44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a.
// Apache-2.0; local changes recorded in provenance/upstream.patch.
import { Buffer } from 'buffer';
import { createVarint, parseVarint, sanitizeBigintToNumber } from './varint.js';

/** PRL adaptation: exact integers only; no amount can pass through Number. */
export function uint64LE(n: bigint): Buffer {
  if (typeof n !== 'bigint' || n < 0n || n > 0xffffffffffffffffn) {
    throw new RangeError('Invalid uint64 bigint');
  }
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(n);
  return result;
}
export function from64bitLE(bytes: Buffer): bigint {
  if (bytes.length !== 8) throw new Error('Expected uint64 bytes');
  return bytes.readBigUInt64LE();
}

export class BufferWriter {
  private bufs: Buffer[] = [];

  write(alloc: number, fn: (b: Buffer) => void): void {
    const b = Buffer.alloc(alloc);
    fn(b);
    this.bufs.push(b);
  }

  writeUInt8(i: number): void {
    this.write(1, (b) => b.writeUInt8(i, 0));
  }

  writeInt32(i: number): void {
    this.write(4, (b) => b.writeInt32LE(i, 0));
  }

  writeUInt32(i: number): void {
    this.write(4, (b) => b.writeUInt32LE(i, 0));
  }

  writeUInt64(i: bigint): void {
    const bytes = uint64LE(i);
    this.writeSlice(bytes);
  }

  writeVarInt(i: number): void {
    this.bufs.push(createVarint(i));
  }

  writeSlice(slice: Buffer): void {
    this.bufs.push(Buffer.from(slice));
  }

  writeVarSlice(slice: Buffer): void {
    this.writeVarInt(slice.length);
    this.writeSlice(slice);
  }

  buffer(): Buffer {
    return Buffer.concat(this.bufs);
  }
}

export class BufferReader {
  constructor(public readonly buffer: Buffer, public offset: number = 0) {}

  available(): number {
    return this.buffer.length - this.offset;
  }

  readUInt8(): number {
    const result = this.buffer.readUInt8(this.offset);
    this.offset++;
    return result;
  }

  readInt32(): number {
    const result = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return result;
  }

  readUInt32(): number {
    const result = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return result;
  }

  readUInt64(): bigint {
    const buf = this.readSlice(8);
    return from64bitLE(buf);
  }

  readVarInt(): bigint {
    const [vi, vi_size] = parseVarint(this.buffer, this.offset);
    this.offset += vi_size;
    return vi;
  }

  readSlice(n: number): Buffer {
    if (!Number.isSafeInteger(n) || n < 0 || this.buffer.length < this.offset + n) {
      throw new Error('Cannot read slice out of bounds');
    }
    const result = this.buffer.slice(this.offset, this.offset + n);
    this.offset += n;
    return result;
  }

  readVarSlice(): Buffer {
    const n = sanitizeBigintToNumber(this.readVarInt());
    return this.readSlice(n);
  }

  readVector(): readonly Buffer[] {
    const count = this.readVarInt();
    const vector: Buffer[] = [];
    for (let i = 0; i < count; i++) vector.push(this.readVarSlice());
    return vector;
  }
}
