import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LaunchCommand } from '@ai-dashboard/shared';
import { ensureHome, resolveHome, type DashboardHome } from '../config/paths.js';
import { LogWriter } from '../logs/writer.js';
import { ProcessManager } from './manager.js';
import { PidRegistry } from './registry.js';

/** A throwaway `~/.ai-dashboard` under /tmp, with a manager wired to it. */
function tempManager(stopTimeoutSec = 3): {
  manager: ProcessManager;
  registry: PidRegistry;
  home: DashboardHome;
} {
  const root = mkdtempSync(join(tmpdir(), 'ai-dashboard-manager-'));
  const home = resolveHome(root);
  ensureHome(home);
  const registry = new PidRegistry(home);
  const logs = new LogWriter({
    logsDir: home.logsDir,
    retentionFiles: 10,
    maxFileBytes: 10 * 1024 * 1024,
  });
  const manager = new ProcessManager({ registry, logs, stopTimeoutSec, ringLines: 100 });
  return { manager, registry, home };
}

/** Runs `node -e <code>` as the dummy instance process (cross-platform). */
const dummy = (cwd: string, code: string): LaunchCommand => ({
  binary: process.execPath,
  args: ['-e', code],
  cwd,
  env: {},
});

/** Polls until `predicate` is true or `timeoutMs` elapses. */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('ProcessManager (PLAN §11.5, §11.2, TT-9)', () => {
  it('spawn → starting; stop → stopped (grace), and the child is gone', async () => {
    const { manager, registry, home } = tempManager();
    const pid = await manager.spawn('m--x', dummy(home.root, 'setTimeout(()=>{},60000)'), 8081);
    expect(pid).toBeGreaterThan(0);
    expect(manager.getState('m--x')).toBe('starting');
    expect(registry.get('m--x')?.state).toBe('starting');

    await manager.stop('m--x');
    expect(manager.getState('m--x')).toBe('stopped');
    expect(registry.get('m--x')?.state).toBe('stopped');
    // The child no longer exists (ESRCH on a kill probe).
    let dead = true;
    try {
      process.kill(pid, 0);
      dead = false;
    } catch {
      /* ESRCH = gone */
    }
    expect(dead).toBe(true);
  });

  it('watchdog: a process that exits abnormally (code ≠ 0) → crashed', async () => {
    const { manager, registry, home } = tempManager();
    await manager.spawn('m--crash', dummy(home.root, 'process.exit(3)'), 8081);
    await manager.awaitExit('m--crash', 5000);
    expect(manager.getState('m--crash')).toBe('crashed');
    expect(registry.get('m--crash')?.lastExitCode).toBe(3);
  });

  it('records lastExitCode and lands on stopped for a clean self-exit', async () => {
    const { manager, registry, home } = tempManager();
    await manager.spawn('m--clean', dummy(home.root, 'process.exit(0)'), 8081);
    await manager.awaitExit('m--clean', 5000);
    expect(manager.getState('m--clean')).toBe('stopped');
    expect(registry.get('m--clean')?.lastExitCode).toBe(0);
  });

  it('spawn failure (missing binary) settles on error', async () => {
    const { manager, home } = tempManager();
    await manager.spawn('m--bad', { binary: '/nonexistent/binary', args: [], cwd: home.root, env: {} }, 8081);
    await manager.awaitExit('m--bad', 4000);
    expect(['error', 'crashed']).toContain(manager.getState('m--bad'));
  });

  it('captures stdout/stderr into the ring buffer and the disk log', async () => {
    const { manager, home } = tempManager();
    await manager.spawn(
      'm--logs',
      dummy(home.root, "console.log('hello'); console.error('oops'); setTimeout(()=>{},3000)"),
      8081,
    );
    await waitFor(() => manager.getLogs('m--logs').length >= 2, 4000);
    const lines = manager.getLogs('m--logs').map((l) => l.line);
    expect(lines).toContain('hello');
    expect(lines).toContain('oops');
    await manager.stop('m--logs');
  });
});
