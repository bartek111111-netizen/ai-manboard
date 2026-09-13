/**
 * API DTOs (PLAN §14) — config endpoints (Faza 1).
 */
import type {
  EngineConfig,
  GlobalConfig,
  ModelConfig,
  Preset,
  ResolvedConfig,
} from '../config/types.js';

/** All stored config layers at a point in time (PLAN §14.1: `GET /config`). */
export interface ConfigSnapshot {
  global: GlobalConfig;
  /** engineId → engine config (layer 3). */
  engines: Record<string, EngineConfig>;
  /** modelId → model config (layer 4). */
  models: Record<string, ModelConfig>;
  /** modelId → presetName → preset (layer 5). */
  presets: Record<string, Record<string, Preset>>;
}

/**
 * Live state of the on-disk config watch (P-12): the dashboard watches
 * `config/` with fs `watch` + debounce and reloads on external change.
 */
export interface ConfigWatchState {
  /** `~/.ai-dashboard` root (AI_DASHBOARD_HOME). */
  home: string;
  /** Whether the fs watcher is active. */
  watchActive: boolean;
  /** ISO timestamp of the last on-disk change picked up by the watcher (null = none). */
  lastExternalChangeAt: string | null;
  /** Number of successful reloads after on-disk changes. */
  reloadCount: number;
  /** Last reload failure (e.g. invalid file on disk); null = healthy. */
  lastReloadError: string | null;
}

/** Response of `GET /api/v1/config`: every layer + effective merge. */
export interface ConfigResponse extends ConfigSnapshot {
  /**
   * Effective merge per (model, preset) using the layers available at
   * Faza 1: global defaults → engine → model → preset. Schema defaults
   * (layer 1) and instance overrides (layer 6) join in later phases.
   */
  effective: Record<string, Record<string, ResolvedConfig>>;
  /** Watch state (P-12 UI warning source). */
  state: ConfigWatchState;
}
