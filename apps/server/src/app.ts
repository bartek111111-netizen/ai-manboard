import { existsSync, readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type LogLevel } from 'fastify';
import fastifyStatic from '@fastify/static';
import { AppError, type ConfigWatchState } from '@ai-dashboard/shared';
import { makeStatusHandler } from './api/handlers/status.js';
import { makeConfigHandlers } from './api/handlers/config.js';
import { makeEngineHandlers } from './api/handlers/engines.js';
import { makeModelHandlers } from './api/handlers/models.js';
import type { ConfigStore } from './core/config/store.js';
import { WEB_DIST_DIR } from './web-dist.js';

export interface BuildAppOptions {
  /** Web app build directory to serve (production mode); skipped when missing. */
  staticDir?: string;
  /** Config store over `~/.ai-dashboard` (Faza 1). */
  store: ConfigStore;
  /** Live config watch state (P-12) — shared with the runtime watcher. */
  getConfigState: () => ConfigWatchState;
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

  // API.
  const { store, getConfigState } = options;
  const configHandlers = makeConfigHandlers(store, getConfigState);
  const engineHandlers = makeEngineHandlers(store);
  const modelHandlers = makeModelHandlers(store);
  app.get('/api/v1/status', makeStatusHandler(getConfigState));
  app.get('/api/v1/config', configHandlers.getConfig);
  app.put('/api/v1/config/global', configHandlers.putGlobalConfig);
  app.get('/api/v1/engines', engineHandlers.getEngines);
  app.get('/api/v1/engines/:id/schema', engineHandlers.getEngineSchema);
  app.put('/api/v1/engines/:id', engineHandlers.putEngine);
  app.get('/api/v1/models', modelHandlers.listModels);
  app.post('/api/v1/models/discover', modelHandlers.discover);
  app.post('/api/v1/models', modelHandlers.addModel);
  app.get('/api/v1/models/:modelId', modelHandlers.getModel);
  app.patch('/api/v1/models/:modelId', modelHandlers.updateModel);
  app.delete('/api/v1/models/:modelId', modelHandlers.removeModel);
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
    await app.register(fastifyStatic, { root: distDir, prefix: '/assets' });
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
