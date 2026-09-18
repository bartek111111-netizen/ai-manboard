/**
 * Disk log writer (PLAN §13, FMK-3) — Faza 4.
 *
 * `logs/<instanceId>/<timestamp>.log` per start. Retention keeps the newest
 * `retentionFiles` files and deletes older ones. Files are truncated (with a
 * marker) once they exceed `maxFileBytes` (~10 MB) so a runaway backend can
 * never fill the disk.
 */
import { mkdirSync, openSync, writeSync, closeSync, readdirSync, unlinkSync, statSync, readFileSync, existsSync } from 'node:fs';
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

  /**
   * Directory `logs/<modelId>/` — one folder per model, shared across all of
   * its presets. The `instanceId` is `<modelId>--<presetName>`, so the model
   * id is everything before the first `--`. (The old layout nested by full
   * `instanceId`, which produced unreadable dirs; the user asked to group logs
   * by model and name files so the preset + start time are visible.)
   */
  instanceDir(instanceId: string): string {
    const modelId = instanceId.split('--')[0] || instanceId;
    return join(this.logsDir, modelId);
  }

  /** A sortable, human-readable start stamp: `YYYY-MM-DD_HH-mm-ss`. */
  private stampName(ts: string): string {
    const d = new Date(Number(ts) || Date.now());
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  /**
   * Opens a new per-start log file `logs/<modelId>/<preset>-<start>.log` and
   * applies retention. Returns the absolute path (the manager keeps it for
   * `append`).
   */
  start(instanceId: string, ts: string): string {
    const dir = this.instanceDir(instanceId);
    mkdirSync(dir, { recursive: true });
    const presetName = instanceId.split('--')[1] ?? 'default';
    const base = `${presetName}-${this.stampName(ts)}`;
    // Collision-safe: two runs in the same second would share the readable
    // stamp, so append a counter until the path is fresh.
    let file = join(dir, `${base}.log`);
    let n = 0;
    while (existsSync(file)) {
      n += 1;
      file = join(dir, `${base}-${n}.log`);
    }
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
      this.truncate(file);
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

  /** The sortable start stamp from a log file name, or the raw name as fallback. */
  private sortKey(file: string): string {
    const m = file.match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
    return m ? m[1] : file;
  }

  /** All `logs/<modelId>/*.log` names, sorted oldest→newest (null when the dir is missing). */
  private listLogFiles(instanceId: string): string[] | null {
    let files: string[];
    try {
      files = readdirSync(this.instanceDir(instanceId)).filter((f) => f.endsWith('.log'));
    } catch {
      return null; // dir not created yet
    }
    files.sort((a, b) => this.sortKey(a).localeCompare(this.sortKey(b), undefined, { numeric: true }));
    return files;
  }

  /** The newest `logs/<modelId>/*.log` file path, or null when none. */
  latestFile(instanceId: string): string | null {
    const files = this.listLogFiles(instanceId);
    if (!files || files.length === 0) return null;
    return join(this.instanceDir(instanceId), files[files.length - 1]);
  }

  /**
   * The last `lines` lines of the newest log file for `instanceId` (for the
   * startup-error diagnostic, §5.3). Returns `[]` when there is no log file.
   */
  readTail(instanceId: string, lines: number): string[] {
    const file = this.latestFile(instanceId);
    if (!file) return [];
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const all = content.split('\n').filter((l) => l.length > 0);
    return all.slice(-Math.max(1, Math.floor(lines)));
  }

  /**
   * The most recent `prompt processing` line from the newest log (the last
   * completed request's prefill stats). Returns `{ tokens, seconds, tps }` or
   * null when no timing line is present. Used for the TTFT / prefill-speed
   * metrics. Reads only the tail of the log (the timing line is the newest).
   */
  readLastPromptProcessing(instanceId: string, tailLines = 500): { tokens: number; seconds: number; tps: number } | null {
    const lines = this.readTail(instanceId, tailLines);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('prompt processing')) continue;
      const t = line.match(/t = ([\d.]+) s \/ ([\d.]+) tokens per second/);
      if (!t) continue;
      const seconds = Number(t[1]);
      const tps = Number(t[2]);
      const tokens = Number(line.match(/n_tokens = ([\d.]+)/)?.[1] ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) {
        return { tokens: Number.isFinite(tokens) ? tokens : 0, seconds, tps: Number.isFinite(tps) ? tps : 0 };
      }
    }
    return null;
  }

  /** Keeps the newest `retentionFiles` files in `logs/<modelId>/`. */
  prune(instanceId: string): void {
    const files = this.listLogFiles(instanceId);
    if (!files) return; // dir not created yet
    const dir = this.instanceDir(instanceId);
    const excess = files.length - this.retentionFiles;
    for (let i = 0; i < excess; i++) {
      try {
        unlinkSync(join(dir, files[i]));
      } catch {
        /* best-effort */
      }
    }
  }

  /** Truncates `file` to a marker so it cannot grow past the cap. */
  private truncate(file: string): void {
    try {
      const handle = openSync(file, 'r+');
      try {
        writeSync(handle, TRUNCATE_MARKER, 0, 'utf8');
      } finally {
        closeSync(handle);
      }
      this.byteCounts.set(file, Buffer.byteLength(TRUNCATE_MARKER, 'utf8'));
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
