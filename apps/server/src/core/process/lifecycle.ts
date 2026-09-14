/**
 * Lifecycle manager (PLAN §11, §5.3, Faza 5.2) — the start/stop/restart
 * orchestrator that ties the Faza 3 config, Faza 4 process manager and the
 * Faza 5 health prober together, driving the instance FSM (§11.2):
 *
 *   start: resolve → validate/preflight → spawn(`starting`) →
 *          readiness probe → `running` (probe-ok) / `error` (timeout).
 *   stop:  graceful SIGTERM→SIGKILL (`stopping`→`stopped`); an `error`
 *          instance with a live child (hang) is terminated.
 *   restart: stop + start.
 *
 * The readiness probe runs in the background so `start` responds immediately
 * with `starting`; the state settles asynchronously.
 */
import {
  AppError,
  isLive,
  transition,
  type InferenceEngine,
  type InstanceInfo,
  type InstanceState,
  type InstanceView,
  type ModelInfo,
  type RuntimeInfo,
} from '@ai-dashboard/shared';
import type { LogLine } from '../logs/ringbuffer.js';
import type { LogWriter } from '../logs/writer.js';
import type { ConfigStore } from '../config/store.js';
import { type HealthProber, type ProbeSource, type RuntimeHandle } from '../health/prober.js';
import { InstanceResolver, resolveInstanceId, type ResolvedInstance } from './resolve.js';
import type { ProcessManager } from './manager.js';
import type { PidRegistry } from './registry.js';
import { reconcileAll as reconcileAllFn, resolveInstance as resolveInstanceFn, isPidAlive } from './reconcile.js';
import { writeAutoLog } from '../logs/store.js';
import { readFileSync } from 'node:fs';
import si from 'systeminformation';

export interface LifecycleDeps {
  store: ConfigStore;
  engines: InferenceEngine[];
  manager: ProcessManager;
  registry: PidRegistry;
  prober: HealthProber;
  /** Disk log writer (for the startup-error tail, §5.3). Optional. */
  logs?: LogWriter;
}

/** Startup-error diagnostic (PLAN §5.3): how the instance failed. */
export interface StartupDiagnostic {
  instanceId: string;
  state: InstanceState;
  exitCode: number | null;
  signal: string | null;
  /** The last log lines (tail) for this start. */
  logTail: string[];
  /** Log tail lines classified as `error` by the engine (the error patterns). */
  errorLines: string[];
}

/**
 * Full instance DTO (Faza 6.3, PLAN §14.2): identity + FSM state + the
 * resolved config (with per-value provenance) + runtime + last error.
 */
export interface InstanceDto {
  instanceId: string;
  modelId: string;
  preset: string;
  state: InstanceState;
  pid: number | null;
  port: number;
  /** OpenAI-compatible endpoint base (`http://<host>:<port>/v1/`). */
  endpoint: string;
  startedAt: string | null;
  uptimeSec: number | null;
  /** Which config layer supplied each param (§14.2 "pełne DTO"). */
  configSource: Record<string, string>;
  /** Engine runtime info (null when the instance is not live). */
  runtime: RuntimeInfo | null;
  /** Process metrics (Faza 8). */
  process: { cpuPct: number | null; rssMB: number | null };
  /** The last abnormal exit (null when none since start). */
  lastError: { exitCode: number | null; signal: string | null } | null;
}

export class LifecycleManager {
  private readonly deps: LifecycleDeps;
  private readonly resolver: InstanceResolver;
  /** Live runtime-probe loops, keyed by instanceId (stopped on stop/restart). */
  private readonly runtimes = new Map<string, RuntimeHandle>();
  /** Engine per instance (cached at spawn) for log-pattern classification. */
  private readonly enginesByInstance = new Map<string, InferenceEngine>();

  constructor(deps: LifecycleDeps) {
    this.deps = deps;
    this.resolver = new InstanceResolver({
      store: deps.store,
      engines: deps.engines,
      takenPorts: () => deps.registry.takenPorts(),
      registry: deps.registry,
    });
  }

  // -------------------------------------------------------------- read side

