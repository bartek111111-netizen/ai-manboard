/**
 * Inference engine abstraction (PLAN §7.1) — Faza 2.
 *
 * An engine is a module: a declarative parameter schema (the UI renders
 * forms from data, §7.2), a launch-command builder, readiness probes, a log
 * classifier and validation. Node-only parts (fs/child_process) live in the
 * engine modules, never here.
 */
import type { ResolvedConfig } from '../config/types.js';

/** Model capabilities (FM-6) — extensible list; manual override wins. */
export type Capability =
  | 'text'
  | 'vision'
  | 'audio'
  | 'tool-calling'
  | 'thinking'
  | 'image-generation'
  | (string & {});

/**
 * Declarative parameter schema (PLAN §7.2): data, not UI code.
 * The SchemaForm on the frontend renders groups/types/validation from this;
 * the same schemas validate configuration on the server.
 */
export interface ParamSchema {
  /** Parameter key (also used in config files, e.g. `context-size`). */
  key: string;
  /** Human-readable label for the UI (app language: Polish). */
  label: string;
  type: 'int' | 'float' | 'string' | 'bool' | 'enum' | 'path-model' | 'path-file';
  /** Mapping to the binary flag (e.g. `--ctx-size`). */
  flag?: string;
  /** Schema default — layer 1 of the merge (§9.1). */
  default: unknown;
  min?: number;
  max?: number;
  /** Allowed values for `enum`. */
  choices?: { value: unknown; label?: string }[];
  /** Also accept arbitrary integers in addition to the enum choices (e.g. gpu-layers). */
  allowNumber?: boolean;
  group: 'model' | 'performance' | 'sampling' | 'speculative' | 'vision' | 'moe' | 'server' | 'advanced';
  description?: string;
  /** Hidden in the "Zaawansowane" (collapsed) UI section. */
  advanced?: boolean;
  /** E.g. `gpu` — hidden/skipped when the feature is unavailable. */
  requiresEngineFeature?: string;
  /** bool: flag sent when the value is `false` (e.g. `--no-slots`). */
  offFlag?: string;
  /** bool: sent as `<flag> <offValue>` when `false` (e.g. `--fit off`). */
  offValue?: string;
}

/** A launch command ready to be spawned by the process manager (§11). */
export interface LaunchCommand {
  binary: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * Input to `buildLaunch`: the resolved configuration (layer merge, §9.1)
 * plus the binary path and the model file path.
 */
export interface LaunchContext {
  /** Path to the executable (resolved from engine config). */
  binary: string;
  /** Absolute path to the model file. */
  modelPath: string;
  /** Final resolved parameter values (all schema keys). */
  params: Record<string, unknown>;
  /** Working directory of the spawned process (default: the model file's directory). */
  cwd?: string;
  /** Extra environment variables for the process. */
  env?: Record<string, string>;
}

/** Unified runtime data from the backend API (FMK-6, §10.3). */
export interface RuntimeInfo {
  backendVersion?: string;
  modelLoaded?: string;
  contextSize?: number;
  slots?: { total: number; used: number };
  tokensPerSec?: number;
  gpu?: { memoryUsedMB?: number; memoryTotalMB?: number; utilization?: number };
  /** Raw, engine-specific fields (debug UI). */
  extras: Record<string, unknown>;
}

/** Minimal instance view (state/instance, §11 — full model in Faza 4). */
export interface InstanceView {
  id: string;
  modelId: string;
  presetName: string;
  port: number;
}

/** Classification of one log line (§10.4). */
export interface LogClassification {
  level: 'info' | 'warn' | 'error';
  /** Informational ready marker (e.g. `server is listening`). */
  readyMarker?: boolean;
  /** A known, non-error warning (e.g. the RADV conformance notice). */
  knownWarning?: boolean;
}

/** One issue found during validation/preflight. */
export interface PreflightIssue {
  code: string;
  message: string;
}

/** Environment check result before launch (§10.5). */
export interface PreflightResult {
  ok: boolean;
  /** Blocking failures (empty when ok=true). */
  errors: PreflightIssue[];
  /** Non-blocking warnings (UI message). */
  warnings: PreflightIssue[];
}

/** Binary check result (PUT /engines/:id, ONB-2). */
export interface BinaryCheckResult {
  binary: string;
  exists: boolean;
  executable: boolean;
  /** `--version` exited 0. */
  versionOk: boolean;
  /** The `version:` line from `--version` output. */
  versionLine?: string;
  /** Linked against libvulkan (`ldd`/`readelf`). */
  vulkan: boolean;
  /** Blocking errors (empty = ok). */
  errors: string[];
}

/** Minimal model info for engine calls (full metadata — Faza 3, §8). */
export interface ModelInfo {
  /** Registry id (`slug(name) + '-' + hash8(path)`, §8.1). */
  id: string;
  /** Absolute path to the model file. */
  path: string;
  /** The engine that runs this model. */
  engineId: string;
  /** GGUF `general.architecture` (when read). */
  architecture?: string;
}

/** The inference engine interface (PLAN §7.1). */
export interface InferenceEngine {
  id: string;
  displayName: string;
  description: string;
  /** File patterns for auto-detection, e.g. `["*.gguf"]`. */
  filePatterns: string[];
  /** Declarative parameter schema — the UI builds a form from it. */
  schema: ParamSchema[];
  /** Heuristic model capabilities (overridden manually, FM-6). */
  detectCapabilities(model: ModelInfo): Capability[];
  /** Builds a spawn-ready command from the resolved config. */
  buildLaunch(ctx: LaunchContext): Promise<LaunchCommand>;
  /** Does the backend respond and is it ready? (readiness probe, FP-5) */
  isReady(instance: InstanceView, base: string): Promise<boolean>;
  /** Additional data from the backend API → unified RuntimeInfo (FMK-6). */
  fetchRuntimeInfo(base: string): Promise<RuntimeInfo | null>;
  /** Classifies a log line: level + error/ready markers. */
  classifyLog(line: string): LogClassification;
  /** Engine-specific validation (beyond the schema types). */
  validate(model: ModelInfo, cfg: ResolvedConfig): string[];
  /** Optional: environment check before launch (GPU, binary, port). */
  preflight?(ctx: LaunchContext): Promise<PreflightResult>;
  /** Binary check: path, executability, `--version`, libvulkan. */
  checkBinary?(binary: string): Promise<BinaryCheckResult>;
}
