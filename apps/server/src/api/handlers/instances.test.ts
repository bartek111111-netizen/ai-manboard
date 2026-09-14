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
import { buildApp } from '../../app.js';
import { ensureHome, resolveHome } from '../../core/config/paths.js';
import { ConfigStore } from '../../core/config/store.js';
import { HealthProber } from '../../core/health/prober.js';
import { LogWriter } from '../../core/logs/writer.js';
import { ProcessManager } from '../../core/process/manager.js';
import { PidRegistry } from '../../core/process/registry.js';
import { LifecycleManager } from '../../core/process/lifecycle.js';

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

function dummyEngine(): InferenceEngine {
  return {
    id: 'dummy',
    displayName: 'Dummy',
    description: 'test',
    filePatterns: ['*.gguf'],
    schema: [{ key: 'port', label: 'Port', type: 'int', default: 8080, group: 'server' }],
    detectCapabilities: () => [],
    buildLaunch: async (ctx) => ({ binary: 'sleep', args: ['30'], cwd: ctx.cwd ?? process.cwd(), env: {} }),
    isReady: async () => true,
    fetchRuntimeInfo: async () => null,
    classifyLog: () => ({ level: 'info' }),
    validate: () => [],
  };
}

async function tempApp(port?: number) {
  const dir = resolveHome(tempHome('instances-api'));
  ensureHome(dir);
  const store = new ConfigStore(dir);
  const modelFile = join(dir.root, 'model.gguf');
  writeFileSync(modelFile, 'gguf');
  store.writeModel(MODEL_ID, { version: 1, engineId: 'dummy', tags: [], capabilities: {}, params: { model: modelFile } } as ModelConfig);
  store.writePreset(MODEL_ID, 'fast', { version: 1, name: 'fast', port, params: {} } as Preset);
  const global = defaultGlobalConfig();
  global.engines = { dummy: { binary: 'sleep' } };
  store.writeGlobal(global);

  const registry = new PidRegistry(dir);
  const logs = new LogWriter({ logsDir: `${dir.root}/logs`, retentionFiles: 10, maxFileBytes: 10_000_000 });
  const manager = new ProcessManager({ registry, logs, ringLines: 50, stopTimeoutSec: 2 });
  const prober = new HealthProber({ startupIntervalMs: 25, startupTimeoutMs: 4000, runtimeIntervalMs: 25, runtimeFailThreshold: 3 });
  const lifecycle = new LifecycleManager({ store, engines: [dummyEngine()], manager, registry, prober, logs });
  const app = await buildApp({ store, getConfigState: () => ({ home: dir.root, watchActive: true, lastExternalChangeAt: null, reloadCount: 0, lastReloadError: null }), lifecycle });
  return { app, lifecycle };
}

describe('instance endpoints (PLAN §14.1, Faza 5.4)', () => {
  afterEach(clearHome);

  it('GET /api/v1/instances lists known instances', async () => {
    const { app, lifecycle } = await tempApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/instances' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.instances.some((i: { instanceId: string }) => i.instanceId === INSTANCE)).toBe(true);
    } finally {
      lifecycle.shutdown();
      await app.close();
    }
  });

  it('full lifecycle over HTTP: start → running → stop → restart', async () => {
    const { app, lifecycle } = await tempApp(8086);
    try {
      const start = await app.inject({ method: 'POST', url: `/api/v1/instances/${INSTANCE}/start` });
      expect(start.statusCode).toBe(200);
      expect(start.json().state).toBe('starting');

      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('running'));

      const stop = await app.inject({ method: 'POST', url: `/api/v1/instances/${INSTANCE}/stop` });
      expect(stop.statusCode).toBe(200);
      expect(stop.json().state).toBe('stopped');

      const restart = await app.inject({ method: 'POST', url: `/api/v1/instances/${INSTANCE}/restart` });
      expect(restart.statusCode).toBe(200);
      expect(restart.json().state).toBe('starting');
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('running'));
    } finally {
      lifecycle.shutdown();
      await lifecycle.stop(INSTANCE);
      await app.close();
    }
  });

  it('POST start on an unknown instance → 404', async () => {
    const { app, lifecycle } = await tempApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/instances/unknown--preset/start' });
      expect(res.statusCode).toBe(404);
    } finally {
      lifecycle.shutdown();
      await app.close();
    }
  });

  it('POST start while running → 409', async () => {
    const { app, lifecycle } = await tempApp(8087);
    try {
      await app.inject({ method: 'POST', url: `/api/v1/instances/${INSTANCE}/start` });
      await vi.waitFor(() => expect(lifecycle.getState(INSTANCE)).toBe('running'));
      const res = await app.inject({ method: 'POST', url: `/api/v1/instances/${INSTANCE}/start` });
      expect(res.statusCode).toBe(409);
    } finally {
      lifecycle.shutdown();
      await lifecycle.stop(INSTANCE);
      await app.close();
    }
  });
});
