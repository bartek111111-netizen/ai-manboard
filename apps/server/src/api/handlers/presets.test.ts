import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ConfigWatchState } from '@ai-dashboard/shared';
import { buildApp } from '../../app.js';
import { ensureHome, resolveHome } from '../../core/config/paths.js';
import { ConfigStore } from '../../core/config/store.js';

async function tempApp() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-dashboard-presets-'));
  const home = resolveHome(join(dir, '.ai-dashboard'));
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
  // Seed a model so presets have a parent.
  store.writeModel('m1', { version: 1, engineId: 'dummy', tags: [], capabilities: {}, params: {} });
  return { app, store };
}

describe('preset endpoints (PLAN §14.1, Faza 6.1)', () => {
  it('PUT then GET lists the preset', async () => {
    const { app } = await tempApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/models/m1/presets/fast',
      payload: { version: 1, name: 'fast', port: 8081, params: { 'context-size': 4096 } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().name).toBe('fast');

    const list = await app.inject({ method: 'GET', url: '/api/v1/models/m1/presets' });
    expect(list.statusCode).toBe(200);
    expect(list.json().presets.map((p: { name: string }) => p.name)).toEqual(['fast']);
    await app.close();
  });

  it('PUT overwrites an existing preset', async () => {
    const { app } = await tempApp();
    await app.inject({ method: 'PUT', url: '/api/v1/models/m1/presets/fast', payload: { port: 8081, params: {} } });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/models/m1/presets/fast',
      payload: { port: 8082, params: { 'context-size': 8192 } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().port).toBe(8082);
    await app.close();
  });

  it('POST duplicate clones under a new name', async () => {
    const { app } = await tempApp();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/models/m1/presets/fast',
      payload: { port: 8081, params: { 'context-size': 4096 } },
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/models/m1/presets/fast/duplicate',
      payload: { name: 'fast-copy' },
    });
    expect(dup.statusCode).toBe(201);
    expect(dup.json().name).toBe('fast-copy');
    expect(dup.json().params['context-size']).toBe(4096);

    const list = await app.inject({ method: 'GET', url: '/api/v1/models/m1/presets' });
    expect(list.json().presets.map((p: { name: string }) => p.name).sort()).toEqual(['fast', 'fast-copy']);
    await app.close();
  });

  it('DELETE removes a preset; a second DELETE is 404', async () => {
    const { app } = await tempApp();
    await app.inject({ method: 'PUT', url: '/api/v1/models/m1/presets/fast', payload: { port: 8081, params: {} } });
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/models/m1/presets/fast' });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const again = await app.inject({ method: 'DELETE', url: '/api/v1/models/m1/presets/fast' });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it('PUT / DELETE / duplicate for an unknown model → 404', async () => {
    const { app } = await tempApp();
    const put = await app.inject({ method: 'PUT', url: '/api/v1/models/nope/presets/x', payload: { params: {} } });
    expect(put.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/models/nope/presets/x' });
    expect(del.statusCode).toBe(404);
    const dup = await app.inject({ method: 'POST', url: '/api/v1/models/nope/presets/x/duplicate', payload: {} });
    expect(dup.statusCode).toBe(404);
    await app.close();
  });
});
