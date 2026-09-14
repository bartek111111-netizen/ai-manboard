/**
 * Logs API: GET /api/v1/models/:id/logs — list run logs.
 * GET /api/v1/models/:id/logs/:file — read a specific log.
 * DELETE /api/v1/models/:id/logs — clear all logs for a model.
 */
import { FastifyInstance } from 'fastify';
import { listRunLogs, readRunLog, deleteRunLog, clearModelLogs, writeRunLog } from '../../core/logs/store.js';

export function registerLogsHandler(app: FastifyInstance): void {
  app.get<{ params: { id: string } }>(
    '/api/v1/models/:id/logs',
    (req, reply) => {
      const logs = listRunLogs(req.params.id);
      return reply.send({ logs });
    },
  );

  app.post<{ params: { id: string }; body: { content: string } }>(
    '/api/v1/models/:id/logs',
    (req, reply) => {
      const filePath = writeRunLog(req.params.id, req.body.content);
      return reply.send({ ok: true, file: filePath.split('/').pop() ?? null });
    },
  );

  app.get<{ params: { id: string; file: string } }>(
    '/api/v1/models/:id/logs/:file',
    (req, reply) => {
      const content = readRunLog(req.params.id, req.params.file);
      if (content === null) {
        return reply.status(404).send({ error: { code: 'LOG_NOT_FOUND', message: `log not found: ${req.params.file}` } });
      }
      return reply.send({ file: req.params.file, content });
    },
  );

  app.delete<{ params: { id: string; file: string } }>(
    '/api/v1/models/:id/logs/:file',
    (req, reply) => {
      deleteRunLog(req.params.id, req.params.file);
      return reply.send({ ok: true });
    },
  );

  app.delete<{ params: { id: string } }>(
    '/api/v1/models/:id/logs',
    (req, reply) => {
      clearModelLogs(req.params.id);
      return reply.send({ ok: true });
    },
  );
}
