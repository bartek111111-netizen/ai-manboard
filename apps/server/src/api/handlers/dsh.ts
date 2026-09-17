/**
 * DSH (DeepSeek Harness) control: start/stop/status.
 *
 * DSH is launched with `pnpm dsh web` as a **detached** process, so the
 * wrapper becomes the leader of its own process group and the whole tree
 * (wrapper → DSH node server → Vite dev server) persists after the dashboard
 * closes. Stopping therefore kills that **process group** — killing only the
 * single matched pid (the old behaviour) left the real DSH server running as
 * an orphan, which is why "Stop" appeared to do nothing.
 */
import { FastifyInstance } from 'fastify';
import { spawn, execSync } from 'node:child_process';

const DSH_COMMAND = 'pnpm';
const DSH_ARGS = ['dsh', 'web'];
const DSH_WORKDIR = '/home/bat/deepseek-harness';

/**
 * Matches the running DSH tree. Broad enough to catch the `pnpm` wrapper
 * (`dsh web`) and, where it shows in argv, the CLI (`bin.ts web`) and the web
 * frontend. Each matched pid is paired with its process-group id (pgid).
 */
const PS_CMD =
  "ps -eo pid,pgid,args | grep -E 'dsh web|deepseek-harness|bin\\.ts web|dsh-web-frontend' | grep -v grep";

export interface DshProc {
  pid: number;
  pgid: number;
}

/**
 * Pure parser for `ps -eo pid,pgid,args` output: returns one entry per
 * distinct process group, in pid order. The `grep -v grep` line (and any
 * non-numeric line) is skipped.
 */
export function parseDshPs(out: string): DshProc[] {
  const seenPgid = new Set<number>();
  const found: DshProc[] = [];
  for (const raw of out.trim().split('\n')) {
    const m = raw.trim().match(/^(\d+)\s+(\d+)\s+/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const pgid = parseInt(m[2], 10);
    if (!seenPgid.has(pgid)) {
      seenPgid.add(pgid);
      found.push({ pid, pgid });
    }
  }
  return found;
}

/**
 * The kill target for a matched process. When it is its own group leader
 * (our detached spawn: `pid === pgid`), kill the whole group so no child is
 * orphaned. Otherwise (e.g. DSH started by hand in a terminal) kill just that
 * pid — reaching into someone else's group would kill unrelated processes.
 */
export function killTargetFor(proc: DshProc): number {
  return proc.pid === proc.pgid ? -proc.pgid : proc.pid;
}

function safeKill(target: number, signal: NodeJS.Signals): void {
  try {
    process.kill(target, signal);
  } catch {
    // The process (or group) already exited between discovery and the kill.
  }
}

function findDshProcesses(): DshProc[] {
  try {
    const out = execSync(PS_CMD, { encoding: 'utf8' });
    return parseDshPs(out);
  } catch {
    return []; // no DSH process found
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function registerDshHandler(app: FastifyInstance): void {
  // GET /api/v1/dsh/status — check if DSH is running
  app.get('/api/v1/dsh/status', (_req, reply) => {
    const procs = findDshProcesses();
    const pid = procs.length ? procs[0].pid : null;
    reply.send({ running: pid !== null, pid });
  });

  // POST /api/v1/dsh/start — start DSH (detached, its own process group)
  app.post('/api/v1/dsh/start', (_req, reply) => {
    const existing = findDshProcesses();
    if (existing.length) {
      return reply.send({ ok: true, message: 'DSH already running', pid: existing[0].pid });
    }

    const child = spawn(DSH_COMMAND, DSH_ARGS, {
      cwd: DSH_WORKDIR,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    reply.send({ ok: true, message: 'DSH started', pid: child.pid });
  });

  // POST /api/v1/dsh/stop — kill the DSH process group (SIGTERM, then SIGKILL)
  app.post('/api/v1/dsh/stop', async (_req, reply) => {
    const procs = findDshProcesses();
    if (!procs.length) {
      return reply.send({ ok: false, message: 'DSH not running' });
    }

    // 1) Graceful: SIGTERM each group/pid.
    for (const proc of procs) safeKill(killTargetFor(proc), 'SIGTERM');

    // 2) Escalate: SIGKILL any survivors after a short grace period so the
    //    button reliably stops DSH even if a process ignores SIGTERM.
    await sleep(3000);
    for (const proc of findDshProcesses()) safeKill(killTargetFor(proc), 'SIGKILL');

    reply.send({ ok: true, message: 'DSH stopped', pids: procs.map((p) => p.pid) });
  });
}
