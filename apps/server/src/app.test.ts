import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_VERSION, type ConfigWatchState } from '@ai-dashboard/shared';
import { buildApp } from './app.js';
import { ensureHome, resolveHome } from './core/config/paths.js';
import { ConfigStore } from './core/config/store.js';

async function tempApp() {
  const root = mkdtempSync(join(tmpdir(), 'ai-dashboard-app-'));
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
  return { app, configState };
}

describe('buildApp', () => {
  it('GET /api/v1/status returns the dashboard state', async () => {
    const { app, configState } = await tempApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe(APP_NAME);
    expect(body.version).toBe(APP_VERSION);
    expect(body.state).toBe('running');
    expect(body.engines).toEqual([]);
    expect(typeof body.uptimeSec).toBe('number');
    expect(typeof body.timestamp).toBe('string');
    expect(body.config).toEqual(configState);
    await app.close();
  });

  it('GET /healthz is a plain liveness check', async () => {
    const { app } = await tempApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
