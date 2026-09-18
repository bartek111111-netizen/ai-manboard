/**
 * Log persistence (Faza 8.3): stores instance logs per model.
 * - Last N runs per model (default 5)
 * - Each run: `{timestamp}.log` in `~/.ai-dashboard/logs/{modelId}/`
 * - Auto-cleanup of oldest when exceeding limit
 */
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";

const DATA_DIR =
  process.env.AI_DASHBOARD_HOME ?? join(homedir(), ".ai-dashboard");
const LOGS_DIR = join(DATA_DIR, "logs");
// Per-model cap for ALL run logs (auto + manual + engine per-start files),
// matching the LogWriter's `retentionFiles`. The oldest is shed when the
// total exceeds this.
const MAX_TOTAL_RUNS = 30;

/** Returns the log directory for a model. */
export function logDir(modelId: string): string {
  return join(LOGS_DIR, modelId);
}

/** Creates the log directory for a model. */
export function ensureLogDir(modelId: string): string {
  const dir = logDir(modelId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes a new auto log file for a run. Returns the file path. */
export function writeAutoLog(modelId: string, content: string): string {
  const dir = ensureLogDir(modelId);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = join(dir, `auto-${ts}.log`);
  writeFileSync(filePath, content, "utf8");
  cleanupRuns(modelId);
  return filePath;
}

/** Writes a new manual log file for a run. Returns the file path. */
export function writeManualLog(modelId: string, content: string): string {
  const dir = ensureLogDir(modelId);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = join(dir, `manual-${ts}.log`);
  writeFileSync(filePath, content, "utf8");
  cleanupRuns(modelId);
  return filePath;
}

export interface RunLogInfo {
  file: string;
  /** Absolute path on the dashboard host (shown on hover, copied, or opened). */
  path: string;
  ts: string;
  size: number;
  /**
   * - "auto": a store snapshot written automatically (on stop / on demand).
   * - "manual": a store snapshot written when the user clicks "Zapisz".
   * - "engine": the live LogWriter file (`<preset>-<stamp>.log`) the engine
   *   appends to on each start.
   */
  type: "auto" | "manual" | "engine";
}

/** Lists log files for a model (newest first). */
export function listRunLogs(modelId: string): RunLogInfo[] {
  const dir = logDir(modelId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .map((f) => {
      const full = join(dir, f);
      const st = statSync(full);
      const type = f.startsWith("auto-")
        ? ("auto" as const)
        : f.startsWith("manual-")
          ? ("manual" as const)
          : ("engine" as const);
      // The filename carries a UTC stamp with NO timezone marker, and parsing
      // it as local time shifted the displayed time (e.g. 2 h in CEST). The
      // file's mtime is the trustworthy write instant — return it as a full
      // ISO string (with `Z`) so clients render it in the viewer's local TZ.
      const ts = new Date(st.mtimeMs).toISOString();
      return { file: f, path: full, ts, size: st.size, type };
    })
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

/** Reads a specific log file. Returns null if not found. */
export function readRunLog(modelId: string, file: string): string | null {
  const dir = logDir(modelId);
  const full = join(dir, file);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf8");
}

/** Deletes a specific log file. */
export function deleteRunLog(modelId: string, file: string): void {
  const dir = logDir(modelId);
  const full = join(dir, file);
  if (existsSync(full)) unlinkSync(full);
}

/** Clears all logs for a model. */
export function clearModelLogs(modelId: string): void {
  const dir = logDir(modelId);
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".log")) unlinkSync(join(dir, f));
  }
}

/** Sheds the oldest run logs (all types) when the model total exceeds `MAX_TOTAL_RUNS`. */
function cleanupRuns(modelId: string): void {
  const logs = listRunLogs(modelId);
  while (logs.length > MAX_TOTAL_RUNS) {
    const oldest = logs[logs.length - 1];
    deleteRunLog(modelId, oldest.file);
    logs.pop();
  }
}
