import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError, type EngineConfig, type ModelConfig, type Preset } from '@ai-dashboard/shared';
import { ensureHome, resolveHome } from './paths.js';
import { ConfigStore } from './store.js';

/** A throwaway `~/.ai-dashboard` under /tmp for each test. */
function tempHome(): { store: ConfigStore; home: ReturnType<typeof resolveHome> } {
  const root = mkdtempSync(join(tmpdir(), 'ai-dashboard-test-'));
  const home = resolveHome(root);
  ensureHome(home);
  return { store: new ConfigStore(home), home };
}

describe('ConfigStore (Faza 1.1: atomic writes, .bak, validation)', () => {
  it('seeds global.json on first run (PLAN §9.4)', () => {
    const { store, home } = tempHome();
    const config = store.readGlobal();
    expect(config.version).toBe(1);
    expect(config.portRange).toEqual({ start: 8080, end: 8099 });
    expect(config.modelDirs).toEqual([]);
    expect(existsSync(home.globalFile)).toBe(true);
    // Second read returns the seeded file (not a fresh default).
    store.writeGlobal({ ...config, server: { host: '127.0.0.1', port: 3199 } });
    expect(store.readGlobal().server.port).toBe(3199);
  });

  it('writes atomically: no tmp files left behind, content exact', () => {
    const { store, home } = tempHome();
    const config = store.readGlobal();
    store.writeGlobal({ ...config, monitoring: { probeIntervalSec: 7, startupTimeoutSec: 120 } });
    const onDisk = JSON.parse(readFileSync(home.globalFile, 'utf-8'));
    expect(onDisk.monitoring.probeIntervalSec).toBe(7);
    const leftovers = readdirSync(home.configDir).filter((f) => f.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });

  it('creates a .bak of the previous version before overwrite (PLAN §9.3)', () => {
    const { store, home } = tempHome();
    store.readGlobal(); // seed
    const first = store.readGlobal();
    store.writeGlobal({ ...first, server: { host: '127.0.0.1', port: 3101 } });
    const backupPath = join(home.backupsDir, 'global.json.bak');
    expect(existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(readFileSync(backupPath, 'utf-8'));
    expect(backup.server.port).toBe(3100); // previous version
    expect(store.readGlobal().server.port).toBe(3101); // new version
  });

  it('rejects corrupt JSON with CONFIG_INVALID and never overwrites (PLAN §15)', () => {
    const { store, home } = tempHome();
    store.readGlobal(); // seed
    writeFileSync(home.globalFile, '{ not valid json');
    expect(() => store.readGlobal()).toThrow(AppError);
    expect(() => store.readGlobal()).toThrowError(/invalid JSON/);
    // The corrupt file stays untouched (no silent overwrite).
    expect(readFileSync(home.globalFile, 'utf-8')).toBe('{ not valid json');
  });

  it('rejects a structurally invalid global.json', () => {
    const { store, home } = tempHome();
    writeFileSync(home.globalFile, JSON.stringify({ version: 1, modelDirs: 'not-an-array' }));
    expect(() => store.readGlobal()).toThrow(AppError);
  });

  it('rejects path-traversal ids (S-4: config ids are file names)', () => {
    const { store } = tempHome();
    expect(() => store.writeModel('../evil', {} as ModelConfig)).toThrow(AppError);
    expect(() => store.writePreset('m1', '../../../x', {} as Preset)).toThrow(AppError);
    expect(() => store.readEngine('a/b')).toThrow(AppError);
  });

  it('round-trips engine, model and preset files', () => {
    const { store, home } = tempHome();
    const engine: EngineConfig = { version: 1, binary: '/x/llama-server', params: { threads: 8 } };
    expect(store.readEngine('llama-server')).toBeNull();
    store.writeEngine('llama-server', engine);
    expect(store.readEngine('llama-server')).toEqual(engine);
    expect(store.listEngineIds()).toEqual(['llama-server']);

    const model: ModelConfig = {
      version: 1,
      engineId: 'llama-server',
      displayName: 'M',
      tags: ['fast'],
      capabilities: { text: true },
      params: { 'context-size': 4096 },
    };
    store.writeModel('llama-3-8b-instruct-9f3a1c2e', model);
    expect(store.readModel('llama-3-8b-instruct-9f3a1c2e')).toEqual(model);
    expect(store.listModelIds()).toEqual(['llama-3-8b-instruct-9f3a1c2e']);

    const preset: Preset = {
      version: 1,
      name: 'szybka',
      description: 'Szybkie odpowiedzi, niski kontekst',
      port: 8081,
      params: { 'context-size': 4096, temp: 0.7 },
    };
    store.writePreset('llama-3-8b-instruct-9f3a1c2e', 'szybka', preset);
    expect(store.readPreset('llama-3-8b-instruct-9f3a1c2e', 'szybka')).toEqual(preset);
    expect(store.listPresets('llama-3-8b-instruct-9f3a1c2e')).toEqual(['szybka']);
    expect(existsSync(join(home.presetsDir, 'llama-3-8b-instruct-9f3a1c2e', 'szybka.json'))).toBe(true);
  });

  it('snapshot() aggregates all layers', () => {
    const { store } = tempHome();
    store.writeEngine('llama-server', { version: 1, binary: '/x/llama-server', params: { threads: 8 } });
    store.writeModel('m1', {
      version: 1,
      engineId: 'llama-server',
      tags: [],
      capabilities: {},
      params: { threads: 16 },
    });
    store.writePreset('m1', 'szybka', { version: 1, name: 'szybka', port: 8081, params: { temp: 0.7 } });

    const snapshot = store.snapshot();
    expect(snapshot.global).toBeDefined();
    expect(snapshot.engines['llama-server'].binary).toBe('/x/llama-server');
    expect(snapshot.models['m1'].params.threads).toBe(16);
    expect(snapshot.presets['m1']['szybka'].params.temp).toBe(0.7);
  });

  it('migrates files without a version field (v0 → v1)', () => {
    const { store, home } = tempHome();
    writeFileSync(home.globalFile, JSON.stringify({
      modelDirs: ['/mnt/dane/Modele'],
      portRange: { start: 8080, end: 8099 },
      engines: { 'llama-server': { binary: '~/llama.cpp/build/bin/llama-server' } },
      server: { host: '127.0.0.1', port: 3100 },
      security: { token: null },
      monitoring: { probeIntervalSec: 5, startupTimeoutSec: 120 },
      logs: { ringLines: 1000, retentionFiles: 10 },
    }));
    const config = store.readGlobal();
    expect(config.version).toBe(1);
    expect(config.modelDirs).toEqual(['/mnt/dane/Modele']);
  });
});
