/**
 * Model endpoints (Faza 3, PLAN §14.1):
 * - `GET  /api/v1/models`                → list (status, capabilities, size, engine)
 * - `POST /api/v1/models/discover`       → rescan modelDirs (FM-2)
 * - `POST /api/v1/models`                → manual add (FM-3, the only path input)
 * - `GET  /api/v1/models/:modelId`       → details (metadata + config)
 * - `PATCH /api/v1/models/:modelId`      → edit metadata/capabilities/params (FM-5/6)
 * - `DELETE /api/v1/models/:modelId`     → remove from dashboard, not the file (FM-8)
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AddModelRequest, UpdateModelRequest } from "@ai-dashboard/shared";
import { listEngines } from "@ai-dashboard/shared/engine";
import type { ConfigStore } from "../../core/config/store.js";
import { ModelRegistry } from "../../core/model/registry.js";

export function makeModelHandlers(store: ConfigStore) {
  const registry = new ModelRegistry(store, listEngines());

  return {
    /** GET /api/v1/models */
    listModels: async (
      _request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      reply.send({ models: registry.list() });
    },

    /** POST /api/v1/models/discover — trigger a rescan (FM-2). */
    discover: async (
      _request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      reply.send(registry.discover());
    },

    /** POST /api/v1/models — manual add (FM-3). */
    addModel: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const body = request.body as AddModelRequest;
      const view = registry.add(body);
      reply.code(201).send(view);
    },

    /** GET /api/v1/models/:modelId — details. */
    getModel: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const id = String((request.params as Record<string, string>).modelId);
      reply.send(registry.get(id));
    },

    /** PATCH /api/v1/models/:modelId — manual edit (FM-5/6). */
    updateModel: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const id = String((request.params as Record<string, string>).modelId);
      const body = request.body as UpdateModelRequest;
      reply.send(registry.update(id, body));
    },

    /** DELETE /api/v1/models/:modelId — remove from the dashboard (FM-8). */
    removeModel: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const id = String((request.params as Record<string, string>).modelId);
      registry.remove(id);
      reply.send({ ok: true, id });
    },

    /** PATCH /api/v1/models/:modelId/hide — hide or unhide a model. */
    setHidden: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const id = String((request.params as Record<string, string>).modelId);
      const body = request.body as { hidden: boolean };
      reply.send(registry.setHidden(id, body.hidden));
    },

    /** GET /api/v1/models/hidden — list hidden models. */
    listHidden: async (
      _request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      reply.send({ models: registry.listHidden() });
    },
  };
}
