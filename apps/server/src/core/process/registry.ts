/**
 * PID registry (PLAN §11.3, FP-7) — Faza 4.
 *
 * `state/registry.json` holds one entry per known instance. It is written
 * **atomically on every state transition** so that, after a dashboard restart,
 * reconcile can tell `crashed` / `stopped` / `unknown` apart (by the stored
 * `lastExitCode` / `signal`).
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from '@ai-dashboard/shared';
import { assertSafeId } from '../config/store.js';
import type { DashboardHome } from '../config/paths.js';
import type { InstanceState } from '@ai-dashboard/shared';

/** One entry in `state/registry.json`. */
export interface RegistryEntry {
  instanceId: string;
  /** PID of the spawned child (null once the process is gone). */
  pid: number | null;
  port: number;
  state: InstanceState;
  /** ISO timestamp of the most recent `start`. */
  startedAt: string;
  /** Exit code of the last abnormal/clean exit (null = never exited since start). */
  lastExitCode: number | null;
  /** Signal that ended the process (e.g. `SIGKILL`), when relevant. */
  lastSignal?: string;
}

interface RegistryFile {
  instances: Record<string, RegistryEntry>;
}

/** Loads (or initializes) the registry file without validation errors leaking. */
function readRegistry(file: string): RegistryFile {
  if (!existsSync(file)) return { instances: {} };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const instances = (raw?.instances ?? {}) as Record<string, RegistryEntry>;
    return { instances };
  } catch {
    // A corrupt registry must not crash boot; treat as empty (reconcile rebuilds it).
    return { instances: {} };
  }
}

/** Atomic write: tmp file in the same directory → fsync → rename. */
function atomicWrite(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  const handle = openSync(tmp, 'w');
  try {
    writeSync(handle, content);
  } finally {
    closeSync(handle);
  }
  renameSync(tmp, file);
}

export class PidRegistry {
  readonly file: string;

  constructor(readonly home: DashboardHome) {
    this.file = `${home.stateDir}/registry.json`;
  }

  /** All registered entries, ordered by instanceId. */
  list(): RegistryEntry[] {
    const entries = Object.values(readRegistry(this.file).instances);
    entries.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    return entries;
  }

  /** The entry for `instanceId`, or null when absent. */
  get(instanceId: string): RegistryEntry | null {
    assertSafeId(instanceId, 'instanceId');
    return readRegistry(this.file).instances[instanceId] ?? null;
  }

  /** Records an entry (full replace) — one atomic write. */
  set(instanceId: string, entry: RegistryEntry): void {
    assertSafeId(instanceId, 'instanceId');
    const file: RegistryFile = readRegistry(this.file);
    file.instances[instanceId] = entry;
    atomicWrite(this.file, file);
  }

  /**
   * Patches the existing entry (used to update `state` on every transition).
   * Creates the entry if absent.
   */
  update(instanceId: string, patch: Partial<RegistryEntry>): void {
    assertSafeId(instanceId, 'instanceId');
    const file = readRegistry(this.file);
    const current: RegistryEntry = file.instances[instanceId] ?? {
      instanceId,
      pid: null,
      port: 0,
      state: 'stopped',
      startedAt: new Date(0).toISOString(),
      lastExitCode: null,
    };
    const merged: RegistryEntry = { ...current, ...patch, instanceId };
    file.instances[instanceId] = merged;
    atomicWrite(this.file, file);
  }

  /** Drops the entry (instance removed from the dashboard). */
  remove(instanceId: string): void {
    assertSafeId(instanceId, 'instanceId');
    const file = readRegistry(this.file);
    if (!(instanceId in file.instances)) return;
    delete file.instances[instanceId];
    atomicWrite(this.file, file);
  }

  /** Ports currently claimed by any registered instance (for `ports.ts`). */
  takenPorts(): number[] {
    return this.list()
      .filter((e) => e.state !== 'stopped' || e.pid !== null)
      .map((e) => e.port);
  }

  /** True if `instanceId` is registered. */
  has(instanceId: string): boolean {
    try {
      return this.get(instanceId) !== null;
    } catch (err) {
      if (err instanceof AppError) return false;
      throw err;
    }
  }
}
