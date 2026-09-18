import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGgufMetadata } from "./gguf.js";

/** A 4-byte little-endian u32 buffer. */
function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}

/** An 8-byte little-endian u64 buffer. */
function u64(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

/** A GGUF string: u64 length + raw UTF-8 bytes. */
function str(text: string): Buffer {
  return Buffer.concat([u64(BigInt(text.length)), Buffer.from(text)]);
}

/** One metadata KV: key (string) · value_type (u32) · value. */
function kv(key: string, valueType: number, valueBuf: Buffer): Buffer {
  return Buffer.concat([str(key), u32(valueType), valueBuf]);
}

/** A STRING value (type 8): u64 length + bytes. */
function strValue(text: string): Buffer {
  return str(text);
}

/** Builds a minimal real-spec GGUF binary: header + metadata KVs (metadata precedes tensors). */
function buildGgufBuffer(): Buffer {
  const magic = Buffer.from([0x47, 0x47, 0x55, 0x46]); // "GGUF"
  const version = u32(3);
  const tensorCount = u64(0n);
  const metadataCount = u64(3n);

  // KV1: general.architecture = "llama"  (type 8 = STRING)
  const kv1 = kv("general.architecture", 8, strValue("llama"));
  // KV2: llama.context_length = 4096      (type 10 = UINT64)
  const kv2 = kv("llama.context_length", 10, u64(4096n));
  // KV3: llama.attention.head_count = 32  (type 10 = UINT64)
  const kv3 = kv("llama.attention.head_count", 10, u64(32n));

  return Buffer.concat([
    magic,
    version,
    tensorCount,
    metadataCount,
    kv1,
    kv2,
    kv3,
  ]);
}

describe("readGgufMetadata (FM-5, header + metadata only)", () => {
  it("reads version, architecture, context_length and head_count from a GGUF header", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-gguf-"));
    const file = join(dir, "model.gguf");
    writeFileSync(file, buildGgufBuffer());
    try {
      const meta = readGgufMetadata(file);
      expect(meta).not.toBeNull();
      expect(meta?.version).toBe(3);
      expect(meta?.architecture).toBe("llama");
      expect(meta?.contextLength).toBe(4096);
      expect(meta?.headCount).toBe(32);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads ARRAY values (type 9: elem_type + count + items)", () => {
    const magic = Buffer.from([0x47, 0x47, 0x55, 0x46]);
    const version = u32(3);
    const tensorCount = u64(0n);
    // KV1: general.architecture = "llama" (type 8 = STRING)
    const kv1 = kv("general.architecture", 8, strValue("llama"));
    // KV2: llama.context_length = [4096] (type 9 = ARRAY of type 10 = UINT64)
    const arrValue = Buffer.concat([u32(10), u64(1n), u64(4096n)]);
    const kv2 = kv("llama.context_length", 9, arrValue);
    const buffer = Buffer.concat([
      magic,
      version,
      tensorCount,
      u64(2n),
      kv1,
      kv2,
    ]);

    const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-gguf-arr-"));
    const file = join(dir, "model-arr.gguf");
    writeFileSync(file, buffer);
    try {
      const meta = readGgufMetadata(file);
      expect(meta?.contextLength).toBe(4096);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still reads metadata when tensors are present (metadata precedes the tensor table)", () => {
    const magic = Buffer.from([0x47, 0x47, 0x55, 0x46]);
    const version = u32(3);
    // tensorCount = 2, but the reader stops after the metadata (which comes first).
    const tensorCount = u64(2n);
    const metadataCount = u64(1n);
    const kv1 = kv("general.architecture", 8, strValue("qwen3"));
    const buffer = Buffer.concat([
      magic,
      version,
      tensorCount,
      metadataCount,
      kv1,
    ]);

    const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-gguf-tens-"));
    const file = join(dir, "model-tens.gguf");
    writeFileSync(file, buffer);
    try {
      const meta = readGgufMetadata(file);
      expect(meta?.tensorCount).toBe(2);
      expect(meta?.architecture).toBe("qwen3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for non-GGUF files (magic check)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-dashboard-gguf2-"));
    const file = join(dir, "not-gguf.bin");
    writeFileSync(file, Buffer.from("this is not a gguf file at all, padding"));
    try {
      expect(readGgufMetadata(file)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a path that does not exist", () => {
    expect(readGgufMetadata("/nonexistent/path.gguf")).toBeNull();
  });
});
