import { describe, expect, it } from 'vitest';
import type { ConfigSnapshot } from '@ai-dashboard/shared';
import { buildEffective, resolveParams, type ConfigLayer } from './layers.js';

describe('resolveParams (Faza 1.3: 6-layer merge + source per value)', () => {
  it('merges all six layers with ascending priority', () => {
    const layers: ConfigLayer[] = [
      { source: 'schema', params: { threads: 4, temp: 0.9, 'context-size': 2048 } },
      { source: 'global', params: { threads: 8 } },
      { source: 'engine', params: { threads: 16, 'context-size': 4096 } },
      { source: 'model', params: { temp: 0.5 } },
      { source: 'preset', params: { 'context-size': 8192, maxTokens: 512 } },
      { source: 'instance', params: { temp: 1.1 } },
    ];
    const resolved = resolveParams(layers);
    expect(resolved.threads).toEqual({ value: 16, source: 'engine' });
    expect(resolved.temp).toEqual({ value: 1.1, source: 'instance' });
    expect(resolved['context-size']).toEqual({ value: 8192, source: 'preset' });
    expect(resolved.maxTokens).toEqual({ value: 512, source: 'preset' });
  });

  it('records the source per value (FC-5)', () => {
    const layers: ConfigLayer[] = [
      { source: 'global', params: { threads: 8 } },
      { source: 'model', params: { threads: 12 } },
    ];
    const resolved = resolveParams(layers);
    expect(Object.entries(resolved.threads)).toEqual([
      ['value', 12],
      ['source', 'model'],
    ]);
  });

  it('handles partial layers and undefined params gracefully', () => {
    const layers: ConfigLayer[] = [
      { source: 'schema', params: { threads: 4 } },
      { source: 'engine' }, // no params key at all
      { source: 'instance', params: { temp: 0.7 } },
    ];
    const resolved = resolveParams(layers);
    expect(resolved.threads).toEqual({ value: 4, source: 'schema' });
    expect(resolved.temp).toEqual({ value: 0.7, source: 'instance' });
  });

  it('returns an empty object for empty layers', () => {
    expect(resolveParams([])).toEqual({});
    expect(resolveParams([{ source: 'global' }, { source: 'model' }])).toEqual({});
  });

  it('undefined values never shadow a lower layer', () => {
    const layers: ConfigLayer[] = [
      { source: 'global', params: { threads: 8 } },
      { source: 'preset', params: { threads: undefined, temp: 0.7 } },
    ];
    const resolved = resolveParams(layers);
    expect(resolved.threads).toEqual({ value: 8, source: 'global' });
    expect(resolved.temp).toEqual({ value: 0.7, source: 'preset' });
  });
});

describe('buildEffective (snapshot → per (model, preset) merge)', () => {
  const snapshot: ConfigSnapshot = {
    global: {
      version: 1,
      modelDirs: [],
      defaults: { threads: 4, temp: 0.9, 'context-size': 2048 },
      portRange: { start: 8080, end: 8099 },
      engines: { 'llama-server': { binary: '/x/llama-server' } },
      server: { host: '127.0.0.1', port: 3100 },
      security: { token: null },
      monitoring: { probeIntervalSec: 5, startupTimeoutSec: 120 },
      logs: { ringLines: 1000, retentionFiles: 10 },
    },
    engines: {
      'llama-server': { version: 1, binary: '/x/llama-server', params: { threads: 8 } },
    },
    models: {
      'm1': {
        version: 1,
        engineId: 'llama-server',
        tags: [],
        capabilities: {},
        params: { temp: 0.5 },
      },
      'm2': {
        version: 1,
        tags: [],
        capabilities: {},
        params: {},
      },
    },
    presets: {
      'm1': {
        'szybka': { version: 1, name: 'szybka', port: 8081, params: { temp: 0.7, 'context-size': 4096 } },
      },
    },
  };

  it('merges global → engine → model → preset per (model, preset)', () => {
    const effective = buildEffective(snapshot);
    const szybk = effective['m1']['szybka'];
    expect(szybk.threads).toEqual({ value: 8, source: 'engine' });
    expect(szybk.temp).toEqual({ value: 0.7, source: 'preset' });
    expect(szybk['context-size']).toEqual({ value: 4096, source: 'preset' });
  });

  it('models without engineId skip the engine layer; no presets → no entry', () => {
    const effective = buildEffective(snapshot);
    expect(effective['m2']).toBeUndefined(); // no presets → nothing to resolve
    const noEngine: ConfigSnapshot = { ...snapshot, models: { m2: snapshot.models['m2'] }, presets: { m2: { d: { version: 1, name: 'd', params: {} } } } };
    const e2 = buildEffective(noEngine);
    expect(e2['m2']['d'].threads).toEqual({ value: 4, source: 'global' });
  });

  it('handles an empty snapshot', () => {
    const empty: ConfigSnapshot = {
      global: {
        version: 1,
        modelDirs: [],
        defaults: {},
        portRange: { start: 8080, end: 8099 },
        engines: {},
        server: { host: '127.0.0.1', port: 3100 },
        security: { token: null },
        monitoring: { probeIntervalSec: 5, startupTimeoutSec: 120 },
        logs: { ringLines: 1000, retentionFiles: 10 },
      },
      engines: {},
      models: {},
      presets: {},
    };
    expect(buildEffective(empty)).toEqual({});
  });
});
