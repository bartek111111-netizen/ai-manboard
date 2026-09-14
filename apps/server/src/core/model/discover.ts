/**
 * Model discovery (PLAN §8.1, FM-2): recursive scan of `global.modelDirs`
 * (depth ≤ 4), matching each engine's `filePatterns`. Results are cached in
 * `state/models-cache.json` (path + mtime + size) so a rescan is differential:
 * only new files create model configs; deleted files are reported, never
 * auto-removed (S-5: the dashboard never deletes model files).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CURRENT_CONFIG_VERSION, type InferenceEngine } from '@ai-dashboard/shared';
import type { ConfigStore } from '../config/store.js';
import type { DashboardHome } from '../config/paths.js';
import { modelIdFor } from './ids.js';

/** Max scan depth below a model dir (PLAN §8.1: głebokość ≤ 4). */
export const DEFAULT_MAX_DEPTH = 4;

/** One cached file: what the last scan saw. */
export interface CacheEntry {
  mtimeMs: number;
  sizeBytes: number;
  modelId: string;
  engineId: string;
}

/** `state/models-cache.json`: absolute path → last-seen entry. */
export type ModelCache = Record<string, CacheEntry>;

/** Result of a discovery scan. */
export interface DiscoverResult {
  /** Model ids created by this scan. */
  added: string[];
  /** Model file paths that disappeared since the last scan. */
  removed: string[];
  /** Total number of models after the scan. */
  total: number;
}

/** Path of the scan cache file. */
export function cacheFile(home: DashboardHome): string {
  return join(home.stateDir, 'models-cache.json');
}

/** Reads the scan cache; empty when absent or unreadable. */
export function readCache(home: DashboardHome): ModelCache {
  try {
    if (!existsSync(cacheFile(home))) return {};
    return JSON.parse(readFileSync(cacheFile(home), 'utf-8')) as ModelCache;
  } catch {
    return {};
  }
}

/** Writes the scan cache atomically (tmp + rename). */
export function writeCache(home: DashboardHome, cache: ModelCache): void {
  const file = cacheFile(home);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, file);
}

/** Matches a file name against an engine glob pattern (supports `*` and `?`). */
export function matchesPattern(fileName: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`);
  return regex.test(fileName);
}

/**
 * Recursively scans `dir` (up to `maxDepth` levels below it) for files whose
 * name matches any `patterns`, collecting absolute paths.
 */
export function scanDir(
  dir: string,
  patterns: string[],
  maxDepth: number,
  depth = 0,
): string[] {
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // unreadable / missing dir
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth) found.push(...scanDir(full, patterns, maxDepth, depth + 1));
    } else if (entry.isFile()) {
      if (patterns.some((p) => matchesPattern(entry.name, p))) found.push(full);
    }
  }
  return found;
}

/**
 * Runs a discovery scan (FM-2):
 * - scans `global.modelDirs` for the engines' `filePatterns` (depth ≤ 4);
 * - creates a model config for each newly found file (origin `discover`);
 * - reports files that disappeared since the last scan;
 * - refreshes `state/models-cache.json`.
 * Existing model configs are never overwritten (manual fields stay intact).
 */
export function discoverModels(store: ConfigStore, engines: InferenceEngine[]): DiscoverResult {
  const home = store.home;
  const global = store.readGlobal();
  const patterns = [...new Set(engines.flatMap((e) => e.filePatterns))];

  const found = new Map<string, { mtimeMs: number; sizeBytes: number; modelId: string; engineId: string }>();
  for (const dir of global.modelDirs) {
    for (const file of scanDir(dir, patterns, DEFAULT_MAX_DEPTH)) {
      const engine = engines.find((e) => e.filePatterns.some((p) => matchesPattern(file.split('/').pop() ?? '', p)));
      const modelId = modelIdFor(file);
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      found.set(file, {
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
        modelId,
        engineId: engine?.id ?? 'llama-server',
      });
    }
  }

  const cache = readCache(home);
  const added: string[] = [];
  for (const [path, info] of found) {
    if (store.readModel(info.modelId) === null) {
      // New file → create a model config (params.model = path, layer 4).
      store.writeModel(info.modelId, {
        version: CURRENT_CONFIG_VERSION,
        engineId: info.engineId,
        displayName: path.split('/').pop() ?? info.modelId,
        tags: [],
        capabilities: {},
        origin: 'discover',
        params: { model: path },
      });
      added.push(info.modelId);
    }
  }

  const removed = Object.keys(cache).filter((p) => !found.has(p));
  writeCache(home, Object.fromEntries(found));

  return { added, removed, total: store.listModelIds().length };
}
