import type { FastifyReply, FastifyRequest } from "fastify";
import {
  APP_NAME,
  APP_VERSION,
  type ConfigWatchState,
} from "@ai-dashboard/shared";

/**
 * GET /api/v1/status — dashboard state.
 * Phase 1: adds the config watch state (P-12 UI warning source).
 * Engines (with binaries + availability) arrive in phase 2; instances and
 * monitoring in later phases.
 */
export function makeStatusHandler(getConfigState?: () => ConfigWatchState) {
  return async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send({
      name: APP_NAME,
      version: APP_VERSION,
      state: "running",
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      engines: [],
      config: getConfigState ? getConfigState() : undefined,
    });
  };
}
