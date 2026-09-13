import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfigWatchState } from '@ai-dashboard/shared';
import { buildApp } from '../../app.js';
import { ensureHome, resolveHome } from '../../core/config/paths.js';
import { ConfigStore } from '../../core/config/store.js';

async function tempApp() {
  const root = mkdtempSync(join(tmpdir(), 'ai-dashboard-engines-api-'));
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
  return { app, store, home };
}

/** A fake executable answering `--version` (not a real llama-server). */
function fakeBinary(dir: string, name = 'fake-llama-server'): string {
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\necho "version: 9.9.9-test"\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}

describe('Engine API (Faza 2.5: GET/PUT /api/v1/engines)', () => {
  it('GET /api/v1/engines lists llama-server with the resolved binary (engine → global)', async () => {
    const { app, store } = await tempApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/engines' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.engines).toHaveLength(1);
    // No engine-level config yet → binary comes from global.json (layer 2).
    expect(body.engines[0]).toMatchObject({
      id: 'llama-server',
      filePatterns: ['*.gguf'],
      configured: true,
      binarySource: 'global',
    });

    // An engine-level config wins over the global one.
    store.writeEngine('llama-server', { version: 1, binary: '/custom/llama-server', params: {} });
    const after = await app.inject({ method: 'GET', url: '/api/v1/engines' });
    expect(after.json().engines[0]).toMatchObject({
      binary: '/custom/llama-server',
      binarySource: 'engine',
    });
    await app.close();
  });

  it('GET /api/v1/engines/:id/schema returns the declarative param schema', async () => {
    const { app } = await tempApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/engines/llama-server/schema' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.engineId).toBe('llama-server');
    expect(Array.isArray(body.schema)).toBe(true);
    const keys = body.schema.map((p: { key: string }) => p.key);
    expect(keys).toContain('context-size');
    expect(keys).toContain('gpu-layers');
    expect(keys).toContain('metrics-enabled');
    expect(keys).toContain('port');
    // Every param has a type and a group (the UI form is generated from this).
    for (const p of body.schema) {
      expect(typeof p.type).toBe('string');
      expect(typeof p.group).toBe('string');
    }
    await app.close();
  });

  it('GET /api/v1/engines/unknown → 404 ENGINE_NOT_FOUND', async () => {
    const { app } = await tempApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/engines/nope/schema' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ENGINE_NOT_FOUND');
    await app.close();
  });

  it('PUT /api/v1/engines/:id validates the binary and stores the config', async () => {
    const { app, store, home } = await tempApp();
    const root = home.root;
    const binary = fakeBinary(root);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/engines/llama-server',
      payload: { binary, params: { threads: 8 } },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.binary).toBe(binary);
    expect(body.params).toEqual({ threads: 8 });
    // The binary check ran: fake script — ok, but no libvulkan linkage.
    expect(body.check.versionLine).toBe('version: 9.9.9-test');
    expect(body.check.vulkan).toBe(false);
    // Persisted to config/engines/llama-server.json.
    const onDisk = JSON.parse(await readFile(`${home.enginesDir}/llama-server.json`, 'utf-8'));
    expect(onDisk.binary).toBe(binary);
    expect(store.readEngine('llama-server')).not.toBeNull();
    await app.close();
  });

  it('PUT with a nonexistent binary → 400 ENGINE_BINARY_INVALID', async () => {
    const { app, store } = await tempApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/engines/llama-server',
      payload: { binary: '/nope/llama-server' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('ENGINE_BINARY_INVALID');
    expect(store.readEngine('llama-server')).toBeNull(); // nothing written
    await app.close();
  });

  it('PUT with invalid params → 400 VALIDATION_FAILED (schema-driven)', async () => {
    const { app, home } = await tempApp();
    const binary = fakeBinary(home.root, 'fake-2');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/engines/llama-server',
      payload: { binary, params: { threads: 'many', 'load-mode': 'bogus', unknownKey: 1 } },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.problems.length).toBeGreaterThanOrEqual(3);
    await app.close();
  });

  it('PUT to an unknown engine → 404 ENGINE_NOT_FOUND', async () => {
    const { app } = await tempApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/engines/nope',
      payload: { binary: '/x' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ENGINE_NOT_FOUND');
    await app.close();
  });
});
