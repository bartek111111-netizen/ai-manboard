/**
 * Instance endpoints (Faza 5.4 + 6.3, PLAN §14.1):
 * - `GET  /api/v1/instances`              → list (state, port, pid)
 * - `GET  /api/v1/instances/:instanceId`            → full DTO (§14.2)
 * - `GET  /api/v1/instances/:instanceId/metrics`    → runtime metrics
 * - `GET  /api/v1/instances/:instanceId/logs`       → recent log lines (`?limit=`)
 * - `POST /api/v1/instances/:instanceId/start`    → start (validate → spawn → probe → running)
 * - `POST /api/v1/instances/:instanceId/stop`     → stop (grace)
 * - `POST /api/v1/instances/:instanceId/restart`  → restart
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { InstanceState } from '@ai-dashboard/shared';
import type { LifecycleManager } from '../../core/process/lifecycle.js';

const param = (request: FastifyRequest): string =>
  String((request.params as Record<string, string>).instanceId);

export function makeInstanceHandlers(lifecycle: LifecycleManager) {
  return {
    /** GET /api/v1/instances */
    list: async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.send({ instances: lifecycle.listInstances() });
    },

    /** GET /api/v1/instances/:instanceId → full DTO (Faza 6.3, §14.2). */
    get: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const instanceId = param(request);
      reply.send(await lifecycle.getFullDto(instanceId));
    },

    /** GET /api/v1/instances/:instanceId/metrics (Faza 6.3). */
    metrics: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const instanceId = param(request);
      reply.send(await lifecycle.getMetrics(instanceId));
    },

    /** GET /api/v1/instances/:instanceId/logs?limit= (Faza 6.3). */
    logs: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const instanceId = param(request);
      const query = request.query as { limit?: string };
      const limit = query.limit ? Number(query.limit) : undefined;
      reply.send({ instanceId, lines: lifecycle.getLogs(instanceId, limit) });
    },

    /** POST /api/v1/instances/:instanceId/start → `starting` (probe settles in background). */
    start: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const instanceId = param(request);
      const state: InstanceState = await lifecycle.start(instanceId);
      reply.send({ instanceId, state });
    },

    /** POST /api/v1/instances/:instanceId/stop → `stopped` (grace). */
    stop: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const instanceId = param(request);
      await lifecycle.stop(instanceId);
      reply.send({ instanceId, state: lifecycle.getState(instanceId) });
    },

    /** POST /api/v1/instances/:instanceId/restart → new `starting`. */
    restart: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const instanceId = param(request);
      const state: InstanceState = await lifecycle.restart(instanceId);
      reply.send({ instanceId, state });
    },
  };
}
