import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '../../config/types.js';
import { LlamaServerEngine } from './index.js';

describe('LlamaServerEngine (PLAN §7.1, §10 — Faza 2)', () => {
  const engine = new LlamaServerEngine();
  const dir = mkdtempSync(join(tmpdir(), 'llama-engine-test-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A fake executable that answers `--version` (not a real llama-server). */
  function fakeBinary(name: string, versionLine = 'version: 9.9.9-test'): string {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\necho "${versionLine}"\nexit 0\n`);
    chmodSync(file, 0o755);
    return file;
  }

  function resolved(params: Record<string, unknown>): ResolvedConfig {
    return Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, { value, source: 'schema' }]),
    ) as ResolvedConfig;
  }

  const modelInfo = { id: 'm1', path: join(dir, 'model.gguf'), engineId: 'llama-server' };

  it('detectCapabilities: heuristics from filename/architecture', () => {
    expect(
      engine.detectCapabilities({ id: 'm1', path: '/x/Qwen3.5-4B-Instruct-Q8.gguf', engineId: 'llama-server' }),
    ).toEqual(['text', 'thinking']);
    expect(
      engine.detectCapabilities({
        id: 'm2',
        path: '/x/llava-v1.5-7b.Q8_0.gguf',
        engineId: 'llama-server',
        architecture: 'llama',
      }),
    ).toEqual(['text', 'vision']);
    expect(
      engine.detectCapabilities({
        id: 'm3',
        path: '/x/whisper-large-v3.Q8_0.gguf',
        engineId: 'llama-server',
      }),
    ).toEqual(['text', 'audio']);
    // Plain LLM: text only.
    expect(engine.detectCapabilities({ id: 'm4', path: '/x/llama-3-8b.Q8_0.gguf', engineId: 'llama-server' }))
      .toEqual(['text']);
  });

  it('validate: missing model/draft file → problem; present files → ok', () => {
    const modelFile = join(dir, 'model.gguf');
    writeFileSync(modelFile, 'x');

    expect(
      engine.validate(modelInfo, resolved({ 'spec-model': '/nope/draft.gguf' })),
    ).toEqual(['spec-model: the draft model does not exist: /nope/draft.gguf']);
    expect(engine.validate(modelInfo, resolved({ model: modelFile, 'spec-model': modelFile }))).toEqual([]);
    expect(engine.validate(modelInfo, resolved({ model: '/nope/missing.gguf' }))).toEqual([
      'model: the file does not exist: /nope/missing.gguf',
    ]);
    expect(engine.validate(modelInfo, resolved({ port: 80 }))).toEqual([
      'port: must be in the range 1024–65535',
    ]);
  });

  it('checkBinary: fake executable → exists/executable/versionOk, no libvulkan', async () => {
    const binary = fakeBinary('fake-llama-server');
    const check = await engine.checkBinary(binary);
    expect(check.exists).toBe(true);
    expect(check.executable).toBe(true);
    expect(check.versionOk).toBe(true);
    expect(check.versionLine).toBe('version: 9.9.9-test');
    expect(check.vulkan).toBe(false); // shell script — no libvulkan linkage
    expect(check.errors).toEqual([]);
  });

  it('checkBinary: missing file and non-executable file → blocking errors', async () => {
    const missing = await engine.checkBinary(join(dir, 'does-not-exist'));
    expect(missing.exists).toBe(false);
    expect(missing.errors.length).toBeGreaterThan(0);

    const noexec = join(dir, 'noexec');
    writeFileSync(noexec, '#!/bin/sh\n');
    const check = await engine.checkBinary(noexec);
    expect(check.exists).toBe(true);
    expect(check.executable).toBe(false);
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('checkBinary: failing --version → blocking error', async () => {
    const bad = join(dir, 'bad-version');
    writeFileSync(bad, '#!/bin/sh\necho broken\nexit 1\n');
    chmodSync(bad, 0o755);
    const check = await engine.checkBinary(bad);
    expect(check.versionOk).toBe(false);
    expect(check.errors.length).toBeGreaterThan(0);
  });

  it('preflight: fake binary + cpu (gpu-layers=0) + free port + model exists → ok', async () => {
    const binary = fakeBinary('preflight-ok');
    const model = join(dir, 'model.gguf');
    writeFileSync(model, 'x');
    const result = await engine.preflight({
      binary,
      modelPath: model,
      params: { host: '127.0.0.1', port: 19991, 'gpu-layers': 0, threads: 4 },
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('preflight: gpu-layers>0 on a non-Vulkan binary → ENGINE_BINARY_INVALID (blocks)', async () => {
    const binary = fakeBinary('preflight-gpu');
    const model = join(dir, 'model.gguf');
    writeFileSync(model, 'x');
    const result = await engine.preflight({
      binary,
      modelPath: model,
      params: { host: '127.0.0.1', port: 19992, 'gpu-layers': 8 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ENGINE_BINARY_INVALID')).toBe(true);
    expect(result.errors.some((e) => e.message.includes('gpu-layers=0'))).toBe(true);
  });

  it('preflight: missing model file → MODEL_NOT_FOUND', async () => {
    const binary = fakeBinary('preflight-model');
    const result = await engine.preflight({
      binary,
      modelPath: join(dir, 'no-such-model.gguf'),
      params: { host: '127.0.0.1', port: 19993, 'gpu-layers': 0 },
    });
    expect(result.errors.some((e) => e.code === 'MODEL_NOT_FOUND')).toBe(true);
  });

  it('preflight: occupied port → PORT_IN_USE', async () => {
    const binary = fakeBinary('preflight-port');
    const model = join(dir, 'model.gguf');
    const srv = createServer();
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen({ host: '127.0.0.1', port: 19994 }, resolve);
    });
    try {
      const result = await engine.preflight({
        binary,
        modelPath: model,
        params: { host: '127.0.0.1', port: 19994, 'gpu-layers': 0 },
      });
      expect(result.errors.some((e) => e.code === 'PORT_IN_USE')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});
