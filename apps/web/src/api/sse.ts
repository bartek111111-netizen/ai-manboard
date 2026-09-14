/**
 * SSE client (Faza 7, ADR-3): live log lines + FSM state-change events.
 * `EventSource` auto-reconnects. For SSE, the bearer token is passed as
 * `?token=` (S-7, the browser EventSource cannot set headers).
 */
import type { InstanceState } from '@ai-dashboard/shared';

/** One log line (mirrors the server's `LogLine`). */
export interface LogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  line: string;
}

/** A state-change event (mirrors the server's `StateEvent`). */
export interface StateEvent {
  instanceId: string;
  state: InstanceState;
  ts: string;
}

/** The optional bearer token (S-2); `null`/empty = auth off. */
export function setAuthToken(token: string | null): void {
  authToken = token ? token : null;
}

let authToken: string | null = null;

function tokenQuery(): string {
  return authToken ? `?token=${encodeURIComponent(authToken)}` : '';
}

/**
 * Subscribe to live log lines for an instance. Returns a cleanup function.
 * The handler is also used to replay the recent ring on connect.
 */
export function openLogStream(instanceId: string, onLine: (line: LogLine) => void): () => void {
  const url = `/api/v1/stream/${encodeURIComponent(instanceId)}/logs${tokenQuery()}`;
  const source = new EventSource(url);
  const handler = (event: MessageEvent): void => {
    try {
      const line = JSON.parse(event.data) as LogLine;
      onLine(line);
    } catch {
      // malformed frame — ignore
    }
  };
  source.addEventListener('log', handler as EventListener);
  return () => {
    source.removeEventListener('log', handler as EventListener);
    source.close();
  };
}

/**
 * Subscribe to global FSM state-change events. Returns a cleanup function.
 */
export function openEventStream(onState: (event: StateEvent) => void): () => void {
  const url = `/api/v1/stream/events${tokenQuery()}`;
  const source = new EventSource(url);
  const handler = (event: MessageEvent): void => {
    try {
      const stateEvent = JSON.parse(event.data) as StateEvent;
      onState(stateEvent);
    } catch {
      // malformed frame — ignore
    }
  };
  source.addEventListener('state', handler as EventListener);
  return () => {
    source.removeEventListener('state', handler as EventListener);
    source.close();
  };
}
