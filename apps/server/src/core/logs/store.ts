/**
 * Log persistence (Faza 8.3): stores instance logs per model.
 * - Last N runs per model (default 5)
 * - Each run: `{timestamp}.log` in `~/.ai-dashboard/logs/{modelId}/`
 * - Auto-cleanup of oldest when exceeding limit
 */
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

const DATA_DIR = process.env.AI_DASHBOARD_HOME ?? join(homedir(), '.ai-dashboard');
const LOGS_DIR = join(DATA_DIR, 'logs');
const MAX_RUNS = 5;

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

/** Writes a new log file for a run. Returns the file path. */
export function writeRunLog(modelId: string, content: string): string {
  const dir = ensureLogDir(modelId);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = join(dir, `${ts}.log`);
  writeFileSync(filePath, content, 'utf8');
  cleanupRuns(modelId);
  return filePath;
}

/** Lists log files for a model (newest first). */
export function listRunLogs(modelId: string): { file: string; ts: string; size: number }[] {
  const dir = logDir(modelId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => {
      const full = join(dir, f);
      const st = statSync(full);
      return { file: f, ts: f.replace('.log', ''), size: st.size };
    })
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

/** Reads a specific log file. Returns null if not found. */
export function readRunLog(modelId: string, file: string): string | null {
  const dir = logDir(modelId);
  const full = join(dir, file);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
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
    if (f.endsWith('.log')) unlinkSync(join(dir, f));
  }
}

/** Removes the oldest run when exceeding MAX_RUNS. */
function cleanupRuns(modelId: string): void {
  const logs = listRunLogs(modelId);
  while (logs.length > MAX_RUNS) {
    const oldest = logs[logs.length - 1];
    deleteRunLog(modelId, oldest.file);
    logs.pop();
  }
}
