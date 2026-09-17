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
  /**
   * Per-instance previous sample of the cumulative /metrics token counter.
   * Derives a LIVE tok/s (delta over the poll interval) so the panel tracks the
   * CURRENT generation speed during a long task, not a lifetime average that
   * lags behind a new task. Cleared on stop.
   */
  private readonly lastCounters = new Map<string, { tokens: number; ts: number }>();
  /** Per-instance previous CPU jiffies (for a LIVE cpu% from /proc deltas). */
  private readonly lastJiffies = new Map<string, { jiffies: number; ts: number }>();

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
    const startedAt = entry?.startedAt ?? null;
    const uptimeSec = startedAt
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : null;
    // Runtime / process / GPU / prefill (shared with the /metrics endpoint;
    // the generation tok/s is a LIVE rate over the poll interval).
    const m = await this.collectRuntimeMetrics(
      instanceId,
      state,
      inst.engine,
      inst.base,
    );
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
      runtime: m.runtime,
      process: m.process,
      gpu: m.gpu,
      ttft: m.ttft,
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
    // Runtime / process / GPU / prefill (shared with `getFullDto`).
    const m = await this.collectRuntimeMetrics(
      instanceId,
      state,
      inst.engine,
      inst.base,
    );
    return {
      instanceId,
      state,
      runtime: m.runtime,
      process: m.process,
      gpu: m.gpu,
      ttft: m.ttft,
    };
  }

  /**
   * Shared metrics collection behind `getFullDto` and the `/metrics` endpoint:
   * the engine runtime info (the generation tok/s as a LIVE rate over the poll
   * interval — see `applyLiveRate`), the per-process CPU/RSS (from /proc),
   * the system GPU and the last prefill (TTFT) from the log. Best-effort —
   * null when the instance is not live.
   */
  private async collectRuntimeMetrics(
    instanceId: string,
    state: InstanceState,
    engine: InferenceEngine,
    base: string,
  ): Promise<{
    runtime: RuntimeInfo | null;
    process: { cpuPct: number | null; rssMB: number | null };
    gpu: GpuInfo | null;
    ttft: { tokens: number; seconds: number; tps: number } | null;
  }> {
    const isLive = state === "running" || state === "starting";
    const rawRuntime = isLive ? await engine.fetchRuntimeInfo(base) : null;
    const system = this.getSystemMetrics(instanceId, state);
    return {
      runtime: this.applyLiveRate(instanceId, rawRuntime),
      process: this.readProcessMetrics(instanceId),
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

  /**
   * Per-process CPU%/RSS read directly from /proc (the project is Linux-only,
   * PLAN §27) — no full process-table scan. CPU% is a LIVE rate over the poll
   * interval (delta of the process's cumulative CPU jiffies), so the first poll
   * after a start reports null for CPU%.
   */
  private readProcessMetrics(instanceId: string): {
    cpuPct: number | null;
    rssMB: number | null;
  } {
    if (this.getState(instanceId) !== "running") {
      return { cpuPct: null, rssMB: null };
    }
    const pid = this.deps.manager.getActiveEntry(instanceId)?.child?.pid;
    if (!pid) return { cpuPct: null, rssMB: null };

    // RSS (KB) from /proc/<pid>/status.
    let rssMB: number | null = null;
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
      if (match) rssMB = Math.round(parseInt(match[1], 10) / 1024);
    } catch {
      // RSS unavailable — leave null
    }

    // CPU% from the delta of cumulative jiffies (/proc/<pid>/stat).
    let cpuPct: number | null = null;
    const jiffies = readProcCpuJiffies(pid);
    if (jiffies !== null) {
      const now = Date.now();
      const prev = this.lastJiffies.get(instanceId);
      if (prev) {
        const dtSec = (now - prev.ts) / 1000;
        if (dtSec > 0) {
          const cpuSec = (jiffies - prev.jiffies) / 100; // 100 Hz kernel tick
          cpuPct = Math.max(0, (cpuSec / dtSec) * 100);
        }
      }
      this.lastJiffies.set(instanceId, { jiffies, ts: Date.now() });
    }
    return { cpuPct, rssMB };
  }

  /**
   * Derives the LIVE generation tok/s: the delta of the cumulative
   * `tokens_predicted_total` counter over the poll interval. While a slot is
   * generating, this is the CURRENT speed (not a lifetime average, which lags
   * during a long task). When idle (no tokens in the window) or on the first
   * poll (no previous sample) it falls back to the cumulative average, so the
   * panel never reads a misleading 0.
   */
  private applyLiveRate(
    instanceId: string,
    runtime: RuntimeInfo | null,
  ): RuntimeInfo | null {
    if (!runtime) return runtime;
    const counters = (runtime.extras.counters ?? null) as
      | { tokensPredictedTotal?: number }
      | null;
    const total = counters?.tokensPredictedTotal;
    if (typeof total !== "number" || !Number.isFinite(total)) {
      return runtime; // no usable counter — keep the cumulative value as-is
    }
    const now = Date.now();
    const prev = this.lastCounters.get(instanceId);
    let live: number | undefined = runtime.tokensPerSec;
    if (prev) {
      const dtSec = (now - prev.ts) / 1000;
      if (dtSec > 0) {
        const rate = (total - prev.tokens) / dtSec;
        live = rate > 0 ? rate : (runtime.tokensPerSec ?? 0); // idle → keep the avg
      }
    }
    this.lastCounters.set(instanceId, { tokens: total, ts: now });
    runtime.extras.tokensPerSecAvg = runtime.tokensPerSec ?? null; // keep the avg
    runtime.tokensPerSec = live;
    return runtime;
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
    // Drop the per-instance metric samplers so a restart starts fresh.
    this.lastCounters.delete(instanceId);
    this.lastJiffies.delete(instanceId);
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
    this.lastCounters.clear();
    this.lastJiffies.clear();
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

/**
 * Reads the process's cumulative CPU jiffies (utime+stime) from
 * /proc/<pid>/stat. Returns null when the file can't be read (process gone).
 * The (comm) field may contain spaces, so the fields are split after the LAST
 * ')': after it, field 14 (utime) is token index 11 and field 15 (stime) is
 * token index 12.
 */
function readProcCpuJiffies(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 1).trim().split(/\s+/);
    const utime = Number(fields[11]); // field 14
    const stime = Number(fields[12]); // field 15
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return utime + stime;
  } catch {
    return null;
  }
}
