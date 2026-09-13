import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_VERSION } from '@ai-dashboard/shared';
import { buildApp } from './app.js';

describe('buildApp (phase 0 skeleton)', () => {
  it('GET /api/v1/status returns the dashboard state', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe(APP_NAME);
    expect(body.version).toBe(APP_VERSION);
    expect(body.state).toBe('running');
    expect(body.engines).toEqual([]);
    expect(typeof body.uptimeSec).toBe('number');
    expect(typeof body.timestamp).toBe('string');
    await app.close();
  });

  it('GET /healthz is a plain liveness check', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
