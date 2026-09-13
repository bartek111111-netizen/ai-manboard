import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfigWatchState } from '@ai-dashboard/shared';
import { buildApp } from '../../app.js';
import { ensureHome, resolveHome } from '../../core/config/paths.js';
import { ConfigStore } from '../../core/config/store.js';

async function tempApp() {
  const root = mkdtempSync(join(tmpdir(), 'ai-dashboard-api-'));
  const home = resolveHome(root);
  ensureHome(home);
  const store = new ConfigStore(home);
  const configState: ConfigWatchState = {
    home: home.root,
    watchActive: true,
    lastExternalChangeAt: null,
    reloadCount: 0,
    lastReloadError: null,
  };
  const app = await buildApp({ store, getConfigState: () => configState });
  return { app, store, configState, home };
}

describe('Config API (Faza 1.4: GET/PUT /api/v1/config)', () => {
  it('GET /api/v1/config returns all layers + effective + watch state', async () => {
    const { app, store, home } = await tempApp();
    const modelId = 'm1';
    store.writeModel(modelId, {
      version: 1,
      engineId: 'llama-server',
      tags: [],
      capabilities: {},
      params: { threads: 16 },
    });
    store.writePreset(modelId, 'szybka', {
      version: 1,
      name: 'szybka',
      port: 8081,
      params: { temp: 0.7 },
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.global).toBeDefined();
    expect(body.models[modelId]).toBeDefined();
    expect(body.presets[modelId]['szybka'].port).toBe(8081);
    expect(body.effective[modelId]['szybka'].temp).toEqual({ value: 0.7, source: 'preset' });
    expect(body.effective[modelId]['szybka'].threads).toEqual({ value: 16, source: 'model' });
    expect(body.state.home).toBe(home.root);
    expect(body.state.watchActive).toBe(true);
    await app.close();
  });

  it('PUT /api/v1/config/global merges + validates + writes atomically', async () => {
    const { app, store, home } = await tempApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/config/global',
      payload: { server: { port: 3200 }, modelDirs: ['/mnt/dane/Modele'] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.server.port).toBe(3200);
    expect(body.modelDirs).toEqual(['/mnt/dane/Modele']);
    expect(body.server.host).toBe('127.0.0.1'); // untouched field kept
    expect(store.readGlobal().server.port).toBe(3200);
    // global.json on disk reflects the write.
    const onDisk = JSON.parse(await readFile(home.globalFile, 'utf-8'));
    expect(onDisk.server).toEqual({ host: '127.0.0.1', port: 3200 });
    await app.close();
  });

  it('PUT with an invalid body → 400 CONFIG_INVALID envelope, file untouched', async () => {
    const { app, store } = await tempApp();
    const before = store.readGlobal();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/config/global',
      payload: { portRange: { start: 99999, end: 8099 } },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('CONFIG_INVALID');
    expect(Array.isArray(body.error.details.problems)).toBe(true);
    expect(store.readGlobal()).toEqual(before);
    await app.close();
  });

  it('GET /api/v1/status includes the config watch state (P-12)', async () => {
    const { app, home } = await tempApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.config.home).toBe(home.root);
    expect(body.config.reloadCount).toBe(0);
    await app.close();
  });
});
