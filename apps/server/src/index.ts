import { buildApp } from './app.js';
import { loadEnv } from './env.js';

/**
 * Boot (phase 0): env → app (API + static web).
 * Phases 1–5 add the config store, engines, model registry and the
 * process manager before the app starts serving (PLAN.md §22).
 */
const env = loadEnv();
const app = await buildApp();

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dashboard] ${signal} — shutting down`);
  // Graceful stop of running model instances (phases 4–5) goes here.
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.host, port: env.port });
console.log(`[dashboard] listening on http://${env.host}:${env.port}`);
