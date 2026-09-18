import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ringbuffer.js";

describe("RingBuffer (PLAN §13, FMK-2)", () => {
  it("holds up to the capacity", () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 3; i++) buf.push(i);
    expect(buf.size).toBe(3);
    expect(buf.lines()).toEqual([1, 2, 3]);
  });

  it("evicts the oldest line once full (FIFO wrap)", () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) buf.push(i); // 1..5
    expect(buf.size).toBe(3);
    expect(buf.lines()).toEqual([3, 4, 5]);
  });

  it("lines(limit) returns only the newest N", () => {
    const buf = new RingBuffer<number>(1000);
    for (let i = 1; i <= 10; i++) buf.push(i);
    expect(buf.lines(3)).toEqual([8, 9, 10]);
    expect(buf.lines(300)).toHaveLength(10); // capped at what exists
  });

  it("starts empty and stays empty until pushed", () => {
    const buf = new RingBuffer<string>(10);
    expect(buf.size).toBe(0);
    expect(buf.lines()).toEqual([]);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});
