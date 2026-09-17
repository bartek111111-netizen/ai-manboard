/**
 * Process manager (PLAN §11.5, §11.2, TT-9) — Faza 4.
 *
 * Owns the child process for an instance:
 * - `spawn` — launches the launch command with its own stdio (pipes), so the
 *   backend's output never leaks into the dashboard's console (TT-9), records
 *   the PID in the registry (state → `starting`), and starts log capture.
 * - `stop` — graceful stop: SIGTERM → wait `stopTimeoutSec` → SIGKILL.
 * - watchdog — the child's `exit` event updates the registry + FSM automatically
 *   (event-driven, not polled), so a crash is reflected without a UI round-trip.
 *
 * The manager is engine-agnostic: it spawns any `LaunchCommand`, which is what
 * makes the Faza 4 acceptance test ("spawn/kill a dummy process") possible.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import {
  AppError,
  transition,
  type InstanceState,
  type LaunchCommand,
  type LaunchMode,
} from "@ai-dashboard/shared";
import { PidRegistry } from "./registry.js";
import { isPidAlive } from "./reconcile.js";
import {
  RingBuffer,
  type LogLine,
  type LogSource,
} from "../logs/ringbuffer.js";
import { LogWriter } from "../logs/writer.js";

export interface ProcessManagerOptions {
  registry: PidRegistry;
  /** Disk log writer (per-start files + retention). */
  logs?: LogWriter;
  /** In-memory ring buffer size (default 1000). */
  ringLines?: number;
  /** Grace period before SIGKILL (default 10 s). */
  stopTimeoutSec?: number;
  /** Optional hook on every state change (SSE events, Faza 6). */
  onStateChange?: (instanceId: string, state: InstanceState) => void;
  /** Optional hook on every captured log line (SSE live logs, Faza 6). */
  onLogLine?: (instanceId: string, line: LogLine) => void;
}

interface ActiveInstance {
  child: ChildProcess;
  /** Disk log file for this start ('' when no writer). */
  logFile: string;
  state: InstanceState;
  /** The launch choice (background = survives the dashboard, session = tied to it). */
  mode: LaunchMode;
  /** True once `stop()` has begun signaling the child. */
  stopping: boolean;
  /**
   * When set (by the lifecycle, e.g. a startup timeout → `error`), the exit
   * handler settles on this state instead of recomputing from the exit code
   * (which would yield `crashed` for a SIGKILL we sent on purpose).
   */
  forcedState?: InstanceState;
  /** Residual (not-yet-newline-terminated) output per stream. */
  partial: Record<"stdout" | "stderr", string>;
  /** Resolves when the child exits. */
  exitPromise: Promise<{ code: number | null; signal: string | null }>;
  resolveExit: (value: { code: number | null; signal: string | null }) => void;
}

export class ProcessManager {
  private readonly active = new Map<string, ActiveInstance>();
  private readonly stopTimeoutMs: number;
  private readonly ringLines: number;
  /**
   * The instance's ring buffer (live log lines), keyed by instanceId. Kept
   * OUTSIDE `active` so it also exists for adopted instances (a background
   * engine that survived a dashboard restart — see `adoptLogTails`): the SSE
   * replay reads the ring, not the child process.
   */
  private readonly rings = new Map<string, RingBuffer<LogLine>>();
  /**
   * File-tail pollers (background-mode instances read their log file back):
   * one record per tailed file — timer, the file being read, and the byte
   * offset already consumed.
   */
  private readonly tails = new Map<
    string,
    { timer: NodeJS.Timeout; logFile: string; offset: number }
  >();

  constructor(private readonly opts: ProcessManagerOptions) {
    this.stopTimeoutMs = (opts.stopTimeoutSec ?? 10) * 1000;
    this.ringLines = opts.ringLines ?? 1000;
  }

  /**
   * Current state: in-memory when the instance is live, otherwise the registry
   * value (so a freshly-started dashboard still reports the persisted state).
   */
  getState(instanceId: string): InstanceState | undefined {
    const live = this.active.get(instanceId)?.state;
    if (live) return live;
    return this.opts.registry.get(instanceId)?.state;
  }

  /** Gets the active instance entry (for process metrics). */
  getActiveEntry(instanceId: string): ActiveInstance | null {
    return this.active.get(instanceId) ?? null;
  }