  /** All known instances (every model, preset pair) with their current state. */
  listInstances(): InstanceInfo[] {
    return this.resolver.listIds().map((id) => this.summarize(id));
  }

  /** Current FSM state, or `unknown` when the instance is not known/tracked. */
  getState(instanceId: string): InstanceState {
    return this.deps.manager.getState(instanceId) ?? 'unknown';
  }

  /**
   * Startup-error diagnostic (PLAN §5.3): the FSM state plus how the instance
   * failed — the exit code/signal, the log tail, and the log lines the engine
   * classifies as errors (the error patterns).
   */
  diagnose(instanceId: string): StartupDiagnostic {
    const entry = this.deps.registry.get(instanceId);
    const engine = this.enginesByInstance.get(instanceId);
    // Prefer the persistent disk tail (survives the in-memory ring being
    // dropped on exit); fall back to the live ring.
    const diskTail = this.deps.logs ? this.deps.logs.readTail(instanceId, 100) : [];
    const ring = this.deps.manager.getLogs(instanceId, 100);
    const logTail = diskTail.length > 0 ? diskTail : ring.map((l: LogLine) => l.line);
    const errorLines = engine
      ? logTail.filter((line) => engine.classifyLog(line).level === 'error')
      : [];
    return {
      instanceId,
      state: this.getState(instanceId),
      exitCode: entry?.lastExitCode ?? null,
      signal: entry?.lastSignal ?? null,
      logTail,
      errorLines,
    };
  }

  private summarize(instanceId: string): InstanceInfo {
    const entry = this.deps.registry.get(instanceId);
    const { modelId, presetName } = resolveInstanceId(instanceId);
    return {
      instanceId,
      modelId,
      preset: presetName,
      state: this.getState(instanceId),
      port: entry?.port ?? null,
      pid: entry?.pid ?? null,
      startedAt: entry?.startedAt ?? null,
    };
  }

  /**
   * Full instance DTO (Faza 6.3, PLAN §14.2): identity + FSM state + the
   * resolved config (with per-value provenance) + the engine's runtime info +
   * the last error. `process` metrics (CPU/RSS) are Faza 8 (null for now).
   */
  async getFullDto(instanceId: string): Promise<InstanceDto> {
    const inst = await this.resolver.resolve(instanceId);
    const entry = this.deps.registry.get(instanceId);
    let state = this.getState(instanceId);
    // Check if the process is actually alive (prevents stale 'running' state)
    if ((state === 'running' || state === 'starting') && entry?.pid) {
      const alive = isPidAlive(entry.pid);
      if (!alive) {
        state = 'error';
        this.deps.manager.setInstanceState(instanceId, 'error');
      }
    }
    // configSource: which layer supplied each param (§14.2 "pełne DTO").
    const configSource: Record<string, string> = {};
    for (const [key, resolved] of Object.entries(inst.resolved)) {
      configSource[key] = resolved.source;
    }
    // Runtime info (slots/tokensPerSec/gpu) — best-effort (null when not live).
    const runtime = state === 'running' || state === 'starting'
      ? await inst.engine.fetchRuntimeInfo(inst.base)
      : null;
    const startedAt = entry?.startedAt ?? null;
    const uptimeSec = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : null;
    return {
      instanceId,
      modelId: inst.modelId,
      preset: inst.presetName,
      state,
      pid: entry?.pid ?? null,
      port: inst.port,
      endpoint: `${inst.base}/v1/`,
      startedAt,
      uptimeSec,
      configSource,
      runtime,
      process: await this.getProcessMetrics(instanceId),
      lastError: entry && (entry.lastExitCode !== null || entry.lastSignal)
        ? { exitCode: entry.lastExitCode, signal: entry.lastSignal ?? null }
        : null,
    };
  }

  /** Runtime metrics for the UI (Faza 6.3, §14.1 `metrics` endpoint). */
  async getMetrics(instanceId: string): Promise<Record<string, unknown>> {
    const inst = await this.resolver.resolve(instanceId);
    const state = this.getState(instanceId);
    const runtime = state === 'running' || state === 'starting'
      ? await inst.engine.fetchRuntimeInfo(inst.base)
      : null;
    return { instanceId, state, runtime, process: await this.getProcessMetrics(instanceId) };
  }

