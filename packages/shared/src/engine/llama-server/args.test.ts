import { describe, expect, it } from 'vitest';
import { buildLlamaServerLaunch } from './args.js';
import { LLAMA_SERVER_SCHEMA } from './schema.js';

/** All schema defaults as a params object (the "no overrides" baseline). */
function defaults(): Record<string, unknown> {
  return Object.fromEntries(LLAMA_SERVER_SCHEMA.map((p) => [p.key, p.default]));
}

describe('buildLlamaServerLaunch (PLAN §10.1 — Faza 2.4)', () => {
  it('matches the PLAN example command for the "szybka" preset', () => {
    const ctx = {
      binary: 'llama-server',
      modelPath: '/mnt/dane/Modele/llama-3-8b-instruct.Q8_0.gguf',
      params: {
        ...defaults(),
        'context-size': 4096,
        'gpu-layers': 32,
        threads: 8,
        temp: 0.7,
        'top-p': 0.8,
        'top-k': 20,
        'max-tokens': 512,
        host: '127.0.0.1',
        port: 8081,
      },
    };
    const cmd = buildLlamaServerLaunch(ctx);
    // Order follows LLAMA_SERVER_SCHEMA: model, ctx-size, gpu-layers, threads, temp,
    // top-p, top-k, max-tokens, metrics-enabled (default true → sent), port (≠ default 8080 → sent).
    // host at default (127.0.0.1) → omitted; offline at default (false) → omitted.
    expect(cmd.args).toEqual([
      '--model',
      '/mnt/dane/Modele/llama-3-8b-instruct.Q8_0.gguf',
      '--ctx-size',
      '4096',
      '--n-gpu-layers',
      '32',
      '--threads',
      '8',
      '--temp',
      '0.7',
      '--top-p',
      '0.8',
      '--top-k',
      '20',
      '--n-predict',
      '512',
      '--metrics',
      '--port',
      '8081',
    ]);
    // cwd defaults to the model file's directory; env is empty.
    expect(cmd.cwd).toBe('/mnt/dane/Modele');
    expect(cmd.env).toEqual({});
  });

  it('sends only --model/--metrics for an all-defaults config (host/port at default → omitted)', () => {
    // host/port at their schema defaults (127.0.0.1:8080) are now omitted entirely;
    // offline at its default (false) is omitted; metrics at its default (true) is sent.
    const cmd = buildLlamaServerLaunch({
      binary: 'llama-server',
      modelPath: '/m/model.gguf',
      params: { ...defaults(), model: undefined, host: '127.0.0.1', port: 8080 },
    });
    expect(cmd.args).toEqual(['--model', '/m/model.gguf', '--metrics']);
  });

  it('never sends a flag for its schema default (no-redundancy rule)', () => {
    const cmd = buildLlamaServerLaunch({
      binary: 'llama-server',
      modelPath: '/m/model.gguf',
      params: {
        ...defaults(),
        model: undefined,
        host: '127.0.0.1',
        port: 8080,
        'context-size': 0, // default
        'gpu-layers': 'auto', // default
        threads: -1, // default
        temp: 0.8, // default
        'top-p': 0.95, // default
        'top-k': 40, // default
        'max-tokens': -1, // default
      },
    });
    for (const flag of ['--ctx-size', '--n-gpu-layers', '--threads', '--temp', '--top-p', '--top-k', '--n-predict']) {
      expect(cmd.args).not.toContain(flag);
    }
  });

  it('gpu-layers: number sent as-is, "all" accepted, "auto" omitted', () => {
    const base = { binary: 'llama-server', modelPath: '/m/x.gguf', params: { ...defaults(), model: undefined } };
    expect(buildLlamaServerLaunch({ ...base, params: { ...base.params, 'gpu-layers': 32 } }).args).toContain(
      '--n-gpu-layers',
    );
    expect(buildLlamaServerLaunch({ ...base, params: { ...base.params, 'gpu-layers': 'all' } }).args).toContain(
      '--n-gpu-layers',
    );
    const all = buildLlamaServerLaunch({ ...base, params: { ...base.params, 'gpu-layers': 'all' } }).args;
    expect(all[all.indexOf('--n-gpu-layers') + 1]).toBe('all');
    expect(buildLlamaServerLaunch({ ...base, params: { ...base.params, 'gpu-layers': 'auto' } }).args).not.toContain(
      '--n-gpu-layers',
    );
    // 0 is an explicit value (CPU mode) — different from the 'auto' default, so it is sent.
    const cpu = buildLlamaServerLaunch({ ...base, params: { ...base.params, 'gpu-layers': 0 } }).args;
    expect(cpu[cpu.indexOf('--n-gpu-layers') + 1]).toBe('0');
  });

  it('bools: metrics flag when true (default); offline flag when true (≠ default false); fit → --fit off when false', () => {
    const base = { binary: 'llama-server', modelPath: '/m/x.gguf' };
    const mk = (extra: Record<string, unknown>) =>
      buildLlamaServerLaunch({ ...base, params: { ...defaults(), model: undefined, ...extra } }).args;

    expect(mk({})).toContain('--metrics'); // default true (plain bool: sent when true)
    expect(mk({ 'metrics-enabled': false })).not.toContain('--metrics'); // false → not sent
    expect(mk({})).not.toContain('--offline'); // default false (plain bool: not sent when false)
    expect(mk({ offline: true })).toContain('--offline'); // true (≠ default) → sent
    expect(mk({})).not.toContain('--fit'); // default true
    const fitArgs = mk({ fit: false });
    expect(fitArgs[fitArgs.indexOf('--fit') + 1]).toBe('off');
  });

  it('slots-endpoint/web-ui: --no-slots / --no-ui when disabled, nothing when enabled', () => {
    const base = { binary: 'llama-server', modelPath: '/m/x.gguf' };
    const mk = (extra: Record<string, unknown>) =>
      buildLlamaServerLaunch({ ...base, params: { ...defaults(), model: undefined, ...extra } }).args;

    expect(mk({})).not.toContain('--slots');
    expect(mk({})).not.toContain('--no-slots');
    expect(mk({ 'slots-endpoint': false })).toContain('--no-slots');
    expect(mk({})).not.toContain('--ui');
    expect(mk({})).not.toContain('--no-ui');
    expect(mk({ 'web-ui': false })).toContain('--no-ui');
  });

  it('enum + path params: sent when they differ from the default', () => {
    const base = { binary: 'llama-server', modelPath: '/m/x.gguf' };
    const mk = (extra: Record<string, unknown>) =>
      buildLlamaServerLaunch({ ...base, params: { ...defaults(), model: undefined, ...extra } }).args;

    const loadMode = mk({ 'load-mode': 'mmap' });
    expect(loadMode[loadMode.indexOf('--load-mode') + 1]).toBe('mmap');
    const fa = mk({ 'flash-attn': 'on' });
    expect(fa[fa.indexOf('--flash-attn') + 1]).toBe('on');
    const spec = mk({
      'spec-model': '/m/draft.gguf',
      'spec-type': 'draft-simple',
      'n-draft': 5,
    });
    expect(spec).toContain('--spec-draft-model');
    expect(spec[spec.indexOf('--spec-draft-model') + 1]).toBe('/m/draft.gguf');
    expect(spec[spec.indexOf('--spec-type') + 1]).toBe('draft-simple');
    expect(spec[spec.indexOf('--spec-draft-n-max') + 1]).toBe('5');
  });

  it('empty strings (device, api-key) are "unset" and never sent', () => {
    const base = { binary: 'llama-server', modelPath: '/m/x.gguf' };
    const args = buildLlamaServerLaunch({
      ...base,
      params: { ...defaults(), model: undefined, device: '', 'api-key': '' },
    }).args;
    expect(args).not.toContain('--device');
    expect(args).not.toContain('--api-key');
  });

  it('api-key sent when set; custom cwd/env pass through', () => {
    const cmd = buildLlamaServerLaunch({
      binary: 'llama-server',
      modelPath: '/m/x.gguf',
      params: { ...defaults(), model: undefined, 'api-key': 'sk-test' },
      cwd: '/custom',
      env: { EXTRA: '1' },
    });
    expect(cmd.args).toContain('--api-key');
    expect(cmd.args[cmd.args.indexOf('--api-key') + 1]).toBe('sk-test');
    expect(cmd.cwd).toBe('/custom');
    expect(cmd.env).toEqual({ EXTRA: '1' });
  });
});
