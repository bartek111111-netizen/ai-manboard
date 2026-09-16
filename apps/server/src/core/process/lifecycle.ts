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
  fetchLlamaServerRuntimeInfo,
  type InferenceEngine,
  type InstanceInfo,
  type InstanceState,
  type InstanceView,
  type LaunchMode,
  type ModelInfo,
  type RuntimeInfo,
} from "@ai-dashboard/shared";
import type { LogLine } from "../logs/ringbuffer.js";
import type { LogWriter } from "../logs/writer.js";
import type { ConfigStore } from "../config/store.js";
import {
  type HealthProber,
  type ProbeSource,
  type RuntimeHandle,
} from "../health/prober.js";
import {
  InstanceResolver,
  resolveInstanceId,
  type ResolvedInstance,
} from "./resolve.js";
import type { ProcessManager } from "./manager.js";
import type { PidRegistry } from "./registry.js";
import {
  reconcileAll as reconcileAllFn,
  resolveInstance as resolveInstanceFn,
  isPidAlive,
} from "./reconcile.js";
import { writeAutoLog } from "../logs/store.js";
import { readGpuInfo, type GpuInfo } from "../../gpu.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import si from "systeminformation";
import {
  scanEngineProcesses,
  readRssMB,
  readUptimeSec,
  type ExternalInstanceView,
  type ExternalProcessInfo,
} from "./external.js";

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
  /** The exact launch command (binary + args), for the UI's ⓘ popover. */
  command: string;
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
  /** System GPU info (null when no GPU is detected). */
  gpu?: GpuInfo | null;
  /** Last request's prefill timing from the log (TTFT approximation). */
  ttft?: { tokens: number; seconds: number; tps: number } | null;
  /** The last abnormal exit (null when none since start). */
  lastError: { exitCode: number | null; signal: string | null } | null;
  /**
   * The launch choice ("Zostaje w tle" = background, "Znika z dashboardem" =
   * session). Null when the entry predates the choice.
   */
  mode: LaunchMode | null;
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
    return this.deps.manager.getState(instanceId) ?? "unknown";
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
    const diskTail = this.deps.logs
      ? this.deps.logs.readTail(instanceId, 100)
      : [];
    const ring = this.deps.manager.getLogs(instanceId, 100);
    const logTail =
      diskTail.length > 0 ? diskTail : ring.map((l: LogLine) => l.line);
    const errorLines = engine
      ? logTail.filter((line) => engine.classifyLog(line).level === "error")
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
      mode: entry?.mode ?? null,
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
    if ((state === "running" || state === "starting") && entry?.pid) {
      const alive = isPidAlive(entry.pid);
      if (!alive) {
        state = "error";
        this.deps.manager.setInstanceState(instanceId, "error");
      }
    }
    // configSource: which layer supplied each param (§14.2 "pełne DTO").
    const configSource: Record<string, string> = {};
    for (const [key, resolved] of Object.entries(inst.resolved)) {
      configSource[key] = resolved.source;
    }
    // Runtime info (slots/tokensPerSec/gpu) — best-effort (null when not live).
    const runtime =
      state === "running" || state === "starting"
        ? await inst.engine.fetchRuntimeInfo(inst.base)
        : null;
    const startedAt = entry?.startedAt ?? null;
    const uptimeSec = startedAt
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : null;
    const system = this.getSystemMetrics(instanceId, state);
    return {
      instanceId,
      modelId: inst.modelId,
      preset: inst.presetName,
      state,
      pid: entry?.pid ?? null,
      port: inst.port,
      command: [inst.launch.binary, ...inst.launch.args].join(" "),
      endpoint: `${inst.base}/v1/`,
      startedAt,
      uptimeSec,
      configSource,
      runtime,
      process: await this.getProcessMetrics(instanceId),
      gpu: system.gpu,
      ttft: system.ttft,
      lastError:
        entry && (entry.lastExitCode !== null || entry.lastSignal)
          ? { exitCode: entry.lastExitCode, signal: entry.lastSignal ?? null }
          : null,
      mode: entry?.mode ?? null,
    };
  }

  /** Runtime metrics for the UI (Faza 6.3, §14.1 `metrics` endpoint). */
  async getMetrics(instanceId: string): Promise<Record<string, unknown>> {
    const inst = await this.resolver.resolve(instanceId);
    const state = this.getState(instanceId);
    const runtime =
      state === "running" || state === "starting"
        ? await inst.engine.fetchRuntimeInfo(inst.base)
        : null;
    const system = this.getSystemMetrics(instanceId, state);
    return {
      instanceId,
      state,
      runtime,
      process: await this.getProcessMetrics(instanceId),
      gpu: system.gpu,
      ttft: system.ttft,
    };
  }

  /**
   * System-level metrics for an instance: the GPU (system-wide, read from
   * sysfs / `nvidia-smi`) and the last request's prefill timing (TTFT) from
   * the instance's log. Best-effort — null when unavailable.
   */
  private getSystemMetrics(
    instanceId: string,
    state: InstanceState,
  ): {
    gpu: GpuInfo | null;
    ttft: { tokens: number; seconds: number; tps: number } | null;
  } {
    const gpu = readGpuInfo();
    const ttft =
      (state === "running" || state === "starting") && this.deps.logs
        ? this.deps.logs.readLastPromptProcessing(instanceId)
        : null;
    return { gpu, ttft };
  }

  /** Gets CPU% and RSS for the instance's process. */
  private async getProcessMetrics(
    instanceId: string,
  ): Promise<{ cpuPct: number | null; rssMB: number | null }> {
    const state = this.getState(instanceId);
    if (state !== "running") {
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
      const proc = allProcs.list.find((p) => p.pid === pid);
      if (proc) {
        // memRss is in KB
        return {
          cpuPct: proc.cpu ?? 0,
          rssMB: Math.round((proc.memRss ?? 0) / 1024),
        };
      }

      // Fallback to /proc if not found
      const procMem = readFileSync(`/proc/${pid}/status`, "utf8");
      const rssMatch = procMem.match(/VmRSS:\s+(\d+)\s+kB/);
      const rssKB = rssMatch ? parseInt(rssMatch[1], 10) : 0;
      const rssMB = rssKB / 1024;
      return { cpuPct: 0, rssMB: Math.round(rssMB) };
    } catch (err) {
      console.error("Failed to get process metrics:", err);
      return { cpuPct: null, rssMB: null };
    }
  }

  /** Recent log lines (in-memory ring), most recent last (Faza 6.3). */
  getLogs(instanceId: string, limit?: number): LogLine[] {
    return this.deps.manager.getLogs(instanceId, limit);
  }

  // ------------------------------------------------------ external detection

  /**
   * Detects engine processes launched **outside** the dashboard (a script, a
   * terminal) and captures their settings — the full command line, port, model
   * path, memory and start time (PLAN §16.4). The dashboard's own PIDs are
   * excluded; what remains were started from elsewhere. Each is enriched with
   * the live server's `/v1/models` (model / context / quant), RSS, uptime and
   * the system GPU, and mapped to a registered instance when identifiable.
   */
  async detectExternalInstances(): Promise<ExternalInstanceView[]> {
    const global = this.deps.store.readGlobal();
    const binaryBases: string[] = [];
    for (const cfg of Object.values(global.engines)) {
      if (cfg?.binary) binaryBases.push(basename(cfg.binary));
    }
    if (binaryBases.length === 0) return [];

    // PIDs the dashboard manages — exclude them; the rest are external.
    const appPids = new Set<number>();
    for (const inst of this.listInstances())
      if (inst.pid) appPids.add(inst.pid);

    const external = scanEngineProcesses(binaryBases).filter(
      (p) => !appPids.has(p.pid),
    );
    return Promise.all(external.map((p) => this.enrichExternalInstance(p)));
  }

  /** Enriches one external process: live `/v1/models`, RSS, uptime, GPU + the app match. */
  private async enrichExternalInstance(
    p: ExternalProcessInfo,
  ): Promise<ExternalInstanceView> {
    const runtime = p.port
      ? await fetchLlamaServerRuntimeInfo(`http://${p.host}:${p.port}`)
      : null;
    const model = this.matchRegisteredModel(p.modelPath);
    const inst = model ? this.matchRegisteredInstance(model, p.port) : null;
    // The live server's `/v1/models` meta (works even without `--metrics`).
    const meta = ((
      runtime?.extras?.models as { data?: Array<Record<string, unknown>> }
    )?.data?.[0] ?? {}) as Record<string, unknown>;
    const metaObj = (meta.meta as Record<string, unknown>) ?? {};
    const contextSize =
      runtime?.contextSize ??
      (typeof metaObj.n_ctx === "number" ? metaObj.n_ctx : null);
    const quantization =
      (typeof metaObj.ftype === "string" ? metaObj.ftype : null) ??
      (runtime?.extras?.modelQuant as string | undefined) ??
      null;
    return {
      detected: "external",
      pid: p.pid,
      cmdline: p.cmdline,
      params: p.args,
      modelPath: p.modelPath,
      port: p.port,
      host: p.host,
      rssMB: readRssMB(p.pid),
      uptimeSec: readUptimeSec(p.pid),
      modelName:
        (p.modelPath ? basename(p.modelPath) : null) ??
        runtime?.modelLoaded ??
        null,
      contextSize,
      quantization,
      gpu: readGpuInfo(),
      instanceId: inst?.instanceId ?? null,
      modelId: model ?? null,
      preset: inst?.preset ?? null,
    };
  }

  /** Matches a model file path to a registered model id (exact or suffix). */
  private matchRegisteredModel(path: string | null): string | null {
    if (!path) return null;
    for (const id of this.deps.store.listModelIds()) {
      const registered = this.deps.store.readModel(id)?.params?.model;
      if (
        typeof registered === "string" &&
        (path === registered ||
          path.endsWith(registered) ||
          registered.endsWith(path))
      ) {
        return id;
      }
    }
    return null;
  }

  /** The registered instance for (modelId, port): exact port first, else any for the model. */
  private matchRegisteredInstance(
    modelId: string,
    port: number | null,
  ): InstanceInfo | null {
    const forModel = this.listInstances().filter((i) => i.modelId === modelId);
    if (port) {
      const byPort = forModel.find((i) => i.port === port);
      if (byPort) return byPort;
    }
    return forModel[0] ?? null;
  }

  // -------------------------------------------------------------- commands

  /**
   * Starts an instance. Validates (engine.validate + preflight) first, then
   * spawns (state → `starting`) and returns immediately; the readiness probe
   * settles the instance to `running` or `error` in the background.
   * `mode` is the launch choice: `background` ("Zostaje w tle") survives a
   * dashboard restart; `session` ("Znika z dashboardem") stops with it.
   * @throws AppError when the instance is already live, or validation/preflight fails.
   */
  async start(
    instanceId: string,
    mode: LaunchMode = "background",
  ): Promise<InstanceState> {
    const current = this.getState(instanceId);
    if (isLive(current)) {
      throw new AppError(
        "INVALID_STATE",
        `instance is already ${current}`,
        { instanceId },
        409,
      );
    }

    const inst = await this.resolver.resolve(instanceId);
    await this.runChecks(inst);
    this.enginesByInstance.set(instanceId, inst.engine);

    // Spawn (state → starting). The readiness probe runs in the background.
    await this.deps.manager.spawn(instanceId, inst.launch, inst.port, mode);
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
    } else if (current === "error") {
      if (this.deps.manager.isTracked(instanceId)) {
        await this.deps.manager.terminate(instanceId, "stopped");
      } else {
        // Child already gone (startup timeout) — settle the registry.
        this.deps.manager.setInstanceState(instanceId, "stopped");
      }
    }
    // Auto-save logs when stopping
    this.autoSaveLogs(instanceId, logs);
  }

  /** Saves the instance's logs to disk (auto-log, keeps last 3). */
  private autoSaveLogs(instanceId: string, logs: LogLine[]): void {
    try {
      if (logs.length === 0) return;
      const modelId = instanceId.split("--")[0];
      const content = logs
        .map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`)
        .join("\n");
      writeAutoLog(modelId, content);
    } catch {
      // Best-effort — don't fail the stop on log errors
    }
  }

  /** Restarts an instance (stop + start). */
  async restart(
    instanceId: string,
    mode: LaunchMode = "background",
  ): Promise<InstanceState> {
    await this.stop(instanceId);
    return this.start(instanceId, mode);
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
      throw new AppError(
        "MODEL_NOT_FOUND",
        `model not found: ${inst.modelId}`,
        { instanceId: inst.instanceId },
        404,
      );
    }
    const modelInfo: ModelInfo = {
      id: inst.modelId,
      path: typeof model.params?.model === "string" ? model.params.model : "",
      engineId: inst.engine.id,
    };
    const errors = inst.engine.validate(modelInfo, inst.resolved);
    if (errors.length > 0) {
      throw new AppError(
        "VALIDATION_FAILED",
        errors.join("; "),
        { instanceId: inst.instanceId, errors },
        400,
      );
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
          "PREFLIGHT_FAILED",
          pre.errors.map((e) => e.message).join("; "),
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
  private async driveStartup(
    instanceId: string,
    inst: ResolvedInstance,
  ): Promise<void> {
    const source = this.probeSourceFor(inst);
    const outcome = await this.deps.prober.waitReady(source, inst.base);
    const current = this.deps.manager.getState(instanceId);
    if (outcome.ok) {
      if (current === "starting") {
        this.deps.manager.setInstanceState(
          instanceId,
          transition(current, "probe-ok"),
        );
        this.runtimes.set(
          instanceId,
          this.deps.prober.startRuntime(source, inst.base, {
            onHang: () => {
              const s = this.deps.manager.getState(instanceId);
              if (s === "running")
                this.deps.manager.setInstanceState(
                  instanceId,
                  transition(s, "hang"),
                );
              this.stopRuntime(instanceId);
            },
          }),
        );
      }
    } else if (current === "starting") {
      await this.deps.manager.terminate(
        instanceId,
        transition(current, "timeout"),
      );
    }
  }

  private stopRuntime(instanceId: string): void {
    this.runtimes.get(instanceId)?.stop();
    this.runtimes.delete(instanceId);
  }
}
