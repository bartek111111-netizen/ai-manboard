import { describe, expect, it } from 'vitest';
import type { LogLine } from '../logs/ringbuffer.js';
import { SseHub } from './hub.js';

const line: LogLine = { ts: '2025-01-01T00:00:00.000Z', level: 'info', source: 'stdout', line: 'hello' };

describe('SseHub (Faza 6.2)', () => {
  it('subscribes to per-instance log lines (and unsubscribes)', () => {
    const hub = new SseHub();
    const got: LogLine[] = [];
    const unsub = hub.subscribeLog('a', (l) => got.push(l));
    hub.publishLog('a', line);
    hub.publishLog('b', line); // different instance → ignored
    expect(got).toEqual([line]);
    unsub();
    hub.publishLog('a', line);
    expect(got).toHaveLength(1); // unsubscribed
  });

  it('subscribes to global state events (and unsubscribes)', () => {
    const hub = new SseHub();
    const got: string[] = [];
    const unsub = hub.subscribeEvents((e) => got.push(e.state));
    hub.publishState('a', 'running');
    hub.publishState('b', 'error');
    expect(got).toEqual(['running', 'error']);
    unsub();
    hub.publishState('a', 'stopped');
    expect(got).toHaveLength(2); // unsubscribed
  });
});
