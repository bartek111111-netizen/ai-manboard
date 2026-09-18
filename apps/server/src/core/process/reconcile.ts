/**
 * Reconcile (PLAN §11.3, Faza 10.1): at dashboard startup, check the registry
 * against reality. For each entry in a live state (starting/running/stopping),
 * verify the PID is still alive. If the process is gone (dashboard restarted
 * while the child was running), settle the state:
 *   - stopping → stopped (we were stopping, the process is gone)
 *   - running/starting → crashed (the process died while we weren't watching)
 *
 * Also provides `resolveInstance` for the manual `POST /instances/:id/resolve`
 * endpoint: re-checks the PID and updates the state.
 */
import type { InstanceState } from "@ai-dashboard/shared";
import type { PidRegistry, RegistryEntry } from "./registry.js";

/** True if the PID refers to a live process (SIG 0 check). */
export function isPidAlive(pid: number | null): boolean {
  if (pid === null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconciles a single registry entry against reality.
 * Returns the new state if changed, or null if no change needed.
 */
export function reconcileEntry(entry: RegistryEntry): InstanceState | null {
  // Stable states: no change needed.
  if (
    entry.state === "stopped" ||
    entry.state === "error" ||
    entry.state === "crashed"
  ) {
    return null;
  }
  // `unknown`: can't auto-determine — leave for manual resolve.
  if (entry.state === "unknown") return null;

  // Live states: check if the PID is actually alive.
  if (
    entry.state === "running" ||
    entry.state === "starting" ||
    entry.state === "stopping"
  ) {
    if (entry.pid !== null && isPidAlive(entry.pid)) {
      // Process is alive — keep the state.
      return null;
    }
    // Process is dead (dashboard restarted while the child was live).
    if (entry.state === "stopping") return "stopped";
    return "crashed";
  }

  // Should not reach here (all states covered).
  return null;
}

/**
 * Runs reconcile over all registry entries at dashboard startup.
 * Updates the registry for entries whose state no longer matches reality.
 * Returns the list of instanceIds that were changed.
 */
export function reconcileAll(registry: PidRegistry): string[] {
  const changed: string[] = [];
  for (const entry of registry.list()) {
    const newState = reconcileEntry(entry);
    if (newState) {
      registry.update(entry.instanceId, { state: newState, pid: null });
      changed.push(entry.instanceId);
    }
  }
  return changed;
}

/**
 * Manually resolves an instance's state (POST /instances/:id/resolve).
 * Re-checks the PID: if alive → `running` (adopt); if dead → `crashed`.
 * Returns the resolved state.
 */
export function resolveInstance(
  registry: PidRegistry,
  instanceId: string,
): InstanceState {
  const entry = registry.get(instanceId);
  if (!entry) {
    throw new Error(`instance not found: ${instanceId}`);
  }
  const alive = entry.pid !== null && isPidAlive(entry.pid);
  const newState: InstanceState = alive ? "running" : "crashed";
  registry.update(instanceId, {
    state: newState,
    pid: alive ? entry.pid : null,
  });
  return newState;
}
