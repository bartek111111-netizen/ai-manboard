import { useCallback, useEffect, useState } from 'react';
import type { InstanceInfo, ModelView, Preset } from '@ai-dashboard/shared';
import { ApiError, discoverModels, getInstances, getModels, getPresets } from '../api/client';

export interface ModelData {
  models: ModelView[];
  instances: InstanceInfo[];
  /** Presets per model id. */
  presets: Record<string, Preset[]>;
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
  scan: () => Promise<void>;
}

/**
 * Fetches models + instances + all presets, polling every 3 s so the instance
 * state badges stay current (PLAN §20.1). `scan` triggers a modelDirs rescan.
 */
export function useModelData(intervalMs = 3000): ModelData {
  const [models, setModels] = useState<ModelView[]>([]);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [presets, setPresets] = useState<Record<string, Preset[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback((): void => {
    setRefreshing(true);
    getModels()
      .then(async (result) => {
        setModels(result);
        // Fetch presets for every model in parallel.
        const entries = await Promise.all(
          result.map(async (model) => {
            const list = await getPresets(model.id).catch(() => [] as Preset[]);
            return [model.id, list] as const;
          }),
        );
        setPresets(Object.fromEntries(entries));
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => setRefreshing(false));

    getInstances()
      .then((result) => {
        setInstances(result);
      })
      .catch(() => {
        // instances unavailable — keep the last known list
      });
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  const scan = useCallback(
    async (): Promise<void> => {
      await discoverModels();
      refresh();
    },
    [refresh],
  );

  return { models, instances, presets, error, refreshing, refresh, scan };
}
