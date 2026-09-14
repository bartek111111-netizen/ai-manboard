import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureHome, resolveHome } from '../config/paths.js';
import { PidRegistry } from './registry.js';

/** A throwaway `~/.ai-dashboard` under /tmp. */
function tempRegistry(): { registry: PidRegistry; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ai-dashboard-registry-'));
  const home = resolveHome(root);
  ensureHome(home);
  return { registry: new PidRegistry(home), root };
}

const ENTRY = (instanceId: string): {
  instanceId: string;
  pid: number | null;
  port: number;
  state: 'stopped' | 'running' | 'starting';
  startedAt: string;
  lastExitCode: number | null;
} => ({
  instanceId,
  pid: 42424,
  port: 8081,
  state: 'running',
  startedAt: new Date(2026, 6, 9, 17, 45).toISOString(),
  lastExitCode: null,
});

describe('PidRegistry (PLAN §11.3, FP-7)', () => {
  it('starts empty (no registry file)', () => {
    const { registry } = tempRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.get('x--y')).toBeNull();
  });

  it('persists an entry atomically (set → get across instances)', () => {
    const { registry } = tempRegistry();
    registry.set('m--szybka', ENTRY('m--szybka'));
    // A fresh registry over the same home reads the persisted entry.
    const again = new PidRegistry(registry.home);
    expect(again.get('m--szybka')?.state).toBe('running');
    expect(again.get('m--szybka')?.pid).toBe(42424);
  });

  it('update() patches fields while preserving the rest', () => {
    const { registry } = tempRegistry();
    registry.set('m--szybka', ENTRY('m--szybka'));
    registry.update('m--szybka', { state: 'stopped', pid: null, lastExitCode: 0 });
    const entry = registry.get('m--szybka');
    expect(entry?.state).toBe('stopped');
    expect(entry?.pid).toBeNull();
    expect(entry?.lastExitCode).toBe(0);
    expect(entry?.port).toBe(8081); // preserved
  });

  it('remove() drops the entry; takenPorts reflects live instances', () => {
    const { registry } = tempRegistry();
    registry.set('a--x', { ...ENTRY('a--x'), port: 8081, state: 'running' });
    registry.set('b--y', { ...ENTRY('b--y'), port: 8082, state: 'stopped', pid: null });
    expect(registry.takenPorts()).toEqual([8081]); // only the live one
    registry.remove('a--x');
    expect(registry.has('a--x')).toBe(false);
  });

  it('rejects an unsafe instanceId (no path traversal)', () => {
    const { registry } = tempRegistry();
    expect(() => registry.set('../evil', ENTRY('x'))).toThrow();
  });
});
