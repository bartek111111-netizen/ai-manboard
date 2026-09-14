/**
 * API DTOs (PLAN §14) — config (Faza 1) + model (Faza 3) endpoints.
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

// --------------------------------------------------------------- models (Faza 3)

/** Effective capabilities of one model (FM-6): the flags + where they came from. */
export interface ModelCapabilitiesView {
  /** Effective capability flags, e.g. `{ text: true, vision: false }`. */
  flags: Record<string, boolean>;
  /** `manual` = the user set them (authoritative); `heuristic` = engine suggestion. */
  source: 'manual' | 'heuristic';
}

/** GGUF header metadata (FM-5) — read from the file header only (fast, safe). */
export interface GgufMetadataView {
  /** GGUF format version. */
  version?: number;
  /** `general.architecture` (e.g. `llama`, `qwen2_vision`). */
  architecture?: string;
  /** `llama.context_length`. */
  contextLength?: number;
  /** `llama.block_size`. */
  blockSize?: number;
  /** `llama.attention.head_count`. */
  headCount?: number;
}

/** One model as shown in the API/UI (PLAN §14.1: `GET /models`). */
export interface ModelView {
  id: string;
  /** Model file path (the `model` parameter). */
  path: string;
  engineId: string;
  displayName: string;
  description?: string;
  tags: string[];
  /** Effective capabilities (manual override > heuristic). */
  capabilities: ModelCapabilitiesView;
  /** GGUF header (null = not a GGUF file / unreadable). */
  gguf: GgufMetadataView | null;
  /** File size in bytes (null when the file is missing). */
  sizeBytes: number | null;
  /** Whether the model file still exists on disk. */
  fileExists: boolean;
  /** Where the model came from. */
  origin: 'discover' | 'manual';
}

/** Manual add (FM-3): the only path input to the API (S-4, file picker). */
export interface AddModelRequest {
  /** Absolute local path to the model file. */
  path: string;
  /** Engine that runs the model (e.g. `llama-server`). */
  engineId: string;
  displayName?: string;
  /** Manual capabilities (authoritative); omit to rely on heuristics. */
  capabilities?: Record<string, boolean>;
}

/** Manual edit (FM-5/6): `PATCH /models/:id`. All fields optional. */
export interface UpdateModelRequest {
  displayName?: string;
  description?: string;
  tags?: string[];
  /** Replaces the manual capabilities and marks them authoritative. */
  capabilities?: Record<string, boolean>;
  /** Merged into the model-level params (layer 4). */
  params?: Record<string, unknown>;
}

/** Result of a discovery scan (FM-2): `POST /models/discover`. */
export interface DiscoverResponse {
  /** Model ids created by this scan. */
  added: string[];
  /** Model file paths that disappeared since the last scan. */
  removed: string[];
  /** Total number of models after the scan. */
  total: number;
}
