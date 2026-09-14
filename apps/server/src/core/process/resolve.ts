/**
 * Instance resolver (PLAN §11.1, §5.3, Faza 5.2) — turns an instance id
 * (`<modelId>--<presetName>`) into a spawn-ready plan: the resolved config
 * (layers 1–5, §9.1), the exact launch command, and the port/base for probes.
 *
 * Kept separate from the lifecycle so the config merge is unit-testable on a
 * temp `~/.ai-dashboard` without spawning anything.
 */
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  AppError,
  type InferenceEngine,
  type LaunchCommand,
  type LaunchContext,
  type ResolvedConfig,
} from '@ai-dashboard/shared';
import type { ConfigStore } from '../config/store.js';
import { buildEffective } from '../config/layers.js';
import { allocatePort, assertPortFree, assertValidPort } from './ports.js';

/** An instance id is `<modelId>--<presetName>` (the model id never contains `--`). */
export function resolveInstanceId(instanceId: string): { modelId: string; presetName: string } {
  const idx = instanceId.indexOf('--');
  if (idx <= 0 || idx === instanceId.length - 2) {
    throw new AppError(
      'INSTANCE_NOT_FOUND',
      `invalid instance id "${instanceId}" (expected <modelId>--<presetName>)`,
      undefined,
      404,
    );
  }
  return { modelId: instanceId.slice(0, idx), presetName: instanceId.slice(idx + 2) };
}

export interface ResolvedInstance {
  instanceId: string;
  modelId: string;
  presetName: string;
  engine: InferenceEngine;
  /** Effective config (layers 1–5, with per-value provenance). */
  resolved: ResolvedConfig;
  /** Flattened parameter values (all schema keys + `port` + `host`). */
  params: Record<string, unknown>;
  /** The spawn-ready command (exact CLI). */
  launch: LaunchCommand;
  /** The port the process will bind. */
  port: number;
  /** The bind host. */
  host: string;
  /** Probe base URL: `http://<host>:<port>`. */
  base: string;
}

export interface InstanceResolverDeps {
  store: ConfigStore;
  engines: InferenceEngine[];
  /** Ports already claimed by other instances (`registry.takenPorts()`). */
  takenPorts: () => number[];
  /** The instance registry (to exclude the current instance's own port). */
  registry: { get(instanceId: string): { port: number } | null };
}

/** Schema defaults (layer 1) per engine, built from `ParamSchema[].default`. */
function schemaDefaults(engines: InferenceEngine[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const engine of engines) {
    const params: Record<string, unknown> = {};
    for (const p of engine.schema) params[p.key] = p.default;
    out[engine.id] = params;
  }
  return out;
}

/** Expands a leading `~`/`~/` to the user's home (Node spawn does not). */
function expandHome(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`;
  return path;
}

export class InstanceResolver {
  constructor(private readonly deps: InstanceResolverDeps) {}

  /** All known instance ids: every (model, preset) pair in the config. */
  listIds(): string[] {
    const { store } = this.deps;
    const ids: string[] = [];
    for (const modelId of store.listModelIds()) {
      for (const presetName of store.listPresets(modelId)) {
        ids.push(`${modelId}--${presetName}`);
      }
    }
    return ids.sort();
  }

  /**
   * Resolves an instance id into a spawn-ready plan.
   * @throws AppError('MODEL_NOT_FOUND' | 'PRESET_NOT_FOUND' | 'ENGINE_NOT_FOUND' | 'PORT_IN_USE' | 'VALIDATION_FAILED').
   */
  async resolve(instanceId: string): Promise<ResolvedInstance> {
    const { modelId, presetName } = resolveInstanceId(instanceId);
    const store = this.deps.store;

    const model = store.readModel(modelId);
    if (!model) throw new AppError('MODEL_NOT_FOUND', `model not found: ${modelId}`, undefined, 404);
    const preset = store.readPreset(modelId, presetName);
    if (!preset) {
      throw new AppError('PRESET_NOT_FOUND', `preset not found: ${presetName} (model ${modelId})`, undefined, 404);
    }
    const engine = this.deps.engines.find((e) => e.id === model.engineId);
    if (!engine) throw new AppError('ENGINE_NOT_FOUND', `engine not found: ${model.engineId}`, undefined, 404);

    const snapshot = store.snapshot();
    const resolved = buildEffective(snapshot, schemaDefaults(this.deps.engines))[modelId]?.[presetName];
    if (!resolved) {
      throw new AppError('CONFIG_INVALID', `could not resolve the config for instance ${instanceId}`);
    }

    const global = store.readGlobal();
    const binary = expandHome(global.engines[engine.id]?.binary);
    if (!binary) {
      throw new AppError('ENGINE_NOT_FOUND', `no binary configured for engine ${engine.id} (Settings)`);
    }
    const modelPath = typeof model.params?.model === 'string' ? model.params.model : '';
    if (!modelPath) throw new AppError('VALIDATION_FAILED', `model file path is missing for ${modelId}`);

    // Exclude the current instance's own port (it may already be running on it
    // — `getFullDto` calls `resolve` to read config, not to spawn).
    const currentPort = this.deps.registry.get(instanceId)?.port ?? null;
    const taken = this.deps.takenPorts().filter((p) => p !== currentPort);
    let port: number;
    if (preset.port !== undefined) {
      assertValidPort(preset.port);
      assertPortFree(preset.port, global.portRange, taken);
      port = preset.port;
    } else {
      port = allocatePort(global.portRange, taken);
    }

    const params: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(resolved)) params[key] = entry.value;
    params.port = port;
    const host = typeof params.host === 'string' && params.host.trim() !== '' ? params.host : '127.0.0.1';

    const ctx: LaunchContext = { binary, modelPath, params, cwd: dirname(modelPath), env: {} };
    const launch = await engine.buildLaunch(ctx);

    return { instanceId, modelId, presetName, engine, resolved, params, launch, port, host, base: `http://${host}:${port}` };
  }
}

