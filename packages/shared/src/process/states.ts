/**
 * Instance state machine (PLAN §11.2, FP-6) — Faza 4.
 *
 * Pure FSM, shared by the process manager (server) and the StatusBadge /
 * SSE event stream (web), so state names, the transition table and UI labels
 * all live here. Node-only logic (spawn/kill, registry, ports) lives in the
 * server under `core/process/`.
 *
 * States:
 *   starting  — proces spawnowany, czekamy na readiness
 *   running   — backend odpowiada (HTTP 200)
 *   stopping  — żądanie stopa: SIGTERM → timeout → SIGKILL
 *   stopped   — czyste zakończenie
 *   error     — backend żywy, ale nie odpowiada (3× probe fail / timeout startu)
 *   crashed   — proces zginął (exit ≠ 0 / sygnał) z running/starting
 *   unknown   — po starcie dashboardu brak dowodów (reconcile, §11.3, Faza 10)
 */
import { AppError } from '../api/errors.js';

export type InstanceState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'crashed'
  | 'unknown';

/** Events that drive the FSM (emitted by the manager, probes and the watchdog). */
export type InstanceEvent =
  /** `start` requested (or restart). */
  | 'start'
  /** Readiness probe OK (HTTP 200). */
  | 'probe-ok'
  /** Startup budget exhausted (`startupTimeoutSec`). */
  | 'timeout'
  /** The spawn itself failed (binary missing / bad args). */
  | 'spawn-failed'
  /** `stop` requested from a live state. */
  | 'stop'
  /** Grace stop completed (SIGTERM handled, clean exit). */
  | 'stop-complete'
  /** Grace timeout, SIGKILL sent. */
  | 'stop-timeout'
  /** Child exited cleanly (code 0, no signal). */
  | 'exit-clean'
  /** Child exited abnormally (code ≠ 0 or signal). */
  | 'exit-abnormal'
  /** 3× consecutive runtime probe fail while the process is alive (hang). */
  | 'hang';

export const INSTANCE_STATES: readonly InstanceState[] = [
  'starting',
  'running',
  'stopping',
  'stopped',
  'error',
  'crashed',
  'unknown',
];

/**
 * The transition table (PLAN §11.2). Each legal (state, event) pair maps to
 * exactly one next state; any pair not listed is INVALID_STATE.
 */
export const TRANSITIONS: Record<InstanceState, Partial<Record<InstanceEvent, InstanceState>>> =
  {
    stopped: { start: 'starting' },
    error: { start: 'starting', stop: 'stopped' },
    crashed: { start: 'starting' },
    // `unknown` is resolved by reconcile (Faza 10): adopt→running, else stop.
    unknown: { start: 'starting', stop: 'stopped' },
    starting: {
      'probe-ok': 'running',
      timeout: 'error',
      'spawn-failed': 'error',
      'exit-abnormal': 'crashed',
      'exit-clean': 'stopped',
      // Interrupt a stuck/in-progress startup.
      stop: 'stopping',
    },
    running: {
      stop: 'stopping',
      hang: 'error',
      'exit-abnormal': 'crashed',
      'exit-clean': 'stopped',
    },
    stopping: {
      'stop-complete': 'stopped',
      'stop-timeout': 'stopped',
      'exit-clean': 'stopped',
      'exit-abnormal': 'stopped',
    },
  };

/** Next state for (state, event); throws AppError('INVALID_STATE') when illegal. */
export function transition(state: InstanceState, event: InstanceEvent): InstanceState {
  const next = TRANSITIONS[state]?.[event];
  if (next === undefined) {
    throw new AppError('INVALID_STATE', `invalid state transition: ${state} + ${event}`);
  }
  return next;
}

/** True when (state, event) is a legal transition. */
export function canTransition(state: InstanceState, event: InstanceEvent): boolean {
  return TRANSITIONS[state]?.[event] !== undefined;
}

/** States where no live child process exists. */
export const STABLE_STATES: readonly InstanceState[] = ['stopped', 'error', 'crashed'];

/** True when the instance currently holds a live process. */
export function isLive(state: InstanceState): boolean {
  return state === 'starting' || state === 'running' || state === 'stopping';
}

/** Polish labels for the UI (StatusBadge, PLAN §20). */
export const STATE_LABELS: Record<InstanceState, string> = {
  starting: 'startuje',
  running: 'uruchomiony',
  stopping: 'zatrzymywanie',
  stopped: 'zatrzymany',
  error: 'błąd',
  crashed: 'kraksza',
  unknown: 'nieznany',
};

/** Color tokens for StatusBadge (defined in tokens.css, Faza 7). */
export const STATE_COLORS: Record<InstanceState, string> = {
  starting: 'var(--state-starting)',
  running: 'var(--state-running)',
  stopping: 'var(--state-stopping)',
  stopped: 'var(--state-stopped)',
  error: 'var(--state-error)',
  crashed: 'var(--state-crashed)',
  unknown: 'var(--state-unknown)',
};
