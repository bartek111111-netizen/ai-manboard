/**
 * REST client for the dashboard API (Faza 7: models, instances, presets, engines).
 * SSE streams are in `api/sse.ts`.
 */
import type {
  ConfigResponse,
  InstanceInfo,
  InstanceState,
  ModelView,
  Preset,
} from '@ai-dashboard/shared';

export type { InstanceInfo, InstanceState, ModelView, Preset };

export interface DashboardStatus {
  name: string;
  version: string;
  state: string;
  uptimeSec: number;
  timestamp: string;
  engines: unknown[];
  /** Config watch state (P-12). */
  config?: ConfigResponse['state'];
}

/** A registered engine as returned by `GET /api/v1/engines`. */
export interface EngineInfo {
  id: string;
  displayName: string;
  description: string;
  filePatterns: string[];
  /** Whether a binary path is configured (engine or global layer). */
  configured: boolean;
  binary: string | null;
  binarySource: 'engine' | 'global' | null;
}

/** The resolved runtime info for a live instance (engine-specific). */
export interface RuntimeInfoView {
  backendVersion?: string;
  modelLoaded?: boolean;
  contextSize?: number;
  slots?: { total: number; used: number };
  tokensPerSec?: number;
  gpu?: { memoryUsedMB?: number; memoryTotalMB?: number; utilization?: number };
  extras: Record<string, unknown>;
}

/** GPU info (mirrors the server's `GpuInfo`). */
export interface GpuView {
  name?: string;
  memoryUsedMB?: number | null;
  memoryTotalMB?: number | null;
  utilization?: number | null;
}

/** Full instance DTO (mirrors the server's `InstanceDto`, §14.2). */
export interface InstanceDto {
  instanceId: string;
  modelId: string;
  preset: string;
  state: InstanceState;
  pid: number | null;
  port: number;
  endpoint: string;
  startedAt: string | null;
  uptimeSec: number | null;
  configSource: Record<string, string>;
  runtime: RuntimeInfoView | null;
  process: { cpuPct: number | null; rssMB: number | null };
  gpu?: GpuView | null;
  ttft?: { tokens: number; seconds: number; tps: number } | null;
  lastError: { exitCode: number | null; signal: string | null } | null;
}

/**
 * An engine process detected running OUTSIDE the dashboard (PLAN §16.4): the
 * captured command line (settings), port, model info, memory and start time.
 */
export interface ExternalInstanceView {
  detected: 'external';
  pid: number;
  /** The full `argv` of the process. */
  cmdline: string[];
  /** The captured `--key → value` settings. */
  params: Record<string, string>;
  modelPath: string | null;
  port: number | null;
  host: string;
  rssMB: number | null;
  uptimeSec: number | null;
  /** From the live server's `/v1/models` (works without `--metrics`). */
  modelName: string | null;
  contextSize: number | null;
  quantization: string | null;
  gpu: GpuView | null;
  /** The registered instance it maps to (null when not recognized). */
  instanceId: string | null;
  modelId: string | null;
  preset: string | null;
}

/** Result of `POST /api/v1/models/discover`. */
export interface DiscoverResult {
  added: number;
  removed: number;
  total: number;
}

/** Engine preflight check result (ONB-1, §16). */
export interface EngineCheck {
  versionLine: string;
  vulkan: boolean;
}

/** Response of `PUT /engines/:id` (binary set + preflight check). */
export interface PutEngineResult {
  binary: string;
  params: Record<string, unknown>;
  check: EngineCheck;
}

/** Error thrown by the REST client (maps to the API error envelope). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await response.json()) as ErrorEnvelope;
      if (body.error?.message) {
        message = body.error.message;
      }
      code = body.error?.code;
      details = body.error?.details;
    } catch {
      // non-JSON body — keep the HTTP status message
    }
    throw new ApiError(message, code, details);
  }
  return (await response.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// --- status / config ---

/** GET /api/v1/status */
export function getStatus(): Promise<DashboardStatus> {
  return request<DashboardStatus>('/api/v1/status');
}

/** GET /api/v1/config — all layers + effective merge + watch state. */
export function getConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>('/api/v1/config');
}

/** PUT /api/v1/config/global — replace the global layer. */
export function putGlobalConfig(body: unknown): Promise<unknown> {
  return request<unknown>('/api/v1/config/global', jsonInit('PUT', body));
}

// --- models (FM) ---

/** GET /api/v1/models */
export function getModels(): Promise<ModelView[]> {
  return request<{ models: ModelView[] }>('/api/v1/models').then((r) => r.models);
}

/** POST /api/v1/models/discover — rescan modelDirs. */
export function discoverModels(): Promise<DiscoverResult> {
  return request<DiscoverResult>('/api/v1/models/discover', jsonInit('POST', {}));
}

