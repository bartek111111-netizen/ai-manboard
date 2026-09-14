import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getInstances,
  getModels,
  getPresets,
  putPreset,
  startInstance,
  stopInstance,
} from './client.js';

/** A fetch stub that resolves with the given body/status; records the call. */
function mockFetch(
  body: unknown,
  status = 200,
): { fn: (url: string, init?: RequestInit) => Promise<Response>; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

describe('API client (Faza 7)', () => {
  it('getModels unwraps { models } → ModelView[]', async () => {
    mockFetch({ models: [{ id: 'm1', displayName: 'M1' }] });
    const models = await getModels();
    expect(models).toEqual([{ id: 'm1', displayName: 'M1' }]);
    vi.unstubAllGlobals();
  });

  it('getInstances unwraps { instances }', async () => {
    mockFetch({ instances: [{ instanceId: 'a--b' }] });
    const instances = await getInstances();
    expect(instances).toEqual([{ instanceId: 'a--b' }]);
    vi.unstubAllGlobals();
  });

  it('getPresets unwraps { presets }', async () => {
    mockFetch({ presets: [{ name: 'fast' }] });
    const presets = await getPresets('m1');
    expect(presets).toEqual([{ name: 'fast' }]);
    vi.unstubAllGlobals();
  });

  it('startInstance → POST /api/v1/instances/:id/start', async () => {
    const stub = mockFetch({ instanceId: 'm1--fast', state: 'starting' });
    const result = await startInstance('m1--fast');
    expect(result).toEqual({ instanceId: 'm1--fast', state: 'starting' });
    expect(stub.calls[0].url).toBe('/api/v1/instances/m1--fast/start');
    expect(stub.calls[0].init?.method).toBe('POST');
    vi.unstubAllGlobals();
  });

  it('stopInstance → POST …/stop', async () => {
    const stub = mockFetch({ instanceId: 'm1--fast', state: 'stopped' });
    await stopInstance('m1--fast');
    expect(stub.calls[0].url).toBe('/api/v1/instances/m1--fast/stop');
    vi.unstubAllGlobals();
  });

  it('putPreset → PUT …/presets/:name with a JSON body', async () => {
    const stub = mockFetch({});
    await putPreset('m1', 'fast', { version: 1, params: { n_ctx: 4096 } });
    expect(stub.calls[0].url).toBe('/api/v1/models/m1/presets/fast');
    expect(stub.calls[0].init?.method).toBe('PUT');
    const body = JSON.parse(String(stub.calls[0].init?.body));
    expect(body).toEqual({ version: 1, params: { n_ctx: 4096 } });
    vi.unstubAllGlobals();
  });

  it('maps a 404 error envelope to ApiError (code + message)', async () => {
    mockFetch({ error: { code: 'MODEL_NOT_FOUND', message: 'no such model' } }, 404);
    const error = await getModels().then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('MODEL_NOT_FOUND');
    expect((error as ApiError).message).toBe('no such model');
    vi.unstubAllGlobals();
  });

  it('maps a 409 (instance live) with details', async () => {
    mockFetch({ error: { code: 'INSTANCE_LIVE', message: 'already running', details: { state: 'running' } } }, 409);
    const error = await startInstance('m1--fast').then(() => null, (e: unknown) => e);
    expect((error as ApiError).code).toBe('INSTANCE_LIVE');
    expect((error as ApiError).details).toEqual({ state: 'running' });
    vi.unstubAllGlobals();
  });

  it('keeps the HTTP status message for a non-JSON error body', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- fetch stub signature
    const fn = async (_url: string, _init?: RequestInit): Promise<Response> =>
      new Response('Internal Server Error', { status: 500 });
    vi.stubGlobal('fetch', fn);
    const error = await getModels().then(() => null, (e: unknown) => e);
    expect((error as ApiError).message).toBe('HTTP 500');
    vi.unstubAllGlobals();
  });
});
