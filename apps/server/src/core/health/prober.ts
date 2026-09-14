/**
 * Health prober (PLAN §10.2/10.3, §11.2, Faza 5.1) — the continuous monitor.
 *
 * - **readiness (start)**: poll the backend until it answers (HTTP 200) or the
 *   startup budget (`startupTimeoutSec`) is exhausted — drives `starting` →
 *   `running` (probe-ok) / `error` (timeout).
 * - **runtime (continuous)**: poll on every tick; `runtimeFailThreshold`
 *   consecutive failures = a hang (`running` → `error`).
 *
 * Pure orchestration over an engine's probe primitives. The concrete
 * `isReady`/`runtime` source is injected (a `ProbeSource`), so this module has
 * no engine or Node-specific dependency and is unit-testable with a dummy.
 */
import type { RuntimeInfo } from '@ai-dashboard/shared';

/** A backend that can answer readiness + runtime probes. */
export interface ProbeSource {
  /** Readiness (FP-5): `true` when the backend responds (HTTP 200). */
  isReady(base: string): Promise<boolean>;
  /** Runtime (FMK-6): unified runtime data, `null` when unreachable. */
  runtime(base: string): Promise<RuntimeInfo | null>;
}

export interface ProberOptions {
  /** Startup readiness poll interval (ms). Default 2000 (§5.3). */
  startupIntervalMs?: number;
  /** Startup budget (ms). Default 120_000 (`startupTimeoutSec` = 120 s). */
  startupTimeoutMs?: number;
  /** Runtime poll interval (ms). Default 5000 (`probeIntervalSec` = 5 s). */
  runtimeIntervalMs?: number;
  /** Consecutive runtime failures before a hang is declared. Default 3 (§11.2). */
  runtimeFailThreshold?: number;
}

/** Result of the startup readiness probe. */
export interface StartupOutcome {
  ok: boolean;
  /** `'timeout'` when the budget was exhausted without a ready response. */
  reason?: 'timeout';
  /** Number of probes issued. */
  attempts: number;
  /** Wall-clock milliseconds spent. */
  elapsedMs: number;
}

/** A running runtime-probe loop (stop it to free timers). */
export interface RuntimeHandle {
  /** Stops the loop (idempotent; a pending tick does not reschedule). */
  stop(): void;
}

export interface RuntimeHooks {
  /** Fires after `runtimeFailThreshold` consecutive failures (hang). */
  onHang: () => void;
  /** Optional: fired on every tick with the latest readiness + runtime data. */
  onTick?: (ready: boolean, runtime: RuntimeInfo | null) => void;
}

/** Defaults mirror `global.monitoring` (probeIntervalSec=5, startupTimeoutSec=120). */
export const PROBER_DEFAULTS = {
  startupIntervalMs: 2000,
  startupTimeoutMs: 120_000,
  runtimeIntervalMs: 5000,
  runtimeFailThreshold: 3,
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HealthProber {
  private readonly opts: Required<ProberOptions>;

  constructor(options?: ProberOptions) {
    this.opts = {
      startupIntervalMs: options?.startupIntervalMs ?? PROBER_DEFAULTS.startupIntervalMs,
      startupTimeoutMs: options?.startupTimeoutMs ?? PROBER_DEFAULTS.startupTimeoutMs,
      runtimeIntervalMs: options?.runtimeIntervalMs ?? PROBER_DEFAULTS.runtimeIntervalMs,
      runtimeFailThreshold: options?.runtimeFailThreshold ?? PROBER_DEFAULTS.runtimeFailThreshold,
    };
  }

  get options(): Readonly<Required<ProberOptions>> {
    return this.opts;
  }

  /**
   * Polls readiness until the backend answers (`ok: true`) or the startup
   * budget is exhausted (`ok: false`, `reason: 'timeout'`). Probes every
   * `startupIntervalMs`, capping the final sleep to the remaining budget.
   */
  async waitReady(source: ProbeSource, base: string): Promise<StartupOutcome> {
    const startedAt = Date.now();
    const deadline = startedAt + this.opts.startupTimeoutMs;
    let attempts = 0;
    for (;;) {
      attempts += 1;
      const ready = await source.isReady(base);
      const now = Date.now();
      if (ready) return { ok: true, attempts, elapsedMs: now - startedAt };
      if (now >= deadline) return { ok: false, reason: 'timeout', attempts, elapsedMs: now - startedAt };
      await sleep(Math.min(this.opts.startupIntervalMs, Math.max(0, deadline - now)));
    }
  }

  /**
   * Starts the continuous runtime probe loop. Polls every `runtimeIntervalMs`;
   * a ready response resets the failure counter; `runtimeFailThreshold`
   * consecutive failures fire `onHang` and stop the loop. Returns a handle used
   * to stop the loop (e.g. on instance stop / dashboard shutdown).
   */
  startRuntime(source: ProbeSource, base: string, hooks: RuntimeHooks): RuntimeHandle {
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };

    const loop = async (): Promise<void> => {
      if (stopped) return;
      const ready = await source.isReady(base);
      let runtime: RuntimeInfo | null = null;
      if (ready) runtime = await source.runtime(base);
      hooks.onTick?.(ready, runtime);
      if (stopped) return;
      if (!ready) {
        failures += 1;
        if (failures >= this.opts.runtimeFailThreshold) {
          hooks.onHang();
          stop();
          return;
        }
      } else {
        failures = 0;
      }
      if (stopped) return;
      timer = setTimeout(() => {
        void loop();
      }, this.opts.runtimeIntervalMs);
    };

    // First tick is delayed by one interval (a fresh start is already probed).
    timer = setTimeout(() => {
      void loop();
    }, this.opts.runtimeIntervalMs);

    return { stop };
  }
}
