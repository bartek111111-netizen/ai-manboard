/**
 * Config endpoints (Faza 1.4, PLAN §14.1):
 * - `GET  /api/v1/config`          → all layers + effective merge + watch state
 * - `PUT  /api/v1/config/global`   → partial update of global.json
 *   (validation + atomic write; errors → standard envelope)
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { mergeGlobalConfig, type ConfigResponse, type ConfigWatchState } from '@ai-dashboard/shared';
import { schemaDefaultsMap } from './engines.js';
import { buildEffective } from '../../core/config/layers.js';
import type { ConfigStore } from '../../core/config/store.js';

/**
 * Schema defaults (layer 1) for the effective merge — from the engine
 * registry (Faza 2). The registry is static per process, so this is cheap.
 */
function schemaDefaults(): Record<string, Record<string, unknown>> {
  return schemaDefaultsMap();
}

export function makeConfigHandlers(
  store: ConfigStore,
  getConfigState: () => ConfigWatchState,
) {
  return {
    /** GET /api/v1/config */
    getConfig: async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const snapshot = store.snapshot();
      const response: ConfigResponse = {
        ...snapshot,
        effective: buildEffective(snapshot, schemaDefaults()),
        state: getConfigState(),
      };
      reply.send(response);
    },

    /** PUT /api/v1/config/global — body: partial GlobalConfig. */
    putGlobalConfig: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const current = store.readGlobal();
      const merged = mergeGlobalConfig(current, request.body);
      store.writeGlobal(merged);
      reply.send(merged);
    },
  };
}
