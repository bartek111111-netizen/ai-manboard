import { existsSync, readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type LogLevel } from 'fastify';
import fastifyStatic from '@fastify/static';
import { statusHandler } from './api/handlers/status.js';
import { WEB_DIST_DIR } from './web-dist.js';

export interface BuildAppOptions {
  /** Web app build directory to serve (production mode); skipped when missing. */
  staticDir?: string;
}

/**
 * Builds the Fastify app: API routes + (in production) the built web UI.
 * Kept separate from index.ts so it can be exercised in tests (vitest).
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const logLevel = process.env.AI_DASHBOARD_LOG_LEVEL;
  const app = Fastify({
    logger: logLevel ? { level: logLevel as LogLevel } : false,
  });

  // API (phase 0: status only; more routes are added in later phases).
  app.get('/api/v1/status', statusHandler);
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
