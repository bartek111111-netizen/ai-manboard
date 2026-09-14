/**
 * Model registry (PLAN §8): the single place that turns model configs
 * (`config/models/<modelId>.json`) into the `ModelView` the API/UI consume.
 * Handles manual add/remove (FM-3/FM-8), manual edits (FM-5/6) and discovery
 * (FM-2). The model file itself is never touched (S-5, read-only).
 */
import { existsSync, statSync } from 'node:fs';
import {
  AppError,
  CURRENT_CONFIG_VERSION,
  type AddModelRequest,
  type GgufMetadataView,
  type InferenceEngine,
  type ModelConfig,
  type ModelInfo,
  type ModelView,
  type UpdateModelRequest,
} from '@ai-dashboard/shared';
import { assertSafeId, type ConfigStore } from '../config/store.js';
import { discoverModels, matchesPattern, type DiscoverResult } from './discover.js';
import { readGgufMetadata } from './gguf.js';
import { modelIdFor } from './ids.js';
import { resolveCapabilities } from './capabilities.js';

export class ModelRegistry {
  constructor(
    private store: ConfigStore,
    private engines: InferenceEngine[],
  ) {}

  /** Lists visible models (excludes hidden), sorted by display name. */
  list(includeHidden = false): ModelView[] {
    const models = this.store
      .listModelIds()
      .map((id) => this.viewFor(id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    return includeHidden ? models : models.filter((m) => !m.hidden);
  }

  /** Returns one model; throws `MODEL_NOT_FOUND` when absent. */
  get(modelId: string): ModelView {
    return this.viewFor(modelId);
  }

  /**
   * Manual add (FM-3): validates the path (exists + matches the engine's
   * `filePatterns`) and registers a model config (origin `manual`).
   * Idempotent: re-adding the same path returns the existing model.
   */
  add(req: AddModelRequest): ModelView {
    const engine = this.engines.find((e) => e.id === req.engineId);
    if (!engine) throw new AppError('ENGINE_NOT_FOUND', `unknown engine: ${req.engineId}`, undefined, 404);
    if (typeof req.path !== 'string' || req.path.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'path: expected a non-empty file path');
    }
    const name = req.path.split('/').pop() ?? '';
    if (!existsSync(req.path)) {
      throw new AppError('MODEL_NOT_FOUND', `the model file does not exist: ${req.path}`);
    }
    if (!engine.filePatterns.some((p) => matchesPattern(name, p))) {
      throw new AppError(
        'VALIDATION_FAILED',
        `the file does not match engine ${engine.id} patterns: ${engine.filePatterns.join(', ')}`,
      );
    }
    const modelId = modelIdFor(req.path);
    const existing = this.store.readModel(modelId);
    if (existing) return this.viewFor(modelId);
    const config: ModelConfig = {
      version: CURRENT_CONFIG_VERSION,
      engineId: req.engineId,
      displayName: req.displayName ?? name,
      tags: [],
      capabilities: req.capabilities ?? {},
      capabilitiesManual: req.capabilities ? true : undefined,
      origin: 'manual',
      params: { model: req.path },
    };
    this.store.writeModel(modelId, config);
    return this.viewFor(modelId);
  }

  /**
   * Remove from the dashboard (FM-8): deletes the model config + its presets,
   * never the model file (S-5).
   */
  remove(modelId: string): void {
    this.requireConfig(modelId);
    this.store.deleteModel(modelId);
  }

  /** Hides or unhides a model (toggles the `hidden` flag). */
  setHidden(modelId: string, hidden: boolean): ModelView {
    const current = this.requireConfig(modelId);
    const next: ModelConfig = { ...current, hidden };
    this.store.writeModel(modelId, next);
    return this.viewFor(modelId);
  }

  /** Lists hidden models (for the Settings UI). */
  listHidden(): ModelView[] {
    return this.store
      .listModelIds()
      .map((id) => this.viewFor(id))
      .filter((m) => m.hidden)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /** Manual edit (FM-5/6): merges the patch into the model config. */
  update(modelId: string, patch: UpdateModelRequest): ModelView {
    const current = this.requireConfig(modelId);
    const next: ModelConfig = {
      ...current,
      displayName: patch.displayName ?? current.displayName,
      description: patch.description ?? current.description,
      tags: patch.tags ?? current.tags ?? [],
      params: { ...(current.params ?? {}), ...(patch.params ?? {}) },
    };
    if (patch.capabilities !== undefined) {
      next.capabilities = patch.capabilities;
      next.capabilitiesManual = true;
    }
    this.store.writeModel(modelId, next);
    return this.viewFor(modelId);
  }

  /** Runs a discovery scan (FM-2) over `global.modelDirs`. */
  discover(): DiscoverResult {
    return discoverModels(this.store, this.engines);
  }

  private requireConfig(modelId: string): ModelConfig {
    assertSafeId(modelId, 'modelId');
    const config = this.store.readModel(modelId);
    if (!config) throw new AppError('MODEL_NOT_FOUND', `model not found: ${modelId}`, undefined, 404);
    return config;
  }

  private viewFor(modelId: string): ModelView {
    const config = this.requireConfig(modelId);
    const path = typeof config.params?.model === 'string' ? config.params.model : '';
    const engine = this.engines.find((e) => e.id === config.engineId);
    const gguf = path ? readGgufMetadata(path) : null;
    const ggufView: GgufMetadataView | null = gguf
      ? {
          version: gguf.version,
          architecture: gguf.architecture,
          contextLength: gguf.contextLength,
          blockSize: gguf.blockSize,
          headCount: gguf.headCount,
        }
      : null;
    const info: ModelInfo = {
      id: modelId,
      path,
      engineId: config.engineId ?? '',
      architecture: gguf?.architecture,
    };
    const heuristics = engine ? engine.detectCapabilities(info) : ['text'];

    let sizeBytes: number | null = null;
    let fileExists = false;
    if (path && existsSync(path)) {
      fileExists = true;
      try {
        sizeBytes = statSync(path).size;
      } catch {
        sizeBytes = null;
      }
    }

    return {
      id: modelId,
      path,
      engineId: config.engineId ?? '',
      displayName: config.displayName ?? path.split('/').pop() ?? modelId,
      description: config.description,
      tags: config.tags ?? [],
      capabilities: resolveCapabilities(config, heuristics),
      gguf: ggufView,
      sizeBytes,
      fileExists,
      origin: config.origin ?? 'manual',
      hidden: config.hidden ?? false,
    };
  }
}
