/**
 * Minimal GGUF metadata reader (PLAN §8.2, FM-5). Reads only the header and
 * the metadata KV pairs, which in a GGUF file come **immediately after the
 * header, before the tensor table** — so the huge tensor payloads are never
 * touched. Little-endian throughout (the spec default).
 *
 * Layout (gguf v3, little-endian):
 *   magic (4) · version (u32) · tensor_count (u64) · metadata_kv_count (u64)
 *   metadata KVs [key: u64 len + bytes · value_type u32 · value]
 *   tensor infos [name: u64 len + bytes · n_dims u32 · dims n_dims×u64 · type u32 · offset u64]
 *   tensor data (never read here)
 *
 * Metadata value types (gguf_metadata_value_type):
 *   0 UINT8 · 1 INT8 · 2 UINT16 · 3 INT16 · 4 UINT32 · 5 INT32 · 6 FLOAT32
 *   7 BOOL · 8 STRING (u64 len + bytes) · 9 ARRAY (u32 elem_type + u64 len + items)
 *   10 UINT64 · 11 INT64 · 12 FLOAT64
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';

/** `GGUF` magic bytes: the ASCII string "GGUF" (0x47 0x47 0x55 0x46). */
const GGUF_MAGIC = Buffer.from([0x47, 0x47, 0x55, 0x46]);
/**
 * How much of the file head to load for parsing. The metadata section sits in
 * the first megabytes (even large embedded vocab token arrays fit well below
 * this), so we never read more than this from a multi-GB model file.
 */
const HEADER_MAX_BYTES = 8 * 1024 * 1024;

export interface GgufMetadata {
  /** GGUF format version. */
  version: number;
  /** Number of tensors in the header. */
  tensorCount: number;
  /** Number of metadata KV pairs. */
  metadataCount: number;
  /** `general.architecture` (e.g. `llama`, `qwen3`, `gemma`). */
  architecture?: string;
  /** `<arch>.context_length` (arch-specific; `llama.context_length` for llama-family). */
  contextLength?: number;
  /** `<arch>.block_size` (rare; llama-family uses `embedding_length`). */
  blockSize?: number;
  /** `<arch>.attention.head_count`. */
  headCount?: number;
}

/** Cursor over a buffer: reads at a moving offset. */
class Cursor {
  constructor(
    readonly buf: Buffer,
    private off = 0,
  ) {}

  get offset(): number {
    return this.off;
  }

  has(len: number): boolean {
    return this.off + len <= this.buf.length;
  }

  u32(): number {
    const v = this.buf.readUInt32LE(this.off);
    this.off += 4;
    return v;
  }

  u64(): number {
    const v = Number(this.buf.readBigUInt64LE(this.off));
    this.off += 8;
    return v;
  }

  bytes(len: number): Buffer {
    const b = this.buf.subarray(this.off, this.off + len);
    this.off += len;
    return b;
  }

  /** Reads a GGUF string: u64 length + UTF-8 bytes. */
  str(): string {
    const len = this.u64();
    if (!this.has(len)) throw new Error('GGUF string overruns buffer');
    const s = this.buf.toString('utf-8', this.off, this.off + len);
    this.off += len;
    return s;
  }
}

/** Reads one metadata value of `type`, advancing the cursor. */
function readValue(c: Cursor, type: number): unknown {
  switch (type) {
    case 0: // UINT8
      return c.bytes(1).readUInt8(0);
    case 1: // INT8
      return c.bytes(1).readInt8(0);
    case 2: // UINT16
      return c.bytes(2).readUInt16LE(0);
    case 3: // INT16
      return c.bytes(2).readInt16LE(0);
    case 4: // UINT32
      return c.u32();
    case 5: // INT32
      return c.bytes(4).readInt32LE(0);
    case 6: // FLOAT32
      return c.bytes(4).readFloatLE(0);
    case 7: // BOOL
      return c.bytes(1).readUInt8(0) !== 0;
    case 8: // STRING
      return c.str();
    case 9: {
      // ARRAY: element type (u32) + element count (u64) + items.
      const elemType = c.u32();
      const n = c.u64();
      const arr: unknown[] = [];
      for (let i = 0; i < n; i++) {
        if (!c.has(8)) break;
        arr.push(readValue(c, elemType));
      }
      return arr;
    }
    case 10: // UINT64
      return c.u64();
    case 11: // INT64
      return Number(c.bytes(8).readBigInt64LE(0));
    case 12: // FLOAT64
      return c.bytes(8).readDoubleLE(0);
  }
  // Unknown type: cannot determine size — throw so the caller can stop.
  throw new Error(`Unknown GGUF metadata value type: ${type}`);
}

/** Reads the GGUF header + metadata; null when the file is not a readable GGUF. */
export function readGgufMetadata(filePath: string): GgufMetadata | null {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return null;
  }
  const toRead = Math.min(stat.size, HEADER_MAX_BYTES);
  if (toRead < 24) return null; // too small to be a GGUF header
  const fh = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(toRead);
    let fileOff = 0;
    let bytes = 0;
    while (bytes < toRead) {
      const n = readSync(fh, buf, bytes, toRead - bytes, fileOff);
      if (n <= 0) break;
      bytes += n;
      fileOff += n;
    }
    const data = buf.subarray(0, bytes);
    if (data.length < 24) return null;
    if (!data.subarray(0, 4).equals(GGUF_MAGIC)) return null; // not a GGUF

    const c = new Cursor(data, 4); // skip magic
    const version = c.u32();
    const tensorCount = c.u64();
    const metadataCount = c.u64();

    // Metadata KVs come right after the header (before the tensor table).
    const meta: Record<string, unknown> = {};
    let arch: string | undefined;
    for (let i = 0; i < metadataCount; i++) {
      if (!c.has(8)) break;
      try {
        const key = c.str();
        const type = c.u32();
        const value = readValue(c, type);
        meta[key] = value;
        if (key === 'general.architecture' && typeof value === 'string') arch = value;
      } catch {
        break; // ran past the buffer or hit an unparseable value — stop
      }
    }

    return {
      version,
      tensorCount,
      metadataCount,
      architecture: arch,
      contextLength: arch ? asNumber(meta[`${arch}.context_length`]) : asNumber(meta['llama.context_length']),
      blockSize: arch ? asNumber(meta[`${arch}.block_size`]) : undefined,
      headCount: arch ? asNumber(meta[`${arch}.attention.head_count`]) : undefined,
    };
  } finally {
    closeSync(fh);
  }
}

/** Normalizes a metadata value (possibly a 1-element array) to a number. */
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'number') return v[0];
  return undefined;
}
