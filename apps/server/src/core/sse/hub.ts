/**
 * SSE hub (Faza 6.2, PLAN §14.1) — a tiny in-process pub/sub that bridges the
 * process manager to the streaming endpoints:
 * - `stream/:id/logs`  → per-instance log lines (live stdout/stderr, TT-3);
 * - `stream/events`    → global state-change events (the instance FSM).
 *
 * The process manager publishes (via its `onStateChange` / `onLogLine` hooks);
 * the SSE route handlers subscribe. Subscriptions are scoped: a log listener
 * is bound to one instance, an event listener to the global channel. Both
 * return an unsubscribe function (the route handler calls it on disconnect).
 */
import type { InstanceState } from "@ai-dashboard/shared";
import type { LogLine } from "../logs/ringbuffer.js";

/** A global FSM event (the `stream/events` payload). */
export interface StateEvent {
  instanceId: string;
  state: InstanceState;
  ts: string;
}

type LogListener = (line: LogLine) => void;
type EventListener = (event: StateEvent) => void;

export class SseHub {
  private readonly logListeners = new Map<string, Set<LogListener>>();
  private readonly eventListeners = new Set<EventListener>();

  /** Subscribe to an instance's live log lines. Returns an unsubscribe fn. */
  subscribeLog(instanceId: string, cb: LogListener): () => void {
    let set = this.logListeners.get(instanceId);
    if (!set) {
      set = new Set();
      this.logListeners.set(instanceId, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.logListeners.delete(instanceId);
    };
  }

  /** Subscribe to global state-change events. Returns an unsubscribe fn. */
  subscribeEvents(cb: EventListener): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  /** Publish a log line for an instance (from the process manager). */
  publishLog(instanceId: string, line: LogLine): void {
    this.logListeners.get(instanceId)?.forEach((cb) => cb(line));
  }

  /** Publish a global state-change event (from the process manager). */
  publishState(instanceId: string, state: InstanceState): void {
    const event: StateEvent = {
      instanceId,
      state,
      ts: new Date().toISOString(),
    };
    this.eventListeners.forEach((cb) => cb(event));
  }

  /** Drop all listeners (used by tests). */
  clear(): void {
    this.logListeners.clear();
    this.eventListeners.clear();
  }
}
