/**
 * DSH (DeepSeek Harness) control: start/stop/status.
 * DSH is launched as a detached process so it persists after dashboard close.
 */
import { FastifyInstance } from 'fastify';
import { spawn, execSync } from 'node:child_process';

const DSH_COMMAND = 'pnpm';
const DSH_ARGS = ['dsh', 'web'];
const DSH_WORKDIR = '/home/bat/deepseek-harness';

/** Finds a running DSH process by its command line. */
function findDshProcess(): number | null {
  try {
    const out = execSync("ps -eo pid,args | grep -E 'dsh web|deepseek-harness' | grep -v grep", { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    for (const line of lines) {
      const pidMatch = line.trim().match(/^(\d+)\s+/);
      if (pidMatch) {
        return parseInt(pidMatch[1], 10);
      }
    }
    return null;
  } catch {
    return null; // no process found
  }
}

export function registerDshHandler(app: FastifyInstance): void {
  // GET /api/v1/dsh/status — check if DSH is running
  app.get('/api/v1/dsh/status', (_req, reply) => {
    const pid = findDshProcess();
    reply.send({ running: pid !== null, pid });
  });

  // POST /api/v1/dsh/start — start DSH (detached)
  app.post('/api/v1/dsh/start', (_req, reply) => {
    const existing = findDshProcess();
    if (existing) {
      return reply.send({ ok: true, message: 'DSH already running', pid: existing });
    }

    // Spawn detached process
    const child = spawn(DSH_COMMAND, DSH_ARGS, {
      cwd: DSH_WORKDIR,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    reply.send({ ok: true, message: 'DSH started', pid: child.pid });
  });

  // POST /api/v1/dsh/stop — kill DSH
  app.post('/api/v1/dsh/stop', (_req, reply) => {
    const pid = findDshProcess();
    if (!pid) {
      return reply.send({ ok: false, message: 'DSH not running' });
    }

    try {
      process.kill(pid, 'SIGTERM');
      reply.send({ ok: true, message: 'DSH stopped', pid });
    } catch (err) {
      reply.send({ ok: false, message: `Failed to kill: ${err instanceof Error ? err.message : String(err)}` });
    }
  });
}
