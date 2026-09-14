/**
 * JSON config store over `~/.ai-dashboard` (PLAN §9.3, §15, Faza 1.1):
 * - atomic writes (tmp + fsync + rename),
 * - `.bak` of the last version under `.backups/` before every overwrite,
 * - schema validation on every read (a bad file is an error, never a
 *   silent overwrite — §15),
 * - version migration on read (migrate.ts).
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, relative } from 'node:path';
import {
  AppError,
  defaultGlobalConfig,
  validateEngineConfig,
  validateGlobalConfig,
  validateModelConfig,
  validatePreset,
  type ConfigSnapshot,
  type EngineConfig,
  type GlobalConfig,
  type ModelConfig,
  type Preset,
} from '@ai-dashboard/shared';
import { migrateConfigFile } from './migrate.js';
import type { DashboardHome } from './paths.js';

/** Ids used as file names (engineId, modelId, presetName) — no path traversal. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeId(id: string, what: string): void {
  if (!SAFE_ID.test(id)) {
    throw new AppError(
      'CONFIG_INVALID',
      `${what}: invalid id "${id}" (allowed: letters, digits, ".", "-", "_")`,
    );
  }
}

function parseJson(file: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError('CONFIG_INVALID', `${label}: invalid JSON (${message})`, { file });
  }
}

function listIds(dir: string): string[] {
  const files = readdirSync(dir);
  const ids: string[] = [];
  for (const file of files) {
    if (file.endsWith('.json')) ids.push(file.slice(0, -'.json'.length));
  }
  ids.sort();
  // Ignore any entry that is not a safe id (foreign file on disk).
  return ids.filter((id) => SAFE_ID.test(id));
}

export class ConfigStore {
  constructor(readonly home: DashboardHome) {}

  // ---------------------------------------------------------------- global

  /**
   * Reads + validates `config/global.json`.
   * First run (file missing): seeds the default config (PLAN §9.4).
   * @throws AppError('CONFIG_INVALID') on a corrupt/invalid file — boot must stop.
   */
  readGlobal(): GlobalConfig {
    const file = this.home.globalFile;
    if (!existsSync(file)) {
      const config = defaultGlobalConfig();
      this.writeGlobal(config);
      return config;
    }
    const raw = parseJson(file, 'global.json');
    return validateGlobalConfig(migrateConfigFile(raw, 'global'), 'global.json');
  }

  writeGlobal(config: GlobalConfig): void {
    this.writeConfigFile(this.home.globalFile, 'global.json', config);
  }

  // -------------------------------------------------------------- engines

  /** Reads `config/engines/<engineId>.json`; null when absent. */
  readEngine(engineId: string): EngineConfig | null {
    assertSafeId(engineId, 'engineId');
    const file = `${this.home.enginesDir}/${engineId}.json`;
    if (!existsSync(file)) return null;
    const raw = parseJson(file, `engines/${engineId}.json`);
    return validateEngineConfig(migrateConfigFile(raw, 'engine'), engineId);
  }

  writeEngine(engineId: string, config: EngineConfig): void {
    assertSafeId(engineId, 'engineId');
    this.writeConfigFile(`${this.home.enginesDir}/${engineId}.json`, `engines/${engineId}.json`, config);
  }

  listEngineIds(): string[] {
    return listIds(this.home.enginesDir);
  }

  // --------------------------------------------------------------- models

  /** Reads `config/models/<modelId>.json`; null when absent. */
  readModel(modelId: string): ModelConfig | null {
    assertSafeId(modelId, 'modelId');
    const file = `${this.home.modelsDir}/${modelId}.json`;
    if (!existsSync(file)) return null;
    const raw = parseJson(file, `models/${modelId}.json`);
    return validateModelConfig(migrateConfigFile(raw, 'model'), modelId);
  }

  writeModel(modelId: string, config: ModelConfig): void {
    assertSafeId(modelId, 'modelId');
    this.writeConfigFile(`${this.home.modelsDir}/${modelId}.json`, `models/${modelId}.json`, config);
  }

  listModelIds(): string[] {
    return listIds(this.home.modelsDir);
  }

  /**
   * Deletes a model from the dashboard (FM-8): the model config + its preset
   * dir. The model **file** is never touched (S-5, read-only).
   */
  deleteModel(modelId: string): void {
    assertSafeId(modelId, 'modelId');
    const file = `${this.home.modelsDir}/${modelId}.json`;
    if (existsSync(file)) unlinkSync(file);
    const presetDir = `${this.home.presetsDir}/${modelId}`;
    if (existsSync(presetDir)) rmSync(presetDir, { recursive: true, force: true });
  }

  // -------------------------------------------------------------- presets

  /** Reads `config/presets/<modelId>/<presetName>.json`; null when absent. */
  readPreset(modelId: string, presetName: string): Preset | null {
    assertSafeId(modelId, 'modelId');
    assertSafeId(presetName, 'presetName');
    const file = `${this.home.presetsDir}/${modelId}/${presetName}.json`;
    if (!existsSync(file)) return null;
    const raw = parseJson(file, `presets/${modelId}/${presetName}.json`);
    return validatePreset(migrateConfigFile(raw, 'preset'), presetName);
  }

  writePreset(modelId: string, presetName: string, preset: Preset): void {
    assertSafeId(modelId, 'modelId');
    assertSafeId(presetName, 'presetName');
    this.writeConfigFile(
      `${this.home.presetsDir}/${modelId}/${presetName}.json`,
      `presets/${modelId}/${presetName}.json`,
      preset,
    );
  }

  listPresets(modelId: string): string[] {
    assertSafeId(modelId, 'modelId');
    const dir = `${this.home.presetsDir}/${modelId}`;
    if (!existsSync(dir)) return [];
    return listIds(dir);
  }

  // ------------------------------------------------------------- snapshot

  /** Reads every layer into one snapshot (for `GET /api/v1/config`). */
  snapshot(): ConfigSnapshot {
    const engines: Record<string, EngineConfig> = {};
    for (const id of this.listEngineIds()) {
      const config = this.readEngine(id);
      if (config) engines[id] = config;
    }

    const models: Record<string, ModelConfig> = {};
    for (const id of this.listModelIds()) {
      const config = this.readModel(id);
      if (config) models[id] = config;
    }

    const presets: Record<string, Record<string, Preset>> = {};
    for (const id of Object.keys(models)) {
      const forModel: Record<string, Preset> = {};
      for (const name of this.listPresets(id)) {
        const preset = this.readPreset(id, name);
        if (preset) forModel[name] = preset;
      }
      presets[id] = forModel;
    }

    return { global: this.readGlobal(), engines, models, presets };
  }

  // ------------------------------------------------------------ low level

  private writeConfigFile(file: string, label: string, data: unknown): void {
    try {
      mkdirSync(dirname(file), { recursive: true }); // e.g. presets/<modelId>/ on first preset
      const content = `${JSON.stringify(data, null, 2)}\n`;
      this.atomicWrite(file, content);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : 'unknown error';
      throw new AppError('CONFIG_WRITE_FAILED', `could not write ${label}`, {
        file,
        cause: message,
      });
    }
  }

  /**
   * Atomic write: tmp file in the same directory → fsync → rename.
   * The current version is first copied to `.backups/` (PLAN §9.3).
   */
  private atomicWrite(file: string, content: string): void {
    if (existsSync(file)) {
      const backupPath = this.backupPath(file);
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(file, backupPath);
    }
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    const handle = openSync(tmp, 'w');
    try {
      writeSync(handle, content);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(tmp, file);
  }

  /** `.backups/` mirrors the config path with a `.bak` extension. */
  private backupPath(file: string): string {
    const rel = relative(this.home.configDir, file);
    return `${this.home.backupsDir}/${rel}.bak`;
  }
}
