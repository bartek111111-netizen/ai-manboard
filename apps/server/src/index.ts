/**
 * Boot (Faza 1): env → home (ensure + seed) → config store (validated)
 * → fs watch on config/ (P-12) → app (API + static web).
 */
import { createHash } from 'node:crypto';
import type { ConfigSnapshot, ConfigWatchState } from '@ai-dashboard/shared';
import { listEngines } from '@ai-dashboard/shared/engine';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { ensureHome, resolveHome } from './core/config/paths.js';
import { ConfigStore } from './core/config/store.js';
import { ConfigWatcher } from './core/config/watcher.js';
import { HealthProber } from './core/health/prober.js';
import { LogWriter } from './core/logs/writer.js';
import { LifecycleManager } from './core/process/lifecycle.js';
import { ProcessManager } from './core/process/manager.js';
import { PidRegistry } from './core/process/registry.js';
import { WEB_DIST_DIR } from './web-dist.js';

function snapshotHash(snapshot: ConfigSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

async function main(): Promise<void> {
  const env = loadEnv();
  const home = resolveHome(env.home);
  ensureHome(home);
  const store = new ConfigStore(home);

  // PLAN §15: a corrupt/invalid config is a hard startup error with a clear
  // message — never a silent overwrite.
  try {
    store.readGlobal(); // seeds global.json on first run
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`[dashboard] config error — not starting: ${message}`);
    process.exitCode = 1;
    return;
  }

  const configState: ConfigWatchState = {
    home: home.root,
    watchActive: true,
    lastExternalChangeAt: null,
    reloadCount: 0,
    lastReloadError: null,
  };

  // P-12: watch config/ (fs watch + debounce) → reload + UI warning.
  let lastHash = snapshotHash(store.snapshot());
  const watcher = new ConfigWatcher(store, () => {
    try {
      const snapshot = store.snapshot();
      const hash = snapshotHash(snapshot);
      if (hash !== lastHash) {
        lastHash = hash;
        configState.lastExternalChangeAt = new Date().toISOString();
        configState.reloadCount += 1;
        configState.lastReloadError = null;
        console.log(`[dashboard] config reloaded from disk (count=${configState.reloadCount})`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      configState.lastReloadError = message;
      console.error(`[dashboard] config reload failed: ${message}`);
    }
  });
  watcher.start();

  // Faza 5: process lifecycle (start/stop/restart + health).
  const registry = new PidRegistry(home);
  const logs = new LogWriter({
    logsDir: home.logsDir,
    retentionFiles: 10,
    maxFileBytes: 10_000_000,
  });
  const manager = new ProcessManager({ registry, logs, ringLines: 1000, stopTimeoutSec: 10 });
  const prober = new HealthProber();
  const lifecycle = new LifecycleManager({ store, engines: listEngines(), manager, registry, prober, logs });

  const app = await buildApp({
    store,
    getConfigState: () => configState,
    staticDir: WEB_DIST_DIR,
    lifecycle,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[dashboard] ${signal} — shutting down`);
    watcher.stop();
    configState.watchActive = false;
    lifecycle.shutdown();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.host, port: env.port });
  console.log(`[dashboard] listening on http://${env.host}:${env.port} (config: ${home.root})`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'unknown error';
  console.error(`[dashboard] boot failed: ${message}`);
  process.exit(1);
});
