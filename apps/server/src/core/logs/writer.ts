/**
 * Disk log writer (PLAN §13, FMK-3) — Faza 4.
 *
 * `logs/<instanceId>/<timestamp>.log` per start. Retention keeps the newest
 * `retentionFiles` files and deletes older ones. Files are truncated (with a
 * marker) once they exceed `maxFileBytes` (~10 MB) so a runaway backend can
 * never fill the disk.
 */
import { mkdirSync, openSync, writeSync, closeSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Marker line inserted when a log file is truncated at the size cap. */
const TRUNCATE_MARKER = '\n[log truncated: max file size reached]\n';

export interface LogWriterOptions {
  /** `logs/` root (home.logsDir). */
  logsDir: string;
  /** Keep the newest N files per instance (default 10). */
  retentionFiles: number;
  /** Per-file cap in bytes (default ~10 MB). */
  maxFileBytes: number;
}

export class LogWriter {
  private readonly logsDir: string;
  private readonly retentionFiles: number;
  private readonly maxFileBytes: number;
  private readonly byteCounts = new Map<string, number>();

  constructor(options: LogWriterOptions) {
    this.logsDir = options.logsDir;
    this.retentionFiles = options.retentionFiles;
    this.maxFileBytes = options.maxFileBytes;
  }

  /** Directory `logs/<instanceId>/`. */
  instanceDir(instanceId: string): string {
    return join(this.logsDir, instanceId);
  }

  /**
   * Opens a new per-start log file `logs/<instanceId>/<ts>.log` and applies
   * retention. Returns the absolute path (the manager keeps it for `append`).
   */
  start(instanceId: string, ts: string): string {
    const dir = this.instanceDir(instanceId);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${ts}.log`);
    // Seed the file so an empty-but-started run still has a log on disk.
    const handle = openSync(file, 'a');
    try {
      closeSync(handle);
    } catch {
      /* already closed */
    }
    this.byteCounts.set(file, this.currentSize(file));
    this.prune(instanceId);
    return file;
  }

  /** Appends a line, enforcing the per-file cap (truncate + marker). */
  append(file: string, line: string): void {
    let size = this.byteCounts.get(file) ?? this.currentSize(file);
    const data = `${line}\n`;
    if (size + data.length > this.maxFileBytes) {
      this.truncate(file, size);
      size = this.byteCounts.get(file) ?? 0;
    }
    const handle = openSync(file, 'a');
    try {
      writeSync(handle, data);
    } finally {
      closeSync(handle);
    }
    this.byteCounts.set(file, size + data.length);
  }

  /** Keeps the newest `retentionFiles` files in `logs/<instanceId>/`. */
  prune(instanceId: string): void {
    const dir = this.instanceDir(instanceId);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.log'));
    } catch {
      return; // dir not created yet
    }
    // Timestamps are zero-padded ISO-ish, so lexicographic order = time order.
    files.sort();
    const excess = files.length - this.retentionFiles;
    for (let i = 0; i < excess; i++) {
      const file = join(dir, files[i]);
      try {
        unlinkSync(file);
      } catch {
        /* best-effort */
      }
    }
  }

  /** Truncates `file` to a marker so it cannot grow past the cap. */
  private truncate(file: string, size: number): void {
    try {
      const handle = openSync(file, 'r+');
      try {
        writeSync(handle, TRUNCATE_MARKER, 0, 'utf8');
      } finally {
        closeSync(handle);
      }
      this.byteCounts.set(file, Buffer.byteLength(TRUNCATE_MARKER, 'utf8'));
      void size;
    } catch {
      /* best-effort */
    }
  }

  private currentSize(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }
}
