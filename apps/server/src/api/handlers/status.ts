import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_NAME, APP_VERSION } from '@ai-dashboard/shared';

/**
 * GET /api/v1/status — dashboard state.
 * Phase 0: basic fields only. Engines (with binaries + availability)
 * are added in phase 2; instances and monitoring in later phases.
 */
export async function statusHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const uptimeSec = Math.floor(process.uptime());
  reply.send({
    name: APP_NAME,
    version: APP_VERSION,
    state: 'running',
    uptimeSec,
    timestamp: new Date().toISOString(),
    engines: [],
  });
}
