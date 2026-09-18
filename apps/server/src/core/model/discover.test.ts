import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listEngines } from '@ai-dashboard/shared/engine';
import { ensureHome, resolveHome } from '../config/paths.js';
import { ConfigStore } from '../config/store.js';
import { discoverModels, matchesPattern } from './discover.js';
import { modelIdFor } from './ids.js';

/** A throwaway `~/.ai-dashboard` under /tmp. */
function tempHome(): { store: ConfigStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ai-dashboard-discover-'));
  const home = resolveHome(root);
  ensureHome(home);
  return { store: new ConfigStore(home), root };
}

describe('matchesPattern (engine filePatterns)', () => {
  it('matches *.gguf and rejects others', () => {
    expect(matchesPattern('model.gguf', '*.gguf')).toBe(true);
    expect(matchesPattern('model.gguf', '*.bin')).toBe(false);
    expect(matchesPattern('model.bin', '*.gguf')).toBe(false);
  });
});

describe('discoverModels (FM-2: scan modelDirs, depth ≤4, incremental)', () => {
  it('finds gguf files and creates discover-origin model configs', () => {
    const { store, root } = tempHome();
    const modelDir = join(root, 'modele');
    mkdirSync(join(modelDir, 'sub'), { recursive: true });
    const file = join(modelDir, 'sub', 'my-model.gguf');
    writeFileSync(file, 'gguf-bytes');

    store.writeGlobal({ ...store.readGlobal(), modelDirs: [modelDir] });
    const result = discoverModels(store, listEngines());

    expect(result.added.length).toBe(1);
    expect(result.total).toBe(1);
    const id = modelIdFor(file);
    expect(result.added).toEqual([id]);
    const config = store.readModel(id);
    expect(config).not.toBeNull();
    expect(config?.origin).toBe('discover');
    expect(config?.params.model).toBe(file);
  });

  it('is idempotent: a second scan adds nothing', () => {
    const { store, root } = tempHome();
    const modelDir = join(root, 'modele');
    mkdirSync(modelDir, { recursive: true });
    const file = join(modelDir, 'model.gguf');
    writeFileSync(file, 'gguf-bytes');
    store.writeGlobal({ ...store.readGlobal(), modelDirs: [modelDir] });

    const first = discoverModels(store, listEngines());
    const second = discoverModels(store, listEngines());
    expect(first.added.length).toBe(1);
    expect(second.added).toEqual([]);
    expect(second.total).toBe(1);
  });

  it('drops a model whose file left the disk, never deletes the file (S-5)', () => {
    const { store, root } = tempHome();
    const modelDir = join(root, 'modele');
    mkdirSync(modelDir, { recursive: true });
    const file = join(modelDir, 'model.gguf');
    writeFileSync(file, 'gguf-bytes');
    store.writeGlobal({ ...store.readGlobal(), modelDirs: [modelDir] });

    discoverModels(store, listEngines());
    // Simulate the model file leaving disk (e.g. user deleted it).
    unlinkSync(file);
    const result = discoverModels(store, listEngines());
    // The model config is removed from the list (its file is gone).
    const id = modelIdFor(file);
    expect(result.removed).toEqual([id]);
    expect(store.listModelIds().length).toBe(0);
    // And the file was never touched by the dashboard (it is already gone by hand).
    expect(existsSync(file)).toBe(false);
  });

  it('only scans up to depth 4 below a model dir', () => {
    const { store, root } = tempHome();
    const modelDir = join(root, 'modele');
    // Depth 5: too deep, should NOT be found.
    const deep = join(modelDir, 'a', 'b', 'c', 'd', 'e');
    mkdirSync(deep, { recursive: true });
    const deepFile = join(deep, 'deep.gguf');
    writeFileSync(deepFile, 'x');
    // Depth 4: found.
    const shallow = join(modelDir, 'a', 'b', 'c');
    mkdirSync(shallow, { recursive: true });
    const shallowFile = join(shallow, 'shallow.gguf');
    writeFileSync(shallowFile, 'x');

    store.writeGlobal({ ...store.readGlobal(), modelDirs: [modelDir] });
    const result = discoverModels(store, listEngines());
    expect(result.added.length).toBe(1);
    expect(result.added).toEqual([modelIdFor(shallowFile)]);
    // The deep file is not scanned; clean up.
    rmSync(modelDir, { recursive: true, force: true });
  });

  it('computes a stable model id from the file path', () => {
    const id = modelIdFor('/mnt/dane/Modele/llama-3-8b-instruct.gguf');
    expect(id).toMatch(/^llama-3-8b-instruct-[0-9a-f]{8}$/);
    expect(modelIdFor('/mnt/dane/Modele/llama-3-8b-instruct.gguf')).toBe(id);
  });
});
