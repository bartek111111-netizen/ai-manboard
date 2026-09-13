/**
 * Config layer merge (CFG-1, PLAN §9.1, Faza 1.3):
 *
 *   1. schema defaults   (engine schema.ts — Faza 2)
 *   2. global defaults   (global.json → defaults)
 *   3. engine params     (config/engines/<engineId>.json)
 *   4. model params      (config/models/<modelId>.json)
 *   5. preset params     (config/presets/<modelId>/<preset>.json)
 *   6. instance overrides (state/instances/<id>.json — Faza 4)
 *
 * Result: per-parameter `{ value, source }` so the UI can show "skąd" (FC-5).
 */
import type { ConfigSnapshot, ResolvedConfig, ConfigSource } from '@ai-dashboard/shared';

/** One layer of the merge: label + its (partial) parameters. */
export interface ConfigLayer {
  source: ConfigSource;
  params?: Record<string, unknown>;
}

/**
 * Merges config layers with ascending priority (lowest first, highest last).
 * The highest layer that defines a key wins; the result records the
 * winning `source` per value. Keys absent from all layers are omitted.
 */
export function resolveParams(layers: readonly ConfigLayer[]): ResolvedConfig {
  const keys = new Set<string>();
  for (const layer of layers) {
    if (layer.params) {
      for (const key of Object.keys(layer.params)) keys.add(key);
    }
  }

  const resolved: ResolvedConfig = {};
  for (const key of [...keys].sort()) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const value = layers[i].params?.[key];
      if (value !== undefined) {
        resolved[key] = { value, source: layers[i].source };
        break;
      }
    }
  }
  return resolved;
}

/**
 * Builds the effective config for every (model, preset) pair from a
 * snapshot, using the layers available at Faza 1:
 * global defaults → engine → model → preset.
 * (Schema defaults and instance overrides join in later phases.)
 */
export function buildEffective(snapshot: ConfigSnapshot): Record<string, Record<string, ResolvedConfig>> {
  const result: Record<string, Record<string, ResolvedConfig>> = {};

  for (const [modelId, model] of Object.entries(snapshot.models)) {
    const engine = model.engineId ? snapshot.engines[model.engineId] : undefined;
    const baseLayers: ConfigLayer[] = [
      { source: 'global', params: snapshot.global.defaults },
      ...(engine ? [{ source: 'engine' as ConfigSource, params: engine.params }] : []),
      { source: 'model', params: model.params },
    ];

    const presets = snapshot.presets[modelId] ?? {};
    const forModel: Record<string, ResolvedConfig> = {};
    for (const [presetName, preset] of Object.entries(presets)) {
      forModel[presetName] = resolveParams([...baseLayers, { source: 'preset', params: preset.params }]);
    }
    if (Object.keys(forModel).length > 0) result[modelId] = forModel;
  }
  return result;
}
