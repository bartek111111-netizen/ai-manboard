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
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  transition,
  type InstanceState,
  type LaunchCommand,
} from '@ai-dashboard/shared';
import { PidRegistry } from './registry.js';
import { RingBuffer, type LogLine, type LogSource } from '../logs/ringbuffer.js';
import { LogWriter } from '../logs/writer.js';

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
}

interface ActiveInstance {
  child: ChildProcess;
  ring: RingBuffer<LogLine>;
  /** Disk log file for this start ('' when no writer). */
  logFile: string;
  state: InstanceState;
  /** True once `stop()` has begun signaling the child. */
  stopping: boolean;
  /**
   * When set (by the lifecycle, e.g. a startup timeout → `error`), the exit
   * handler settles on this state instead of recomputing from the exit code
   * (which would yield `crashed` for a SIGKILL we sent on purpose).
   */
  forcedState?: InstanceState;
  /** Residual (not-yet-newline-terminated) output per stream. */
  partial: Record<'stdout' | 'stderr', string>;
  /** Resolves when the child exits. */
  exitPromise: Promise<{ code: number | null; signal: string | null }>;
  resolveExit: (value: { code: number | null; signal: string | null }) => void;
}

export class ProcessManager {
  private readonly active = new Map<string, ActiveInstance>();
  private readonly stopTimeoutMs: number;
  private readonly ringLines: number;

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

  /** The instance's in-memory log lines (live view), most recent last. */
  getLogs(instanceId: string, limit?: number): LogLine[] {
    return this.active.get(instanceId)?.ring.lines(limit) ?? [];
  }

  /**
   * Spawns the instance's child process and begins tracking it.
   * State: a stable state (stopped/error/crashed) → `starting`.
   * @returns the child PID (0 when the spawn could not assign one).
   */
  async spawn(instanceId: string, cmd: LaunchCommand, port: number): Promise<number> {
    if (this.active.has(instanceId)) {
      throw new AppError('INVALID_STATE', `instance already active (state: ${this.getState(instanceId)})`, {
        instanceId,
      });
    }

    const ring = new RingBuffer<LogLine>(this.ringLines);
    const logFile = this.opts.logs?.start(instanceId, this.stamp(instanceId)) ?? '';

    const child = spawn(cmd.binary, cmd.args, {
      cwd: cmd.cwd,
      env: { ...process.env, ...cmd.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resolveExit: ActiveInstance['resolveExit'] = () => {};
    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      resolveExit = resolve;
    });

    let settled = false;
    const active: ActiveInstance = {
      child,
      ring,
      logFile,
      state: 'starting',
      stopping: false,
      partial: { stdout: '', stderr: '' },
      exitPromise,
      resolveExit: () => {},
    };
    active.resolveExit = resolveExit;
    this.active.set(instanceId, active);

    // Spawn failure (binary missing / bad args): the child never starts.
    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      active.state = 'error';
      this.opts.registry.update(instanceId, { state: 'error', pid: null });
      this.opts.onStateChange?.(instanceId, 'error');
      this.cleanup(instanceId);
      active.resolveExit({ code: null, signal: null });
      void err;
    });

    child.stdout?.on('data', (chunk: Buffer) => this.onOutput(instanceId, 'stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.onOutput(instanceId, 'stderr', chunk));

    // Watchdog: the process ended — update FSM + registry + resolve waiters.
    child.on('exit', (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      const next = active.forcedState ?? this.finalState(active, code, signal);
      active.state = next;
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
      state: 'starting',
      startedAt: new Date().toISOString(),
      lastExitCode: null,
    });
    this.opts.onStateChange?.(instanceId, 'starting');

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
  async terminate(instanceId: string, finalState: InstanceState): Promise<void> {
    const active = this.active.get(instanceId);
    if (!active) return;
    active.forcedState = finalState;
    active.state = finalState;
    this.opts.registry.update(instanceId, { state: finalState });
    this.opts.onStateChange?.(instanceId, finalState);
    if (active.child.exitCode === null && !active.child.killed) {
      active.child.kill('SIGTERM');
    }
    await this.awaitExit(instanceId, this.stopTimeoutMs);
    if (active.child.exitCode === null) {
      active.child.kill('SIGKILL');
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
      // Not live (already exited / never spawned). Ensure the registry settles.
      const entry = this.opts.registry.get(instanceId);
      if (entry && (entry.state === 'starting' || entry.state === 'running' || entry.state === 'stopping')) {
        this.opts.registry.update(instanceId, { state: 'stopped', pid: null });
        this.opts.onStateChange?.(instanceId, 'stopped');
      }
      return;
    }

    if (active.stopping) {
      // Already stopping — wait for completion.
      await this.awaitExit(instanceId, this.stopTimeoutMs + 5000);
      return;
    }

    if (active.state !== 'running' && active.state !== 'starting') {
      // In a stable state with no live process to signal.
      return;
    }

    // Begin graceful stop (running/starting → stopping).
    active.stopping = true;
    active.state = 'stopping';
    this.opts.registry.update(instanceId, { state: 'stopping' });
    this.opts.onStateChange?.(instanceId, 'stopping');

    if (active.child.exitCode === null && !active.child.killed) {
      active.child.kill('SIGTERM');
    }

    const result = await this.awaitExit(instanceId, this.stopTimeoutMs);
    if (!result && active.child.exitCode === null) {
      // Still alive after the grace period → SIGKILL.
      active.child.kill('SIGKILL');
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
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  // ------------------------------------------------------------------ internal

  /** Decides the final state when the child exits. */
  private finalState(active: ActiveInstance, code: number | null, signal: string | null): InstanceState {
    if (active.stopping) return 'stopped'; // a stop we initiated always lands on `stopped`
    const clean = code === 0 && signal === null;
    const event = clean ? 'exit-clean' : 'exit-abnormal';
    try {
      return transition(active.state, event);
    } catch {
      return 'stopped';
    }
  }

  private onOutput(instanceId: string, source: 'stdout' | 'stderr', chunk: Buffer): void {
    const active = this.active.get(instanceId);
    if (!active) return;
    const text = active.partial[source] + chunk.toString('utf8');
    const lines = text.split('\n');
    active.partial[source] = lines.pop() ?? ''; // keep the unterminated tail
    for (const line of lines) {
      if (line !== '') this.pushLine(instanceId, source, line);
    }
  }

  /** Flushes any residual (unterminated) output at the end of the run. */
  private flushPartial(instanceId: string): void {
    const active = this.active.get(instanceId);
    if (!active) return;
    for (const source of ['stdout', 'stderr'] as const) {
      if (active.partial[source] !== '') {
        this.pushLine(instanceId, source, active.partial[source]);
        active.partial[source] = '';
      }
    }
  }

  private pushLine(instanceId: string, source: LogSource, line: string): void {
    const active = this.active.get(instanceId);
    if (!active) return;
    const logLine: LogLine = {
      ts: new Date().toISOString(),
      level: source === 'stderr' ? 'error' : 'info',
      source,
      line,
    };
    active.ring.push(logLine);
    if (active.logFile) this.opts.logs?.append(active.logFile, line);
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

  /** A sortable, collision-safe per-start log file name (epoch ms). */
  private stamp(instanceId: string): string {
    const dir = this.opts.logs?.instanceDir(instanceId);
    if (!dir) return String(Date.now());
    let name = String(Date.now());
    let n = 0;
    while (existsSync(join(dir, `${name}.log`))) {
      n += 1;
      name = `${Date.now()}-${n}`;
    }
    return name;
  }
}
