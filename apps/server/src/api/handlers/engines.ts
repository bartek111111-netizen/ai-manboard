/**
 * Engine endpoints (Faza 2.5, PLAN §14.1):
 * - `GET /api/v1/engines`            → registered engines + resolved binary
 * - `GET /api/v1/engines/:id/schema` → declarative param schema (drives the UI form)
 * - `PUT /api/v1/engines/:id`        → set binary (validated: path, executable,
 *   `--version`, libvulkan) and/or engine-level params (validated against the schema)
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, validateParamsAgainstSchema } from "@ai-dashboard/shared";
import { getEngine, listEngines } from "@ai-dashboard/shared/engine";
import type { ConfigStore } from "../../core/config/store.js";

/** Builds `{ engineId: { [paramKey]: schema default } }` from the registry. */
export function schemaDefaultsMap(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const engine of listEngines()) {
    out[engine.id] = Object.fromEntries(
      engine.schema
        .filter((p) => p.default !== undefined)
        .map((p) => [p.key, p.default]),
    );
  }
  return out;
}

/** The engine config for `:id`, resolving the binary layer order: engine → global. */
function engineBinaryFor(
  store: ConfigStore,
  engineId: string,
): { binary: string; source: "engine" | "global" } | null {
  const engineCfg = store.readEngine(engineId);
  if (engineCfg) return { binary: engineCfg.binary, source: "engine" };
  const global = store.readGlobal();
  const binary = global.engines?.[engineId]?.binary;
  if (binary) return { binary, source: "global" };
  return null;
}

export function makeEngineHandlers(store: ConfigStore) {
  return {
    /** GET /api/v1/engines */
    getEngines: async (
      _request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const engines = listEngines().map((engine) => {
        const resolved = engineBinaryFor(store, engine.id);
        return {
          id: engine.id,
          displayName: engine.displayName,
          description: engine.description,
          filePatterns: engine.filePatterns,
          configured: resolved !== null,
          binary: resolved?.binary ?? null,
          binarySource: resolved?.source ?? null,
        };
      });
      reply.send({ engines });
    },

    /** GET /api/v1/engines/:id/schema */
    getEngineSchema: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const id = String((request.params as Record<string, string>).id);
      const engine = getEngine(id);
      if (!engine) {
        throw new AppError(
          "ENGINE_NOT_FOUND",
          `engine not registered: ${id}`,
          undefined,
          404,
        );
      }
      reply.send({ engineId: engine.id, schema: engine.schema });
    },

    /** PUT /api/v1/engines/:id — body: `{ binary, params? }`. */
    putEngine: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const id = String((request.params as Record<string, string>).id);
      const engine = getEngine(id);
      if (!engine) {
        throw new AppError(
          "ENGINE_NOT_FOUND",
          `engine not registered: ${id}`,
          undefined,
          404,
        );
      }

      const body = (request.body ?? {}) as {
        binary?: unknown;
        params?: Record<string, unknown>;
      };
      if (typeof body.binary !== "string" || body.binary.trim() === "") {
        throw new AppError(
          "VALIDATION_FAILED",
          "binary: expected a non-empty path string",
        );
      }

      const check = await engine.checkBinary?.(body.binary);
      if (check && check.errors.length > 0) {
        throw new AppError("ENGINE_BINARY_INVALID", check.errors.join("; "), {
          binary: body.binary,
          exists: check.exists,
          executable: check.executable,
          versionOk: check.versionOk,
          vulkan: check.vulkan,
        });
      }

      const params = body.params ?? {};
      const paramProblems = validateParamsAgainstSchema(engine.schema, params);
      if (paramProblems.length > 0) {
        throw new AppError("VALIDATION_FAILED", "params are invalid", {
          problems: paramProblems,
        });
      }

      const config = { version: 1, binary: body.binary, params };
      store.writeEngine(id, config);
      reply.send({
        ...config,
        check: {
          versionLine: check?.versionLine ?? null,
          vulkan: check?.vulkan ?? false,
        },
      });
    },

    /** GET /api/v1/engines/:id/check — test the configured binary. */
    checkEngine: async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const id = String((request.params as Record<string, string>).id);
      const engine = getEngine(id);
      if (!engine) {
        throw new AppError(
          "ENGINE_NOT_FOUND",
          `engine not registered: ${id}`,
          undefined,
          404,
        );
      }

      const resolved = engineBinaryFor(store, id);
      if (!resolved) {
        reply.send({ ok: false, message: "No binary configured" });
        return;
      }

      const check = await engine.checkBinary?.(resolved.binary);
      if (!check) {
        reply.send({ ok: false, message: "checkBinary not implemented" });
        return;
      }

      if (check.errors.length > 0) {
        reply.send({ ok: false, message: check.errors.join("; ") });
        return;
      }

      reply.send({
        ok: true,
        message: `OK — ${check.versionLine ?? "binary valid"}`,
        vulkan: check.vulkan,
      });
    },
  };
}
