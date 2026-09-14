import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '@ai-dashboard/shared';
import { listEngines } from '@ai-dashboard/shared/engine';
import { ensureHome, resolveHome } from '../config/paths.js';
import { ConfigStore } from '../config/store.js';
import { ModelRegistry } from './registry.js';
import { modelIdFor } from './ids.js';

function tempHome(): { store: ConfigStore; registry: ModelRegistry; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ai-dashboard-registry-'));
  const home = resolveHome(join(dir, '.ai-dashboard'));
  ensureHome(home);
  const store = new ConfigStore(home);
  return { store, registry: new ModelRegistry(store, listEngines()), dir };
}

describe('ModelRegistry (FM-3/5/6/8)', () => {
  it('add: registers a model (origin manual) when the file exists and matches', () => {
    const { registry, dir } = tempHome();
    const file = join(dir, 'my-model.gguf');
    writeFileSync(file, 'gguf');
    const view = registry.add({ path: file, engineId: 'llama-server' });
    expect(view.origin).toBe('manual');
    expect(view.path).toBe(file);
    expect(view.fileExists).toBe(true);
    expect(view.id).toBe(modelIdFor(file));
    expect(view.capabilities.source).toBe('heuristic');
  });

  it('add: throws MODEL_NOT_FOUND when the file does not exist', () => {
    const { registry } = tempHome();
    expect(() => registry.add({ path: '/no/such/file.gguf', engineId: 'llama-server' })).toThrow(AppError);
    expect(() =>
      registry.add({ path: '/no/such/file.gguf', engineId: 'llama-server' }),
    ).toThrowError(/does not exist/);
  });

  it('add: throws VALIDATION_FAILED when the file does not match the engine patterns', () => {
    const { registry, dir } = tempHome();
    const file = join(dir, 'notes.txt');
    writeFileSync(file, 'x');
    expect(() => registry.add({ path: file, engineId: 'llama-server' })).toThrowError(/does not match/);
  });

  it('add: throws ENGINE_NOT_FOUND for an unknown engine', () => {
    const { registry, dir } = tempHome();
    const file = join(dir, 'my-model.gguf');
    writeFileSync(file, 'gguf');
    expect(() => registry.add({ path: file, engineId: 'nope' })).toThrowError(/unknown engine/);
  });

  it('add: is idempotent (same path returns the same id)', () => {
    const { registry, dir } = tempHome();
    const file = join(dir, 'my-model.gguf');
    writeFileSync(file, 'gguf');
    const first = registry.add({ path: file, engineId: 'llama-server' });
    const second = registry.add({ path: file, engineId: 'llama-server' });
    expect(second.id).toBe(first.id);
  });

  it('get: throws MODEL_NOT_FOUND for an unknown id', () => {
    const { registry } = tempHome();
    expect(() => registry.get('unknown-model-id')).toThrow(AppError);
    expect(() => registry.get('unknown-model-id')).toThrowError(/not found/);
  });

  it('capabilities: heuristics add `vision` for a vision-named model', () => {
    const { registry, dir } = tempHome();
    const file = join(dir, 'my-vision-model.gguf');
    writeFileSync(file, 'gguf');
    const view = registry.add({ path: file, engineId: 'llama-server' });
    expect(view.capabilities.flags.vision).toBe(true);
    expect(view.capabilities.flags.text).toBe(true);
    expect(view.capabilities.source).toBe('heuristic');
  });

  it('capabilities: a manual edit becomes authoritative (source manual)', () => {
    const { registry, dir } = tempHome();
    const file = join(dir, 'my-model.gguf');
    writeFileSync(file, 'gguf');
    const id = registry.add({ path: file, engineId: 'llama-server' }).id;
    const updated = registry.update(id, { capabilities: { text: true, vision: true } });
    expect(updated.capabilities.source).toBe('manual');
    expect(updated.capabilities.flags.vision).toBe(true);
  });

  it('update: merges model-level params (layer 4) without touching the model path', () => {
    const { registry, store, dir } = tempHome();
    const file = join(dir, 'my-model.gguf');
    writeFileSync(file, 'gguf');
    const id = registry.add({ path: file, engineId: 'llama-server' }).id;
    const updated = registry.update(id, { params: { 'context-size': 8192 } });
    expect(updated.path).toBe(file); // model param preserved
    const config = store.readModel(id);
    expect(config?.params['context-size']).toBe(8192);
    expect(config?.params.model).toBe(file);
  });

  it('remove: deletes the model config but never the model file (S-5)', () => {
    const { registry, dir } = tempHome();
    const file = join(dir, 'my-model.gguf');
    writeFileSync(file, 'gguf');
    const id = registry.add({ path: file, engineId: 'llama-server' }).id;
    registry.remove(id);
    expect(registry.list().find((m) => m.id === id)).toBeUndefined();
    // The model file must survive.
    expect(existsSync(file)).toBe(true);
  });
});
