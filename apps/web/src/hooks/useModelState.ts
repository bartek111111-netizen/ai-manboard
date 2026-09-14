/**
 * Hook to detect model state (ready, idle, working) from slots endpoint.
 * Polls every 3s for live instances.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useModelState(debounceMs: number = 0): ModelStateInfo[] {
  const [states, setStates] = useState<ModelStateInfo[]>([]);
  const [lastStates, setLastStates] = useState<Record<string, ModelState>>({});
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const stableStates = useRef<Record<string, ModelState>>({});

  const detectState = useCallback((slotsUsed: number, slotsTotal: number): ModelState => {
    if (slotsUsed === 0) return 'idle';
    if (slotsUsed > 0) return 'working';
    return 'unknown';
  }, []);

  const refresh = useCallback(() => {
    getInstances()
      .then((list: InstanceInfo[]) => {
        const running = list.filter((i) => i.state === 'running' || i.state === 'starting');

        running.forEach((inst) => {
          getInstance(inst.instanceId)
            .then((dto) => {
              const slotsUsed = dto.runtime?.slots?.used ?? 0;
              const slotsTotal = dto.runtime?.slots?.total ?? 0;
              const newState = detectState(slotsUsed, slotsTotal);

              // Update state map
              setStates((prev) => {
                const existing = prev.find((s) => s.instanceId === inst.instanceId);
                if (existing && existing.state === newState) return prev;

                // If debounce is set, delay the state change
                if (debounceMs > 0 && stableStates.current[inst.instanceId] !== newState) {
                  clearTimeout(debounceTimers.current[inst.instanceId]);
                  debounceTimers.current[inst.instanceId] = setTimeout(() => {
                    stableStates.current[inst.instanceId] = newState;
                    setStates((cur) => {
                      const item = cur.find((s) => s.instanceId === inst.instanceId);
                      if (item) return cur.map((s) => s.instanceId === inst.instanceId ? { ...s, state: newState } : s);
                      return [...cur, {
                        instanceId: inst.instanceId,
                        modelId: inst.modelId,
                        preset: inst.preset,
                        state: newState,
                        slotsUsed,
                        slotsTotal,
                      }];
                    });
                  }, debounceMs);
                } else {
                  stableStates.current[inst.instanceId] = newState;
                  const item = {
                    instanceId: inst.instanceId,
                    modelId: inst.modelId,
                    preset: inst.preset,
                    state: newState,
                    slotsUsed,
                    slotsTotal,
                  };
                  if (existing) {
                    return prev.map((s) => s.instanceId === inst.instanceId ? item : s);
                  }
                  return [...prev, item];
                }
                return prev;
              });
            })
            .catch(() => {});
        });

        // Remove instances that are no longer running
        setStates((prev) => prev.filter((s) => running.some((i) => i.instanceId === s.instanceId)));
      })
      .catch(() => {});
  }, [detectState, debounceMs]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Cleanup debounce timers
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  return states;
}
