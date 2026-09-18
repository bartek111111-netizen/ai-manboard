/**
 * Configuration layer types (CFG-1, §9.1–9.4).
 *
 * Every instance parameter is resolved as a merge of six layers with
 * ascending priority: schema → global → engine → model → preset → instance.
 * The result carries per-value provenance so the UI can show "skąd" (FC-5).
 */

/** Current config file version. Older versions are migrated (migrate.ts). */
export const CURRENT_CONFIG_VERSION = 1;

/** Layer origin labels, in ascending priority order (for docs/debugging). */
export const CONFIG_SOURCES = [
  "schema",
  "global",
  "engine",
  "model",
  "preset",
  "instance",
] as const;

export type ConfigSource = (typeof CONFIG_SOURCES)[number];

/** Per-parameter result of the layer merge: value + which layer supplied it. */
export interface ResolvedParam<T = unknown> {
  value: T;
  source: ConfigSource;
}

/** Merged config for one (model, preset): parameter key → value + source. */
export type ResolvedConfig = Record<string, ResolvedParam>;

/**
 * `config/global.json` — dashboard-wide settings (CFG-2, §9.4):
 * model directories, engine binaries, ports, timeouts, security, monitoring.
 */
export interface GlobalConfig {
  version: number;
  /** Directories scanned for models (discovery). Absolute paths (S-9). */
  modelDirs: string[];
  /** Global parameter defaults (layer 2 of the merge). */
  defaults: Record<string, unknown>;
  /** Port allocation range for presets/instances (1024–65535, S-9). */
  portRange: { start: number; end: number };
  /** Per-engine global settings: binary path (ONB-1/ONB-2). */
  engines: Record<string, { binary: string }>;
  /** Dashboard HTTP server bind. */
  server: { host: string; port: number };
  /** Optional bearer token (S-2). `null` = off. */
  security: { token: string | null };
  /** Probe cadence and startup budget (FP-5). */
  monitoring: { probeIntervalSec: number; startupTimeoutSec: number };
  /** Log retention (FMK-2). */
  logs: { ringLines: number; retentionFiles: number };
  /** GPU preferences: which GPU to use for models and show in sidebar stats. */
  gpu?: {
    /** Which detected GPU (PCI id) to show in the sidebar stats. */
    preferred?: string | null;
    /** Custom display name for the GPU (overrides the detected name). */
    label?: string;
    /** Whether the custom label is used in the display (sidebar / status / metrics). */
    useLabel?: boolean;
  };
  /** UI notifications: state-change delay in seconds (persisted; UI consumer pending). */
  notifications?: { stateChangeDelaySec?: number };
}

/**
 * `config/engines/<engineId>.json` — engine layer (CFG-3):
 * binary path override + engine-wide default parameters.
 */
export interface EngineConfig {
  version: number;
  binary: string;
  /** Engine-wide parameter defaults (layer 3 of the merge). */
  params: Record<string, unknown>;
}

/**
 * `config/models/<modelId>.json` — model layer (CFG-4) plus manual
 * metadata (FM-5) and capabilities (FM-6).
 */
export interface ModelConfig {
  version: number;
  /** Which engine runs this model (e.g. `llama-server`). */
  engineId?: string;
  displayName?: string;
  description?: string;
  tags: string[];
  /**
   * Capability map (FM-6): e.g. `{ text: true, vision: false }`.
   * When `capabilitiesManual` is set, these are the authoritative values;
   * otherwise the engine heuristics apply.
   */
  capabilities: Record<string, boolean>;
  /** True when the user set capabilities manually (they win over heuristics). */
  capabilitiesManual?: boolean;
  /** Where the model came from: `discover` (scan of modelDirs) or `manual` (POST /models). */
  origin?: "discover" | "manual";
  /** Model-level parameter defaults (layer 4 of the merge). `model` = file path. */
  params: Record<string, unknown>;
  /** True when the model is hidden from the list (user chose to hide it). */
  hidden?: boolean;
  /**
   * The last preset the user used for this model (persisted; drives the default
   * selection in every preset box). Not a launch param — never sent to the engine.
   */
  lastUsedPreset?: string;
}

/**
 * `config/presets/<modelId>/<presetName>.json` — preset layer (CFG-5/6):
 * a named (possibly partial) parameter set with its own port.
 */
export interface Preset {
  version: number;
  /** Preset name (matches the file name). */
  name: string;
  description?: string;
  /** Dedicated port (1024–65535, S-9). */
  port?: number;
  /** Partial or full parameter overrides (layer 5 of the merge). */
  params: Record<string, unknown>;
}
