/**
 * Logs API: GET /api/v1/models/:id/logs — list run logs.
 * GET /api/v1/models/:id/logs/:file — read a specific log.
 * DELETE /api/v1/models/:id/logs — clear all logs for a model.
 */
import { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listRunLogs, readRunLog, deleteRunLog, clearModelLogs, writeManualLog, writeAutoLog, logDir } from '../../core/logs/store.js';

export function registerLogsHandler(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/api/v1/models/:id/logs',
    (req, reply) => {
      const logs = listRunLogs(req.params.id);
      return reply.send({ logs });
    },
  );

  app.post<{ Params: { id: string }; Body: { content: string; auto?: boolean } }>(
    '/api/v1/models/:id/logs',
    (req, reply) => {
      const writeFn = req.body.auto ? writeAutoLog : writeManualLog;
      const filePath = writeFn(req.params.id, req.body.content);
      return reply.send({ ok: true, file: filePath.split('/').pop() ?? null });
    },
  );

  app.get<{ Params: { id: string; file: string } }>(
    '/api/v1/models/:id/logs/:file',
    (req, reply) => {
      const content = readRunLog(req.params.id, req.params.file);
      if (content === null) {
        return reply.status(404).send({ error: { code: 'LOG_NOT_FOUND', message: `log not found: ${req.params.file}` } });
      }
      return reply.send({ file: req.params.file, content });
    },
  );

  /** Opens a run log in the host's default editor (Linux `xdg-open`). */
  app.post<{ Params: { id: string; file: string } }>(
    '/api/v1/models/:id/logs/:file/open',
    (req, reply) => {
      const filePath = join(logDir(req.params.id), req.params.file);
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: { code: 'LOG_NOT_FOUND', message: `log not found: ${req.params.file}` } });
      }
      const child = spawn('xdg-open', [filePath], { detached: true });
      child.on('error', () => {
        /* best-effort — the file exists but the opener may be missing */
      });
      child.unref();
      return reply.send({ ok: true, path: filePath });
    },
  );

  app.delete<{ Params: { id: string; file: string } }>(
    '/api/v1/models/:id/logs/:file',
    (req, reply) => {
      deleteRunLog(req.params.id, req.params.file);
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/models/:id/logs',
    (req, reply) => {
      clearModelLogs(req.params.id);
      return reply.send({ ok: true });
    },
  );
}