/** POST /api/v1/models — manual add (FM-3). Auto-detects engine from file extension. */
export function postModel(body: { path: string; displayName?: string }): Promise<ModelView> {
  // Auto-detect engine: .gguf → llama-server
  const engineId = body.path.endsWith('.gguf') ? 'llama-server' : undefined;
  return request<ModelView>('/api/v1/models', jsonInit('POST', { ...body, engineId }));
}

// --- instances (FSM) ---

/** GET /api/v1/instances */
export function getInstances(): Promise<InstanceInfo[]> {
  return request<{ instances: InstanceInfo[] }>('/api/v1/instances').then((r) => r.instances);
}

/** GET /api/v1/instances/:instanceId — full DTO (§14.2). */
export function getInstance(instanceId: string): Promise<InstanceDto> {
  return request<InstanceDto>(`/api/v1/instances/${encodeURIComponent(instanceId)}`);
}

/** GET /api/v1/instances/external — engine processes launched outside the app (PLAN §16.4). */
export function getExternalInstances(): Promise<ExternalInstanceView[]> {
  return request<{ instances: ExternalInstanceView[] }>('/api/v1/instances/external').then((r) => r.instances);
}

/** POST /api/v1/instances/:instanceId/start */
export function startInstance(instanceId: string): Promise<{ instanceId: string; state: InstanceState }> {
  return request(`/api/v1/instances/${encodeURIComponent(instanceId)}/start`, jsonInit('POST', {}));
}

/** POST /api/v1/instances/:instanceId/stop */
export function stopInstance(instanceId: string): Promise<{ instanceId: string; state: InstanceState }> {
  return request(`/api/v1/instances/${encodeURIComponent(instanceId)}/stop`, jsonInit('POST', {}));
}

/** POST /api/v1/instances/:instanceId/restart */
export function restartInstance(instanceId: string): Promise<{ instanceId: string; state: InstanceState }> {
  return request(`/api/v1/instances/${encodeURIComponent(instanceId)}/restart`, jsonInit('POST', {}));
}

/** POST /api/v1/instances/:instanceId/resolve — re-check PID, update state (Faza 10.1). */
export function resolveInstance(instanceId: string): Promise<{ instanceId: string; state: InstanceState }> {
  return request(`/api/v1/instances/${encodeURIComponent(instanceId)}/resolve`, jsonInit('POST', {}));
}

// --- presets (CFG) ---

/** GET /api/v1/models/:modelId/presets */
export function getPresets(modelId: string): Promise<Preset[]> {
  return request<{ presets: Preset[] }>(`/api/v1/models/${encodeURIComponent(modelId)}/presets`).then((r) => r.presets);
}

/** PUT /api/v1/models/:modelId/presets/:name */
export function putPreset(modelId: string, name: string, body: Partial<Preset>): Promise<void> {
  return request<void>(
    `/api/v1/models/${encodeURIComponent(modelId)}/presets/${encodeURIComponent(name)}`,
    jsonInit('PUT', body),
  );
}

/** DELETE /api/v1/models/:modelId/presets/:name */
export function deletePreset(modelId: string, name: string): Promise<void> {
  return request<void>(`/api/v1/models/${encodeURIComponent(modelId)}/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/** POST /api/v1/models/:modelId/presets/:name/duplicate */
export function duplicatePreset(modelId: string, name: string, targetName: string): Promise<void> {
  return request<void>(
    `/api/v1/models/${encodeURIComponent(modelId)}/presets/${encodeURIComponent(name)}/duplicate`,
    jsonInit('POST', { name: targetName }),
  );
}

// --- engines ---

/** GET /api/v1/engines */
export function getEngines(): Promise<EngineInfo[]> {
  return request<{ engines: EngineInfo[] }>('/api/v1/engines').then((r) => r.engines);
}

/** GET /api/v1/engines/:id/schema → declarative param schema (drives SchemaForm). */
export function getEngineSchema(engineId: string): Promise<import('@ai-dashboard/shared').ParamSchema[]> {
  return request<{ engineId: string; schema: import('@ai-dashboard/shared').ParamSchema[] }>(
    `/api/v1/engines/${encodeURIComponent(engineId)}/schema`,
  ).then((r) => r.schema);
}

/** PUT /api/v1/engines/:id — set binary (+ validated against `--version`/vulkan). */
export function putEngine(
  id: string,
  body: { binary: string; params?: Record<string, unknown> },
): Promise<PutEngineResult> {
  return request<PutEngineResult>(`/api/v1/engines/${encodeURIComponent(id)}`, jsonInit('PUT', body));
}
