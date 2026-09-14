import { existsSync, readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type LogLevel } from 'fastify';
import fastifyStatic from '@fastify/static';
import { AppError, type ConfigWatchState } from '@ai-dashboard/shared';
import { makeStatusHandler } from './api/handlers/status.js';
import { makeConfigHandlers } from './api/handlers/config.js';
import { makeEngineHandlers } from './api/handlers/engines.js';
import { makeAuthMiddleware } from './api/auth.js';
import { makeModelHandlers } from './api/handlers/models.js';
import { makePresetHandlers } from './api/handlers/presets.js';
import { makeSseHandlers } from './api/handlers/sse.js';
import { makeInstanceHandlers } from './api/handlers/instances.js';
import { systemMetricsHandler } from './api/handlers/system.js';
import { gpusHandler } from './api/handlers/gpus.js';
import { browseHandler } from './api/handlers/browse.js';
import type { SseHub } from './core/sse/hub.js';
import type { ProcessManager } from './core/process/manager.js';
import type { ConfigStore } from './core/config/store.js';
import type { LifecycleManager } from './core/process/lifecycle.js';
import { WEB_DIST_DIR } from './web-dist.js';

export interface BuildAppOptions {
  /** Web app build directory to serve (production mode); skipped when missing. */
  staticDir?: string;
  /** Config store over `~/.ai-dashboard` (Faza 1). */
  store: ConfigStore;
  /** Live config watch state (P-12) — shared with the runtime watcher. */
  getConfigState: () => ConfigWatchState;
  /**
   * Lifecycle manager (Faza 5) — when present, the `/instances` routes are
   * registered. Omitted in tests that only exercise the config/model APIs.
   */
  lifecycle?: LifecycleManager;
  /** SSE hub + process manager → registers the `stream/*` routes (Faza 6.2). */
  sse?: SseHub;
  manager?: ProcessManager;
  /** Returns the configured token hash (SHA-256) or null (auth off) (S-2). */
  getTokenHash?: () => string | null;
}

/**
 * Builds the Fastify app: API routes + (in production) the built web UI.
 * Kept separate from index.ts so it can be exercised in tests (vitest).
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const logLevel = process.env.AI_DASHBOARD_LOG_LEVEL;
  const app = Fastify({
    logger: logLevel ? { level: logLevel as LogLevel } : false,
  });

  // Errors → unified `{"error": {...}}` envelope (PLAN §14, §21).
  app.setErrorHandler((err, _request, reply) => {
    if (reply.sent) return;
    const error =
      err instanceof AppError
        ? err
        : new AppError('INTERNAL', err instanceof Error ? err.message : 'internal error', undefined, 500);
    reply.code(error.status).send(error.toBody());
  });

  // Bearer-token auth (Faza 6.4, S-2): only when a token hash is configured.
  if (options.getTokenHash) {
    const authMiddleware = makeAuthMiddleware(options.getTokenHash);
    app.addHook('onRequest', authMiddleware);
  }

  // API.
  const { store, getConfigState } = options;
  const configHandlers = makeConfigHandlers(store, getConfigState);
  const engineHandlers = makeEngineHandlers(store);
  const modelHandlers = makeModelHandlers(store);
  const presetHandlers = makePresetHandlers(store);
  app.get('/api/v1/status', makeStatusHandler(getConfigState));
  app.get('/api/v1/config', configHandlers.getConfig);
  app.put('/api/v1/config/global', configHandlers.putGlobalConfig);
  app.get('/api/v1/engines', engineHandlers.getEngines);
  app.get('/api/v1/engines/:id/schema', engineHandlers.getEngineSchema);
  app.put('/api/v1/engines/:id', engineHandlers.putEngine);
  app.get('/api/v1/engines/:id/check', engineHandlers.checkEngine);
  app.get('/api/v1/models', modelHandlers.listModels);
  app.post('/api/v1/models/discover', modelHandlers.discover);
  app.post('/api/v1/models', modelHandlers.addModel);
  app.get('/api/v1/models/:modelId', modelHandlers.getModel);
  app.patch('/api/v1/models/:modelId', modelHandlers.updateModel);
  app.delete('/api/v1/models/:modelId', modelHandlers.removeModel);
  // Presets CRUD (Faza 6.1).
  app.get('/api/v1/models/:modelId/presets', presetHandlers.list);
  app.put('/api/v1/models/:modelId/presets/:name', presetHandlers.put);
  app.delete('/api/v1/models/:modelId/presets/:name', presetHandlers.remove);
  app.post('/api/v1/models/:modelId/presets/:name/duplicate', presetHandlers.duplicate);
  // Instances (Faza 5): only when the lifecycle manager is wired in.
  if (options.lifecycle) {
    const instanceHandlers = makeInstanceHandlers(options.lifecycle);
    app.get('/api/v1/instances', instanceHandlers.list);
    app.get('/api/v1/instances/:instanceId', instanceHandlers.get);
    app.get('/api/v1/instances/:instanceId/metrics', instanceHandlers.metrics);
    app.get('/api/v1/instances/:instanceId/logs', instanceHandlers.logs);
    app.post('/api/v1/instances/:instanceId/start', instanceHandlers.start);
    app.post('/api/v1/instances/:instanceId/stop', instanceHandlers.stop);
    app.post('/api/v1/instances/:instanceId/restart', instanceHandlers.restart);
    app.post('/api/v1/instances/:instanceId/resolve', instanceHandlers.resolve);
  }
  // SSE streams (Faza 6.2): only when the hub + manager are wired in.
  if (options.sse && options.manager) {
    const sseHandlers = makeSseHandlers(options.sse, options.manager);
    app.get('/api/v1/stream/:instanceId/logs', sseHandlers.logs);
    app.get('/api/v1/stream/events', sseHandlers.events);
  }
  // System metrics (GPU/CPU/RAM) — Faza 10+.
  app.get('/api/v1/system/metrics', systemMetricsHandler);
  app.get('/api/v1/gpus', gpusHandler);
  app.get('/api/v1/browse', browseHandler);
  // Plain liveness check (the token middleware from phase 6 will cover the API).
  app.get('/healthz', async () => ({ ok: true }));

  const distDir = options.staticDir ?? WEB_DIST_DIR;
  const distExists = existsSync(distDir);

  if (distExists) {
    // Vite is built with `base: './'`, so assets are referenced relatively;
    // we serve them under /assets and the SPA entry (index.html) at `/`.
    // Hash routing means a single entry point is enough — no history fallback.
    app.get('/', (_request, reply) => {
      reply
        .type('text/html; charset=utf-8')
        .send(readFileSync(`${distDir}/index.html`, 'utf-8'));
    });
    await app.register(fastifyStatic, { root: distDir });
  } else {
    // Dev mode: the Vite dev server (port 5173) serves the UI and proxies /api.
    app.get('/', (_request, reply) => {
      reply.type('application/json').send({
        name: 'ai-dashboard-server',
        message:
          'API is running. The built web UI was not found — start the dev server (npm run dev) and open http://127.0.0.1:5173',
      });
    });
  }

  return app;
}
