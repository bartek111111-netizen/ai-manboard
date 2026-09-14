/**
 * Hook to detect model state (ready, idle, working) from slots endpoint.
 * Polls every 3s for live instances.
 */
import { useCallback, useEffect, useState } from 'react';
import { getInstances, getInstance, type InstanceInfo } from '../api/client';

export type ModelState = 'ready' | 'idle' | 'working' | 'unknown';

export interface ModelStateInfo {
  instanceId: string;
  modelId: string;
  preset: string;
  state: ModelState;
  slotsUsed: number;
  slotsTotal: number;
}

export function useModelState(_debounceMs: number = 0): ModelStateInfo[] {
  const [states, setStates] = useState<ModelStateInfo[]>([]);

  const detectState = useCallback((slotsUsed: number, slotsTotal: number): ModelState => {
    if (slotsUsed === 0) return 'idle';
    if (slotsUsed > 0) return 'working';
    return 'unknown';
  }, []);

  const refresh = useCallback(() => {
    getInstances()
      .then((list: InstanceInfo[]) => {
        const running = list.filter((i) => i.state === 'running' || i.state === 'starting');

        // For each running instance, fetch its runtime info
        running.forEach((inst) => {
          getInstance(inst.instanceId)
            .then((dto: any) => {
              const slotsUsed = dto.runtime?.slots?.used ?? 0;
              const slotsTotal = dto.runtime?.slots?.total ?? 0;
              const newState = detectState(slotsUsed, slotsTotal);

              setStates((prev) => {
                // Remove instances that are no longer running
                const filtered = prev.filter((s) => running.some((i) => i.instanceId === s.instanceId));
                // Update or add the current instance
                const existing = filtered.find((s) => s.instanceId === inst.instanceId);
                const item = {
                  instanceId: inst.instanceId,
                  modelId: inst.modelId,
                  preset: inst.preset,
                  state: newState,
                  slotsUsed,
                  slotsTotal,
                };
                if (existing) {
                  return filtered.map((s) => s.instanceId === inst.instanceId ? item : s);
                }
                return [...filtered, item];
              });
            })
            .catch(() => {});
        });

        // Remove instances that are no longer in the list
        setStates((prev) => prev.filter((s) => running.some((i) => i.instanceId === s.instanceId)));
      })
      .catch(() => {});
  }, [detectState]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  return states;
}
