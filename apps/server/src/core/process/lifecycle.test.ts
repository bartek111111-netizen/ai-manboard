import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultGlobalConfig,
  type InferenceEngine,
  type ModelConfig,
  type Preset,
} from '@ai-dashboard/shared';
import { ensureHome, resolveHome } from '../config/paths.js';
import { ConfigStore } from '../config/store.js';
import { HealthProber } from '../health/prober.js';
import { LogWriter } from '../logs/writer.js';
import { ProcessManager } from './manager.js';
import { PidRegistry } from './registry.js';
import { LifecycleManager } from './lifecycle.js';

const MODEL_ID = 'smollm2-a1b2c3d4';
const INSTANCE = `${MODEL_ID}--fast`;

function tempHome(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ai-dashboard-${name}-`));
  process.env.AI_DASHBOARD_HOME = dir;
  return dir;
}
function clearHome(): void {
  delete process.env.AI_DASHBOARD_HOME;
}

/** A long-lived dummy process (`sleep 30`); readiness is driven by the test. */
function dummyEngine(ready: () => boolean): InferenceEngine {
  return {
    id: 'dummy',
    displayName: 'Dummy',
    description: 'test',
    filePatterns: ['*.gguf'],
    schema: [{ key: 'port', label: 'Port', type: 'int', default: 8080, group: 'server' }],
    detectCapabilities: () => [],
    // Emits a startup error line, then stays alive (so the readiness probe
    // can time out while the process is still up — the hang/timeout path).
    buildLaunch: async (ctx) => ({
      binary: 'sh',
      args: ['-c', 'echo "boot error: failed to load"; sleep 30'],
      cwd: ctx.cwd ?? process.cwd(),
      env: {},
    }),
    isReady: async () => ready(),
    fetchRuntimeInfo: async () => null,
    classifyLog: (line) => ({ level: line.includes('error') ? 'error' : 'info' }),
    validate: () => [],
  };
}

function seed(home: string, port?: number): ConfigStore {
  const dir = resolveHome(home);
  ensureHome(dir);
  const store = new ConfigStore(dir);
  const modelFile = join(home, 'model.gguf');
  writeFileSync(modelFile, 'gguf');
  const model: ModelConfig = { version: 1, engineId: 'dummy', tags: [], capabilities: {}, params: { model: modelFile } };
  store.writeModel(MODEL_ID, model);
  const preset: Preset = { version: 1, name: 'fast', port, params: {} };
  store.writePreset(MODEL_ID, 'fast', preset);
  const global = defaultGlobalConfig();
  global.engines = { dummy: { binary: 'sleep' } };
  store.writeGlobal(global);
  return store;
}

function stack(store: ConfigStore, home: string, ready = () => true, startupTimeoutMs = 4000): LifecycleManager {
  const registry = new PidRegistry(resolveHome(home));
  const logs = new LogWriter({ logsDir: `${home}/logs`, retentionFiles: 10, maxFileBytes: 10_000_000 });
  const manager = new ProcessManager({ registry, logs, ringLines: 50, stopTimeoutSec: 2 });
  const prober = new HealthProber({ startupIntervalMs: 25, startupTimeoutMs, runtimeIntervalMs: 25, runtimeFailThreshold: 3 });
  return new LifecycleManager({ store, engines: [dummyEngine(ready)], manager, registry, prober, logs });
}

describe('LifecycleManager', () => {
  afterEach(clearHome);

  it('start → running → stop', async () => {
    const home = tempHome('lc-run');
    const lifecycle = stack(seed(home, 8081), home);
    try {
      const s0 = await lifecycle.start(INSTANCE);
      expect(s0).toBe('starting');
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('running'));
      await lifecycle.stop(INSTANCE);
      expect(lifecycle.getState(INSTANCE)).toBe('stopped');
    } finally {
      lifecycle.shutdown();
    }
  });

  it('rejects a second start while the instance is live', async () => {
    const home = tempHome('lc-busy');
    const lifecycle = stack(seed(home, 8082), home);
    try {
      await lifecycle.start(INSTANCE);
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('running'));
      await expect(lifecycle.start(INSTANCE)).rejects.toThrowError(/already/);
    } finally {
      lifecycle.shutdown();
      await lifecycle.stop(INSTANCE);
    }
  });

  it('restarts a running instance and it comes back up', async () => {
    const home = tempHome('lc-restart');
    const lifecycle = stack(seed(home, 8083), home);
    try {
      await lifecycle.start(INSTANCE);
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('running'));
      await lifecycle.restart(INSTANCE);
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('running'));
    } finally {
      lifecycle.shutdown();
      await lifecycle.stop(INSTANCE);
    }
  });

  it('settles on `error` when readiness times out', async () => {
    const home = tempHome('lc-timeout');
    const lifecycle = stack(seed(home, 8084), home, () => false, 150);
    try {
      await lifecycle.start(INSTANCE);
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('error'), { timeout: 3000 });
      await lifecycle.stop(INSTANCE);
      expect(lifecycle.getState(INSTANCE)).toBe('stopped');
    } finally {
      lifecycle.shutdown();
    }
  });

  it('diagnose reports the startup failure (exit, tail, error patterns)', async () => {
    const home = tempHome('lc-diag');
    const lifecycle = stack(seed(home, 8085), home, () => false, 150);
    try {
      await lifecycle.start(INSTANCE);
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('error'), { timeout: 3000 });
      const diag = lifecycle.diagnose(INSTANCE);
      expect(diag.state).toBe('error');
      // The startup error line is captured in the tail and flagged as an error pattern.
      expect(diag.logTail.some((l) => l.includes('boot error'))).toBe(true);
      expect(diag.errorLines.some((l) => l.includes('boot error'))).toBe(true);
    } finally {
      lifecycle.shutdown();
      await lifecycle.stop(INSTANCE);
    }
  });

  it('lists known instances with their state', async () => {
    const home = tempHome('lc-list');
    const lifecycle = stack(seed(home), home);
    try {
      const list = lifecycle.listInstances();
      expect(list.some((i) => i.instanceId === INSTANCE)).toBe(true);
      // Never started → no evidence → `unknown`.
      expect(list.find((i) => i.instanceId === INSTANCE)?.state).toBe('unknown');
    } finally {
      lifecycle.shutdown();
    }
  });
});
