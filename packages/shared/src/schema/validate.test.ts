import { describe, expect, it } from 'vitest';
import { AppError } from '../api/errors.js';
import {
  mergeGlobalConfig,
  validateEngineConfig,
  validateGlobalConfig,
  validateModelConfig,
  validatePreset,
} from './validate.js';
import { defaultGlobalConfig } from '../config/defaults.js';

describe('validateGlobalConfig (global.json, §9.4)', () => {
  it('accepts the default global config', () => {
    const config = defaultGlobalConfig();
    expect(validateGlobalConfig(config)).toEqual(config);
  });

  it('accepts a valid custom config', () => {
    const config: Record<string, unknown> = {
      version: 1,
      modelDirs: ['/mnt/dane/Modele', '/home/bat/Modele'],
      defaults: { 'context-size': 4096 },
      portRange: { start: 8080, end: 8099 },
      engines: { 'llama-server': { binary: '/opt/llama.cpp/llama-server' } },
      server: { host: '127.0.0.1', port: 3100 },
      security: { token: null },
      monitoring: { probeIntervalSec: 5, startupTimeoutSec: 120 },
      logs: { ringLines: 1000, retentionFiles: 10 },
    };
    expect(validateGlobalConfig(config)).toEqual(config);
  });

  it('rejects a non-object', () => {
    expect(() => validateGlobalConfig('nope')).toThrow(AppError);
    expect(() => validateGlobalConfig(null)).toThrow(AppError);
  });

  it('collects multiple problems in details', () => {
    try {
      validateGlobalConfig({
        version: '1',
        modelDirs: ['relative/path'],
        portRange: { start: 99999, end: 8080 },
        server: { host: '', port: 80 },
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appError = err as AppError;
      expect(appError.code).toBe('CONFIG_INVALID');
      const problems = (appError.details as { problems: string[] }).problems;
      expect(problems.some((p) => p.includes('version'))).toBe(true);
      expect(problems.some((p) => p.includes('modelDirs'))).toBe(true);
      expect(problems.some((p) => p.includes('portRange'))).toBe(true);
      expect(problems.some((p) => p.includes('server.host'))).toBe(true);
      expect(problems.some((p) => p.includes('server.port'))).toBe(true);
    }
  });

  it('requires absolute modelDirs paths (S-9)', () => {
    expect(() =>
      validateGlobalConfig({
        version: 1,
        modelDirs: ['./models'],
        portRange: { start: 8080, end: 8099 },
        engines: {},
        server: { host: '127.0.0.1', port: 3100 },
        security: { token: null },
        monitoring: { probeIntervalSec: 5, startupTimeoutSec: 120 },
        logs: { ringLines: 1000, retentionFiles: 10 },
      }),
    ).toThrow(AppError);
  });

  it('enforces port bounds 1024–65535 (S-9)', () => {
    const base = {
      version: 1,
      modelDirs: [] as string[],
      portRange: { start: 1023, end: 8099 },
      engines: {},
      server: { host: '127.0.0.1', port: 3100 },
      security: { token: null },
      monitoring: { probeIntervalSec: 5, startupTimeoutSec: 120 },
      logs: { ringLines: 1000, retentionFiles: 10 },
    };
    expect(() => validateGlobalConfig(base)).toThrow(AppError);
    expect(validateGlobalConfig({ ...base, portRange: { start: 1024, end: 65535 } })).toBeDefined();
  });
});

describe('validateEngineConfig / validateModelConfig / validatePreset', () => {
  it('engine: requires a non-empty binary', () => {
    expect(validateEngineConfig({ version: 1, binary: '/x/llama-server', params: {} })).toBeDefined();
    expect(() => validateEngineConfig({ version: 1, binary: '', params: {} })).toThrow(AppError);
    expect(() => validateEngineConfig({ version: 1, params: {} })).toThrow(AppError);
  });

  it('model: params required, capabilities booleans only', () => {
    expect(
      validateModelConfig({ version: 1, tags: [], capabilities: { text: true, vision: false }, params: {} }),
    ).toBeDefined();
    expect(() =>
      validateModelConfig({ version: 1, tags: [], capabilities: { text: 'yes' }, params: {} }),
    ).toThrow(AppError);
    expect(() => validateModelConfig({ version: 1, tags: [], capabilities: {} })).toThrow(AppError);
  });

  it('preset: port bounds + name required', () => {
    expect(validatePreset({ version: 1, name: 'szybka', port: 8081, params: {} })).toBeDefined();
    expect(() => validatePreset({ version: 1, name: '', params: {} })).toThrow(AppError);
    expect(() => validatePreset({ version: 1, name: 'x', port: 99999, params: {} })).toThrow(AppError);
  });
});

describe('mergeGlobalConfig (PUT /api/v1/config/global)', () => {
  const base = defaultGlobalConfig();

  it('merges a partial update over the current config', () => {
    const merged = mergeGlobalConfig(base, { server: { port: 3200 }, modelDirs: ['/mnt/dane/Modele'] });
    expect(merged.server.port).toBe(3200);
    expect(merged.server.host).toBe('127.0.0.1');
    expect(merged.modelDirs).toEqual(['/mnt/dane/Modele']);
    expect(merged.portRange).toEqual({ start: 8080, end: 8099 });
  });

  it('rejects a non-object body', () => {
    expect(() => mergeGlobalConfig(base, 'nope')).toThrow(AppError);
    expect(() => mergeGlobalConfig(base, null)).toThrow(AppError);
  });

  it('validates the merged result', () => {
    expect(() => mergeGlobalConfig(base, { portRange: { start: 99999, end: 8099 } })).toThrow(AppError);
  });
});