  /** Gets CPU% and RSS for the instance's process. */
  private async getProcessMetrics(instanceId: string): Promise<{ cpuPct: number | null; rssMB: number | null }> {
    const state = this.getState(instanceId);
    if (state !== 'running') {
      return { cpuPct: null, rssMB: null };
    }

    const entry = this.deps.manager.getActiveEntry(instanceId);
    if (!entry) {
      return { cpuPct: null, rssMB: null };
    }

    try {
      const pid = entry.child.pid;

      // Use systeminformation for CPU% and RSS
      const allProcs = await si.processes();
      const proc = allProcs.find((p: Record<string, unknown>) => p.pid === pid);
      if (proc) {
        return {
          cpuPct: proc.cpu,
          rssMB: Math.round(proc.mem / 1024 / 1024),
        };
      }

      // Fallback to /proc if not found
      const procMem = readFileSync(`/proc/${pid}/status`, 'utf8');
      const rssMatch = procMem.match(/VmRSS:\s+(\d+)\s+kB/);
      const rssKB = rssMatch ? parseInt(rssMatch[1], 10) : 0;
      const rssMB = rssKB / 1024;
      return { cpuPct: 0, rssMB: Math.round(rssMB) };
    } catch (err) {
      console.error('Failed to get process metrics:', err);
      return { cpuPct: null, rssMB: null };
    }
  }

  /** Recent log lines (in-memory ring), most recent last (Faza 6.3). */
  getLogs(instanceId: string, limit?: number): LogLine[] {
    return this.deps.manager.getLogs(instanceId, limit);
  }

  // -------------------------------------------------------------- commands

  /**
   * Starts an instance. Validates (engine.validate + preflight) first, then
   * spawns (state → `starting`) and returns immediately; the readiness probe
   * settles the instance to `running` or `error` in the background.
   * @throws AppError when the instance is already live, or validation/preflight fails.
   */
  async start(instanceId: string): Promise<InstanceState> {
    const current = this.getState(instanceId);
    if (isLive(current)) {
      throw new AppError('INVALID_STATE', `instance is already ${current}`, { instanceId }, 409);
    }

    const inst = await this.resolver.resolve(instanceId);
    await this.runChecks(inst);
    this.enginesByInstance.set(instanceId, inst.engine);

    // Spawn (state → starting). The readiness probe runs in the background.
    await this.deps.manager.spawn(instanceId, inst.launch, inst.port);
    void this.driveStartup(instanceId, inst);
    return this.getState(instanceId);
  }

  /**
   * Stops an instance: graceful stop for a live instance; an `error` instance
   * with a live child (a hang) is terminated on the spot. Resolves once the
   * process has fully exited (state → `stopped`).
   */
  async stop(instanceId: string): Promise<void> {
    this.stopRuntime(instanceId);
    // Capture logs BEFORE stopping (cleanup deletes the active entry)
    const logs = this.deps.manager.getLogs(instanceId);
    const current = this.getState(instanceId);
    if (isLive(current)) {
      await this.deps.manager.stop(instanceId);
    } else if (current === 'error') {
      if (this.deps.manager.isTracked(instanceId)) {
        await this.deps.manager.terminate(instanceId, 'stopped');
      } else {
        // Child already gone (startup timeout) — settle the registry.
        this.deps.manager.setInstanceState(instanceId, 'stopped');
      }
    }
    // Auto-save logs when stopping
    this.autoSaveLogs(instanceId, logs);
  }

