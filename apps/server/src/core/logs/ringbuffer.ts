/**
 * In-memory ring buffer (PLAN §13, FMK-2) — Faza 4.
 *
 * One buffer per instance holds the last `ringLines` log lines (default 1000),
 * used for the live log view (`/instances/:id/logs?limit=` + the SSE stream).
 * A fixed-size circular buffer: O(1) push, no growth after the first cycle.
 */
export type LogLevel = "info" | "warn" | "error";
export type LogSource = "stdout" | "stderr" | "internal";

/** One classified log line. */
export interface LogLine {
  /** ISO timestamp of when the line was produced. */
  ts: string;
  level: LogLevel;
  source: LogSource;
  line: string;
}

export class RingBuffer<T> {
  private readonly buf: T[];
  private head = 0; // next write slot
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("RingBuffer capacity must be a positive integer");
    }
    this.buf = new Array<T>(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** The last `limit` items (most recent last); the whole buffer when omitted. */
  lines(limit?: number): T[] {
    if (this.count === 0) return [];
    const n = Math.min(limit ?? this.count, this.count);
    const result: T[] = [];
    if (this.count < this.capacity) {
      // Not full: items occupy [0, count) in order; take the last n.
      for (let i = this.count - n; i < this.count; i++)
        result.push(this.buf[i]);
    } else {
      // Full: `head` is the oldest slot; the n most recent end at the newest.
      for (let i = 0; i < n; i++) {
        result.push(
          this.buf[(this.head - n + i + this.capacity) % this.capacity],
        );
      }
    }
    return result;
  }

  /** Number of items currently held (≤ capacity). */
  get size(): number {
    return this.count;
  }
}
