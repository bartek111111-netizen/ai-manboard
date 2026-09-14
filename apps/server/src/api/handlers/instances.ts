/**
 * Instance endpoints (Faza 5.4, PLAN §14.1):
 * - `GET  /api/v1/instances`              → list (state, port, pid)
 * - `POST /api/v1/instances/:instanceId/start`    → start (validate → spawn → probe → running)
 * - `POST /api/v1/instances/:instanceId/stop`     → stop (grace)
 * - `POST /api/v1/instances/:instanceId/restart`  → restart
 *
 * The full per-instance DTO (`GET /instances/:id`, metrics, logs) is Faza 6.3.
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