  /** Saves the instance's logs to disk (auto-log, keeps last 3). */
  private autoSaveLogs(instanceId: string, logs: any[]): void {
    try {
      if (logs.length === 0) return;
      const modelId = instanceId.split('--')[0];
      const content = logs.map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`).join('\n');
      writeAutoLog(modelId, content);
    } catch {
      // Best-effort — don't fail the stop on log errors
    }
  }

  /** Restarts an instance (stop + start). */
  async restart(instanceId: string): Promise<InstanceState> {
    await this.stop(instanceId);
    return this.start(instanceId);
  }

  /** Stops all live runtime loops (dashboard shutdown). */
  shutdown(): void {
    for (const handle of this.runtimes.values()) handle.stop();
    this.runtimes.clear();
  }

  /**
   * Resolves an instance's state (Faza 10.1, `POST /instances/:id/resolve`):
   * re-checks the PID — if alive → `running` (adopt); if dead → `crashed`.
   * Returns the resolved state.
   */
  resolve(instanceId: string): InstanceState {
    const newState = resolveInstanceFn(this.deps.registry, instanceId);
    this.deps.manager.setInstanceState(instanceId, newState);
    return newState;
  }

  /**
   * Reconciles all registry entries at startup (PLAN §11.3, Faza 10.1).
   * Returns the list of instanceIds that were changed.
   */
  reconcileAll(): string[] {
    return reconcileAllFn(this.deps.registry);
  }

  // -------------------------------------------------------------- internal

  private probeSourceFor(inst: ResolvedInstance): ProbeSource {
    const view: InstanceView = {
      id: inst.instanceId,
      modelId: inst.modelId,
      presetName: inst.presetName,
      port: inst.port,
    };
    return {
      isReady: (base) => inst.engine.isReady(view, base),
      runtime: (base) => inst.engine.fetchRuntimeInfo(base),
    };
  }

  /** Engine-specific validation + preflight; blocking failures throw. */
  private async runChecks(inst: ResolvedInstance): Promise<void> {
    const model = this.deps.store.readModel(inst.modelId);
    if (!model) {
      throw new AppError('MODEL_NOT_FOUND', `model not found: ${inst.modelId}`, { instanceId: inst.instanceId }, 404);
    }
    const modelInfo: ModelInfo = {
      id: inst.modelId,
      path: typeof model.params?.model === 'string' ? model.params.model : '',
      engineId: inst.engine.id,
    };
    const errors = inst.engine.validate(modelInfo, inst.resolved);
    if (errors.length > 0) {
      throw new AppError('VALIDATION_FAILED', errors.join('; '), { instanceId: inst.instanceId, errors }, 400);
    }
    if (inst.engine.preflight) {
      const ctx = {
        binary: inst.launch.binary,
        modelPath: modelInfo.path,
        params: inst.params,
        cwd: inst.launch.cwd,
        env: inst.launch.env,
      };
      const pre = await inst.engine.preflight(ctx);
      if (!pre.ok) {
        throw new AppError(
          'PREFLIGHT_FAILED',
          pre.errors.map((e) => e.message).join('; '),
          { instanceId: inst.instanceId, errors: pre.errors },
          400,
        );
      }
    }
  }

  /**
   * Background: waits for readiness, then settles the instance.
   *   probe-ok  → `starting`→`running` + start the runtime loop (hang → `error`).
   *   timeout   → `starting`→`error` + terminate the stuck child.
   */
  private async driveStartup(instanceId: string, inst: ResolvedInstance): Promise<void> {
    const source = this.probeSourceFor(inst);
    const outcome = await this.deps.prober.waitReady(source, inst.base);
    const current = this.deps.manager.getState(instanceId);
    if (outcome.ok) {
      if (current === 'starting') {
        this.deps.manager.setInstanceState(instanceId, transition(current, 'probe-ok'));
        this.runtimes.set(
          instanceId,
          this.deps.prober.startRuntime(source, inst.base, {
            onHang: () => {
              const s = this.deps.manager.getState(instanceId);
              if (s === 'running') this.deps.manager.setInstanceState(instanceId, transition(s, 'hang'));
              this.stopRuntime(instanceId);
            },
          }),
        );
      }
    } else if (current === 'starting') {
      await this.deps.manager.terminate(instanceId, transition(current, 'timeout'));
    }
  }

  private stopRuntime(instanceId: string): void {
    this.runtimes.get(instanceId)?.stop();
    this.runtimes.delete(instanceId);
  }
}