  /** The instance's in-memory log lines (live view), most recent last. */
  getLogs(instanceId: string, limit?: number): LogLine[] {
    return this.rings.get(instanceId)?.lines(limit) ?? [];
  }

  /**
   * Re-attaches live-log capture to instances that are live but NOT owned by
   * this manager process — a dashboard restart while a `background`
   * ("Zostaje w tle") engine keeps running: reconcile settles the registry
   * state back to `running`, but the in-memory ring + tail poller are gone
   * (they live in the previous process). This tails the latest per-start log
   * file — the engine still writes it — so the Logi tab (ring replay on SSE
   * connect + live lines) works again WITHOUT restarting the engine.
   *
   * Returns the attached instanceIds.
   */
  adoptLogTails(registry: PidRegistry): string[] {
    const attached: string[] = [];
    for (const entry of registry.list()) {
      if (this.active.has(entry.instanceId)) continue; // spawn manages it itself
      if (entry.state !== "running" && entry.state !== "starting") continue;
      if (!entry.pid || !isPidAlive(entry.pid)) continue;
      const file = this.opts.logs?.latestFile(entry.instanceId);
      if (!file) continue;
      this.startTail(entry.instanceId, file);
      attached.push(entry.instanceId);
    }
    return attached;
  }

  /**
   * Spawns the instance's child process and begins tracking it.
   * State: a stable state (stopped/error/crashed) → `starting`.
   *
   * `mode` is the launch choice:
   * - `background` ("Zostaje w tle"): the engine's stdout/stderr are the log
   *   FILE and it runs detached (own process group). Both let the engine
   *   SURVIVE a dashboard restart — a closed dashboard can't SIGPIPE it, and
   *   Ctrl-C / exit on the dashboard's group can't signal it. The dashboard
   *   reads the log file back for the live log view (file-tail poller).
   * - `session` ("Znika z dashboardem"): legacy behaviour — the engine's
   *   output is on the dashboard's pipes and it shares the dashboard's process
   *   group, so it stops together with the dashboard.
   * @returns the child PID (0 when the spawn could not assign one).
   */
  async spawn(
    instanceId: string,
    cmd: LaunchCommand,
    port: number,
    mode: LaunchMode = "background",
  ): Promise<number> {
    if (this.active.has(instanceId)) {
      throw new AppError(
        "INVALID_STATE",
        `instance already active (state: ${this.getState(instanceId)})`,
        {
          instanceId,
        },
      );
    }

    this.rings.set(instanceId, new RingBuffer<LogLine>(this.ringLines));
    const logFile =
      this.opts.logs?.start(instanceId, this.stamp()) ?? "";

    // `background`: open the log file and point the child's stdout/stderr at it
    // (so the engine writes to disk, not to our pipes). `session`: plain pipes.
    let logFd: number | undefined;
    if (mode === "background" && logFile) {
      logFd = openSync(logFile, "a");
    }
    const child = spawn(cmd.binary, cmd.args, {
      cwd: cmd.cwd,
      env: { ...process.env, ...cmd.env },
      detached: mode === "background",
      stdio:
        logFd !== undefined
          ? ["ignore", logFd, logFd]
          : ["pipe", "pipe", "pipe"],
    });
    // Hand the fd to the child; close our copy (the child holds it).
    if (logFd !== undefined) {
      try {
        closeSync(logFd);
      } catch {
        /* already closed */
      }
    }

    let resolveExit: ActiveInstance["resolveExit"] = () => {};
    const exitPromise = new Promise<{
      code: number | null;
      signal: string | null;
    }>((resolve) => {
      resolveExit = resolve;
    });

    let settled = false;
    const active: ActiveInstance = {
      child,
      logFile,
      state: "starting",
      mode,
      stopping: false,
      partial: { stdout: "", stderr: "" },
      exitPromise,
      resolveExit: () => {},
    };
    active.resolveExit = resolveExit;
    this.active.set(instanceId, active);

    // Spawn failure (binary missing / bad args): the child never starts.
    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      active.state = "error";
      this.stopTail(instanceId);
      this.opts.registry.update(instanceId, { state: "error", pid: null });
      this.opts.onStateChange?.(instanceId, "error");
      this.cleanup(instanceId);
      active.resolveExit({ code: null, signal: null });
      void err;
    });

    // `session` mode captures the pipes live. `background` mode: `child.stdout`
    // /`stderr` are the log file (not pipes) so these are no-ops; the file-tail
    // below reads the lines back instead.
    child.stdout?.on("data", (chunk: Buffer) =>
      this.onOutput(instanceId, "stdout", chunk),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      this.onOutput(instanceId, "stderr", chunk),
    );
    if (mode === "background" && logFile) this.startTail(instanceId, logFile);

    // Watchdog: the process ended — update FSM + registry + resolve waiters.
    child.on("exit", (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      const next = active.forcedState ?? this.finalState(active, code, signal);
      active.state = next;
      this.stopTail(instanceId);
      this.opts.registry.update(instanceId, {
        state: next,
        pid: null,
        lastExitCode: code ?? null,
        lastSignal: signal ?? undefined,
      });
      this.opts.onStateChange?.(instanceId, next);
      this.flushPartial(instanceId);
      this.cleanup(instanceId);
      active.resolveExit({ code, signal });
    });

    this.opts.registry.set(instanceId, {
      instanceId,
      pid: child.pid ?? 0,
      port,
      state: "starting",
      mode,
      startedAt: new Date().toISOString(),
      lastExitCode: null,
    });
    this.opts.onStateChange?.(instanceId, "starting");

    return child.pid ?? 0;
  }

  /**
   * Sets the instance's state directly (lifecycle-driven FSM moves the manager
   * does not know: `probe-ok` → `running`, `hang` → `error`). The caller has
   * validated the transition against the FSM. No-op for an unknown instance.
   */
  setInstanceState(instanceId: string, state: InstanceState): void {
    const active = this.active.get(instanceId);
    if (active) active.state = state;
    this.opts.registry.update(instanceId, { state });
    this.opts.onStateChange?.(instanceId, state);
  }

  /** True while the instance has a live child in this manager's process. */
  isTracked(instanceId: string): boolean {
    return this.active.has(instanceId);
  }

  /**
   * Settles a live child on a forced state (startup timeout → `error`, or
   * stopping an `error`/hang instance → `stopped`): kills the child (SIGTERM →
   * grace → SIGKILL) and pins the exit watchdog to `finalState` so the
   * deliberate SIGKILL is not read as a crash. No-op when not tracked.
   */
  async terminate(
    instanceId: string,
    finalState: InstanceState,
  ): Promise<void> {
    const active = this.active.get(instanceId);
    if (!active) {
      // Adopted instance (no child here): still signal the live registry pid
      // so a stop can't orphan the engine.
      const entry = this.opts.registry.get(instanceId);
      if (entry && entry.pid && isPidAlive(entry.pid)) {
        await this.signalPid(entry.pid, entry.mode ?? "session");
      }
      this.opts.registry.update(instanceId, { state: finalState, pid: null });
      this.opts.onStateChange?.(instanceId, finalState);
      return;
    }
    active.forcedState = finalState;
    active.state = finalState;
    this.opts.registry.update(instanceId, { state: finalState });
    this.opts.onStateChange?.(instanceId, finalState);
    if (active.child.exitCode === null && !active.child.killed) {
      active.child.kill("SIGTERM");
    }
    await this.awaitExit(instanceId, this.stopTimeoutMs);
    if (active.child.exitCode === null) {
      active.child.kill("SIGKILL");
      await this.awaitExit(instanceId, 5000);
    }
  }

  /**
   * Gracefully stops the instance: SIGTERM → wait `stopTimeoutSec` → SIGKILL.
   * Resolves once the process has fully exited (state → `stopped`).
   */
  async stop(instanceId: string): Promise<void> {
    const active = this.active.get(instanceId);
    if (!active) {
      // Not spawned by THIS process. An *adopted* instance (a `background`
      // engine that survived a dashboard restart) still has a LIVE PID in the
      // registry but no child object here — signal THAT pid directly, else the
      // process is ORPHANED: the "stop" only clears our bookkeeping while the
      // engine keeps running (and later resurfaces as an external instance).
      const entry = this.opts.registry.get(instanceId);
      if (
        entry &&
        (entry.state === "starting" ||
          entry.state === "running" ||
          entry.state === "stopping")
      ) {
        if (entry.pid && isPidAlive(entry.pid)) {
          await this.signalPid(entry.pid, entry.mode ?? "session");
        }
        this.opts.registry.update(instanceId, { state: "stopped", pid: null });
        this.opts.onStateChange?.(instanceId, "stopped");
      }
      return;
    }

    if (active.stopping) {
      // Already stopping — wait for completion.
      await this.awaitExit(instanceId, this.stopTimeoutMs + 5000);
      return;
    }

    if (active.state !== "running" && active.state !== "starting") {
      // In a stable state with no live process to signal.
      return;
    }

    // Begin graceful stop (running/starting → stopping).
    active.stopping = true;
    active.state = "stopping";
    this.opts.registry.update(instanceId, { state: "stopping" });
    this.opts.onStateChange?.(instanceId, "stopping");

    if (active.child.exitCode === null && !active.child.killed) {
      active.child.kill("SIGTERM");
    }

    const result = await this.awaitExit(instanceId, this.stopTimeoutMs);
    if (!result && active.child.exitCode === null) {
      // Still alive after the grace period → SIGKILL.
      active.child.kill("SIGKILL");
      await this.awaitExit(instanceId, 5000);
    }
    // The final `stopped` state is recorded by the exit watchdog.
  }

  /**
   * Waits up to `timeoutMs` for the child to exit. Resolves with the exit info
   * when it exits, or `null` on timeout. Returns `null` immediately when the
   * instance is no longer tracked (already exited).
   */
  async awaitExit(
    instanceId: string,
    timeoutMs: number,
  ): Promise<{ code: number | null; signal: string | null } | null> {
    const active = this.active.get(instanceId);
    if (!active) return null;
    if (timeoutMs <= 0) return null;
    return await Promise.race([
      active.exitPromise,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
  }

  /**
   * Signals a PID we don't hold a ChildProcess for — an *adopted* instance
   * (a `background` engine that survived a dashboard restart): SIGTERM → wait
   * the grace period → SIGKILL. `background` engines run detached in their own
   * process group (pid = pgid), so signal the whole group (`-pid`) to reach the
   * engine and any of its children.
   */
  private async signalPid(pid: number, mode: LaunchMode): Promise<void> {
    const target = mode === "background" ? -pid : pid;
    const send = (sig: NodeJS.Signals): void => {
      try {
        process.kill(target, sig);
      } catch {
        // Already gone.
      }
    };
    send("SIGTERM");
    const deadline = Date.now() + this.stopTimeoutMs;
    while (Date.now() < deadline && isPidAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (isPidAlive(pid)) {
      send("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // ------------------------------------------------------------------ internal

  /** Decides the final state when the child exits. */
  private finalState(
    active: ActiveInstance,
    code: number | null,
    signal: string | null,
  ): InstanceState {
    if (active.stopping) return "stopped"; // a stop we initiated always lands on `stopped`
    const clean = code === 0 && signal === null;
    const event = clean ? "exit-clean" : "exit-abnormal";
    try {
      return transition(active.state, event);
    } catch {
      return "stopped";
    }
  }

  private onOutput(
    instanceId: string,
    source: "stdout" | "stderr",
    chunk: Buffer,
  ): void {
    const active = this.active.get(instanceId);
    if (!active) return;
    const text = active.partial[source] + chunk.toString("utf8");
    const lines = text.split("\n");
    active.partial[source] = lines.pop() ?? ""; // keep the unterminated tail
    for (const line of lines) {
      if (line !== "") this.pushLine(instanceId, source, line);
    }
  }

  /** Flushes any residual (unterminated) output at the end of the run. */
  private flushPartial(instanceId: string): void {
    const active = this.active.get(instanceId);
    if (!active) return;
    for (const source of ["stdout", "stderr"] as const) {
      if (active.partial[source] !== "") {
        this.pushLine(instanceId, source, active.partial[source]);
        active.partial[source] = "";
      }
    }
  }

  private pushLine(instanceId: string, source: LogSource, line: string): void {
    const ring = this.rings.get(instanceId);
    if (!ring) return;
    const active = this.active.get(instanceId);
    const logLine: LogLine = {
      ts: new Date().toISOString(),
      level: this.classifyLevel(line),
      source,
      line,
    };
    ring.push(logLine);
    // `session` mode: the engine's output is on our pipes, so we write the disk
    // log here. `background` mode: the engine writes the file ITSELF (via its
    // own stdio, which is the file), so appending would duplicate the lines.
    if (active && active.mode === "session" && active.logFile)
      this.opts.logs?.append(active.logFile, line);
    this.opts.onLogLine?.(instanceId, logLine);
  }

  /** Classifies log level based on content. */
  private classifyLevel(line: string): "info" | "warn" | "error" {
    // Llama-server uses "E" prefix for errors, "W" for warnings
    const trimmed = line.trim();
    if (/^[Ee]rror|E\s/.test(trimmed)) return "error";
    if (/^[Ww]arn/.test(trimmed)) return "warn";
    // Some engines output "ERROR:" or "WARN:" prefixes
    if (trimmed.includes("ERROR") || trimmed.includes("FATAL")) return "error";
    if (trimmed.includes("WARN") || trimmed.includes("WARNING")) return "warn";
    return "info";
  }

  // ------------------------------------------------------------------ file-tail

  /**
   * Starts (or replaces) the file-tail poller for an instance's log file. The
   * engine writes the file directly (its stdio is the file), so the dashboard
   * reads new bytes back to feed the ring buffer + live log stream. Used by
   * `background`-mode spawns and by `adoptLogTails` after a dashboard
   * restart (offset 0, so the ring is seeded with the file's existing tail).
   */
  private startTail(instanceId: string, logFile: string): void {
    this.stopTail(instanceId); // replacing (e.g. a new start with a new file)
    if (!this.rings.has(instanceId)) {
      this.rings.set(instanceId, new RingBuffer<LogLine>(this.ringLines));
    }
    const timer = setInterval(() => this.tailRead(instanceId), 500);
    this.tails.set(instanceId, { timer, logFile, offset: 0 });
  }

  /** Stops the file-tail poller for an instance (exit / error / stop / dead). */
  private stopTail(instanceId: string): void {
    const tail = this.tails.get(instanceId);
    if (tail) {
      clearInterval(tail.timer);
      this.tails.delete(instanceId);
    }
  }

  /** Reads new, complete lines from the instance's log file and pushes them. */
  private tailRead(instanceId: string): void {
    const tail = this.tails.get(instanceId);
    if (!tail) return;
    // Adopted tails (no child owned by this process) end when the engine is
    // gone: dead PID or the registry no longer reports it live. Spawned
    // instances are handled by the exit handler instead (which stops the tail).
    if (!this.active.has(instanceId)) {
      const entry = this.opts.registry.get(instanceId);
      if (
        !entry ||
        entry.state === "stopped" ||
        entry.state === "crashed" ||
        entry.state === "error" ||
        (entry.pid !== null && !isPidAlive(entry.pid))
      ) {
        this.stopTail(instanceId);
        return;
      }
    }
    const logFile = tail.logFile;
    let size: number;
    try {
      size = statSync(logFile).size;
    } catch {
      return; // not ready yet
    }
    let offset = tail.offset;
    if (size < offset) offset = 0; // truncated — re-read from the start
    if (size === offset) return; // no new bytes
    let content: string;
    try {
      const fd = openSync(logFile, "r");
      try {
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        content = buf.toString("utf8");
      } finally {
        closeSync(fd);
      }
    } catch {
      return;
    }
    // Consume only complete lines (up to the last newline); leave any partial
    // tail for the next poll so we never push a half-written line.
    const lastNl = content.lastIndexOf("\n");
    const consumed = lastNl === -1 ? 0 : lastNl + 1;
    tail.offset = offset + consumed;
    const complete = lastNl === -1 ? "" : content.slice(0, lastNl);
    for (const line of complete.split("\n")) {
      if (line !== "") this.pushLine(instanceId, "stdout", line);
    }
  }

  private cleanup(instanceId: string): void {
    const active = this.active.get(instanceId);
    if (!active) return;
    // Release the stdio streams so they don't pin the event loop.
    for (const stream of [active.child.stdout, active.child.stderr]) {
      try {
        stream?.destroy();
      } catch {
        /* already closed */
      }
    }
    this.active.delete(instanceId);
  }

  /** Per-start base stamp (epoch ms). Collision safety lives in LogWriter.start. */
  private stamp(): string {
    return String(Date.now());
  }
}
