/**
 * Preset endpoints (Faza 6.1, PLAN §14.1):
 * - `GET    /api/v1/models/:modelId/presets`              → list
 * - `PUT    /api/v1/models/:modelId/presets/:name`        → create/update (validate)
 * - `DELETE /api/v1/models/:modelId/presets/:name`        → delete
 * - `POST   /api/v1/models/:modelId/presets/:name/duplicate` → clone under a new name
 *
 * The `name` in the path is the source of truth; the body's `name` (if present)
 * is ignored on PUT (the file name wins). Errors use the standard envelope.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, validatePreset, type Preset } from '@ai-dashboard/shared';
import { assertSafeId, type ConfigStore } from '../../core/config/store.js';

/** The `:name` param (always present on the `:name` routes); throws if missing. */
function nameParam(request: FastifyRequest): string {
  const name = (request.params as Record<string, string>).name;
  if (!name) throw new AppError('VALIDATION_FAILED', 'preset name is required', undefined, 400);
  return name;
}

function modelParams(request: FastifyRequest): { modelId: string; name?: string } {
  const params = request.params as Record<string, string>;
  return { modelId: params.modelId, name: params.name };
}

function requireModel(store: ConfigStore, modelId: string): void {
  if (!store.readModel(modelId)) {
    throw new AppError('MODEL_NOT_FOUND', `model not found: ${modelId}`, { modelId }, 404);
  }
}

export function makePresetHandlers(store: ConfigStore) {
  return {
    /** GET /api/v1/models/:modelId/presets */
    list: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { modelId } = modelParams(request);
      requireModel(store, modelId);
      const presets = store.listPresets(modelId).map((name) => store.readPreset(modelId, name)!);
      reply.send({ presets });
    },

    /** PUT /api/v1/models/:modelId/presets/:name — create/update. */
    put: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { modelId } = modelParams(request);
      const name = nameParam(request);
      requireModel(store, modelId);
      assertSafeId(name, 'presetName');
      const body = (request.body ?? {}) as Record<string, unknown>;
      // If the body doesn't include params, preserve the existing ones.
      const existing = store.readPreset(modelId, name);
      const preset: Preset = validatePreset(
        { version: 1, params: existing?.params ?? {}, ...body, name },
        name,
      );
      store.writePreset(modelId, name, preset);
      reply.send(preset);
    },

    /** DELETE /api/v1/models/:modelId/presets/:name */
    remove: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { modelId } = modelParams(request);
      const name = nameParam(request);
      requireModel(store, modelId);
      if (!store.readPreset(modelId, name)) {
        throw new AppError('PRESET_NOT_FOUND', `preset not found: ${name}`, { modelId, presetName: name }, 404);
      }
      store.deletePreset(modelId, name);
      reply.send({ ok: true, modelId, presetName: name });
    },

    /** POST /api/v1/models/:modelId/presets/:name/duplicate — body `{ name }`. */
    duplicate: async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { modelId } = modelParams(request);
      const name = nameParam(request);
      requireModel(store, modelId);
      const source = store.readPreset(modelId, name);
      if (!source) {
        throw new AppError('PRESET_NOT_FOUND', `preset not found: ${name}`, { modelId, presetName: name }, 404);
      }
      const body = (request.body ?? {}) as { name?: string };
      const newName = body.name ?? `${name}-copy`;
      assertSafeId(newName, 'presetName');
      const copy: Preset = validatePreset({ ...source, name: newName }, newName);
      store.writePreset(modelId, newName, copy);
      reply.code(201).send(copy);
    },
  };
}
