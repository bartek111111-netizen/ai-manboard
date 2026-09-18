/**
 * Config schema validation (PLAN §15, S-9): hand-rolled validators shared
 * by FE/BE. A bad file is rejected with a clear `CONFIG_INVALID` error —
 * never silently overwritten.
 */
import { AppError } from "../api/errors.js";
import type {
  EngineConfig,
  GlobalConfig,
  ModelConfig,
  Preset,
} from "../config/types.js";
import type { ParamSchema } from "../engine/types.js";

export const MIN_PORT = 1024;
export const MAX_PORT = 65535;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isPort(value: unknown): value is number {
  return isInt(value) && value >= MIN_PORT && value <= MAX_PORT;
}

/**
 * Validate the merged shape of `global.json` (§9.4).
 * @throws AppError('CONFIG_INVALID') with the list of problems in details.
 */
export function validateGlobalConfig(
  data: unknown,
  label = "global.json",
): GlobalConfig {
  const problems: string[] = [];
  if (!isRecord(data)) {
    throw new AppError("CONFIG_INVALID", `${label}: expected a JSON object`, {
      problems: ["not an object"],
    });
  }

  if (typeof data.version !== "number")
    problems.push("version: missing or not a number");

  if (!Array.isArray(data.modelDirs)) {
    problems.push("modelDirs: expected an array of absolute paths");
  } else {
    data.modelDirs.forEach((dir, i) => {
      if (typeof dir !== "string")
        problems.push(`modelDirs[${i}]: not a string`);
      else if (!dir.startsWith("/"))
        problems.push(`modelDirs[${i}]: "${dir}" — must be an absolute path`);
    });
  }

  if (data.defaults !== undefined && !isRecord(data.defaults)) {
    problems.push("defaults: expected an object");
  }

  const portRange = data.portRange;
  if (!isRecord(portRange)) {
    problems.push("portRange: expected { start, end }");
  } else {
    if (!isPort(portRange.start))
      problems.push("portRange.start: not a port (1024–65535)");
    if (!isPort(portRange.end))
      problems.push("portRange.end: not a port (1024–65535)");
    if (
      isPort(portRange.start) &&
      isPort(portRange.end) &&
      portRange.start > portRange.end
    ) {
      problems.push("portRange: start must be <= end");
    }
  }

  if (data.engines !== undefined && !isRecord(data.engines)) {
    problems.push("engines: expected an object of { [engineId]: { binary } }");
  } else {
    for (const [id, engine] of Object.entries(
      isRecord(data.engines) ? data.engines : {},
    )) {
      if (
        !isRecord(engine) ||
        typeof engine.binary !== "string" ||
        engine.binary.length === 0
      ) {
        problems.push(`engines.${id}: expected { binary: "<path>" }`);
      }
    }
  }

  const server = data.server;
  if (!isRecord(server)) {
    problems.push("server: expected { host, port }");
  } else {
    if (typeof server.host !== "string" || server.host.length === 0)
      problems.push("server.host: not a string");
    if (!isPort(server.port))
      problems.push("server.port: not a port (1024–65535)");
  }

  const security = data.security;
  if (!isRecord(security)) {
    problems.push("security: expected { token }");
  } else if (security.token !== null && typeof security.token !== "string") {
    problems.push("security.token: expected null or a string");
  }

  const monitoring = data.monitoring;
  if (!isRecord(monitoring)) {
    problems.push(
      "monitoring: expected { probeIntervalSec, startupTimeoutSec }",
    );
  } else {
    if (
      !isFiniteNumber(monitoring.probeIntervalSec) ||
      (monitoring.probeIntervalSec as number) <= 0
    ) {
      problems.push("monitoring.probeIntervalSec: must be a positive number");
    }
    if (
      !isFiniteNumber(monitoring.startupTimeoutSec) ||
      (monitoring.startupTimeoutSec as number) <= 0
    ) {
      problems.push("monitoring.startupTimeoutSec: must be a positive number");
    }
  }

  const logs = data.logs;
  if (!isRecord(logs)) {
    problems.push("logs: expected { ringLines, retentionFiles }");
  } else {
    if (!isInt(logs.ringLines) || (logs.ringLines as number) <= 0) {
      problems.push("logs.ringLines: must be a positive integer");
    }
    if (!isInt(logs.retentionFiles) || (logs.retentionFiles as number) <= 0) {
      problems.push("logs.retentionFiles: must be a positive integer");
    }
  }

  if (problems.length > 0) {
    throw new AppError("CONFIG_INVALID", `${label} is invalid`, { problems });
  }

  return data as unknown as GlobalConfig;
}

/**
 * Validate `config/engines/<engineId>.json` (CFG-3).
 */
export function validateEngineConfig(
  data: unknown,
  engineId = "<engine>",
): EngineConfig {
  const problems: string[] = [];
  if (!isRecord(data)) {
    throw new AppError(
      "CONFIG_INVALID",
      `engines/${engineId}.json: expected a JSON object`,
      {
        problems: ["not an object"],
      },
    );
  }
  if (typeof data.version !== "number")
    problems.push("version: missing or not a number");
  if (typeof data.binary !== "string" || data.binary.length === 0) {
    problems.push("binary: expected a non-empty path string");
  }
  if (!isRecord(data.params)) problems.push("params: expected an object");

  if (problems.length > 0) {
    throw new AppError(
      "CONFIG_INVALID",
      `engines/${engineId}.json is invalid`,
      { problems },
    );
  }
  return data as unknown as EngineConfig;
}

/**
 * Validate `config/models/<modelId>.json` (CFG-4 + FM-5/6).
 */
export function validateModelConfig(
  data: unknown,
  modelId = "<model>",
): ModelConfig {
  const problems: string[] = [];
  if (!isRecord(data)) {
    throw new AppError(
      "CONFIG_INVALID",
      `models/${modelId}.json: expected a JSON object`,
      {
        problems: ["not an object"],
      },
    );
  }
  if (typeof data.version !== "number")
    problems.push("version: missing or not a number");
  if (data.engineId !== undefined && typeof data.engineId !== "string") {
    problems.push("engineId: not a string");
  }
  if (data.displayName !== undefined && typeof data.displayName !== "string") {
    problems.push("displayName: not a string");
  }
  if (data.description !== undefined && typeof data.description !== "string") {
    problems.push("description: not a string");
  }
  if (data.tags !== undefined) {
    if (
      !Array.isArray(data.tags) ||
      data.tags.some((t) => typeof t !== "string")
    ) {
      problems.push("tags: expected an array of strings");
    }
  }
  if (data.capabilities !== undefined) {
    if (
      !isRecord(data.capabilities) ||
      Object.values(data.capabilities).some((v) => v !== true && v !== false)
    ) {
      problems.push("capabilities: expected an object of booleans");
    }
  }
  if (
    data.capabilitiesManual !== undefined &&
    typeof data.capabilitiesManual !== "boolean"
  ) {
    problems.push("capabilitiesManual: not a boolean");
  }
  if (
    data.origin !== undefined &&
    data.origin !== "discover" &&
    data.origin !== "manual"
  ) {
    problems.push(
      `origin: expected 'discover' or 'manual' (got ${String(data.origin)})`,
    );
  }
  if (!isRecord(data.params)) problems.push("params: expected an object");

  if (problems.length > 0) {
    throw new AppError("CONFIG_INVALID", `models/${modelId}.json is invalid`, {
      problems,
    });
  }
  return data as unknown as ModelConfig;
}

/**
 * Validates a params object against a declarative engine schema (§7.2):
 * unknown keys, wrong types, out-of-range values, bad enum choices.
 * Returns a list of problems (empty = ok). Used by the API (PUT /engines/:id).
 */
export function validateParamsAgainstSchema(
  schema: ParamSchema[],
  params: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  const byKey = new Map(schema.map((s) => [s.key, s]));
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const spec = byKey.get(key);
    if (!spec) {
      problems.push(`${key}: unknown parameter`);
      continue;
    }
    switch (spec.type) {
      case "int":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          problems.push(`${key}: must be an integer`);
        } else {
          if (spec.min !== undefined && value < spec.min) {
            problems.push(`${key}: below the minimum (${spec.min})`);
          }
          if (spec.max !== undefined && value > spec.max) {
            problems.push(`${key}: above the maximum (${spec.max})`);
          }
        }
        break;
      case "float":
        if (typeof value !== "number") {
          problems.push(`${key}: must be a number`);
        } else {
          if (spec.min !== undefined && value < spec.min) {
            problems.push(`${key}: below the minimum (${spec.min})`);
          }
          if (spec.max !== undefined && value > spec.max) {
            problems.push(`${key}: above the maximum (${spec.max})`);
          }
        }
        break;
      case "bool":
        if (typeof value !== "boolean")
          problems.push(`${key}: must be a boolean`);
        break;
      case "string":
      case "path-model":
      case "path-file":
        if (typeof value !== "string")
          problems.push(`${key}: must be a string`);
        break;
      case "enum": {
        if (spec.allowNumber && typeof value === "number") break;
        const allowed = spec.choices?.map((c) => c.value) ?? [];
        if (allowed.length > 0) {
          if (!allowed.includes(value)) {
            problems.push(
              `${key}: invalid value (${String(value)}); allowed: ${allowed.join(", ")}`,
            );
          }
        } else if (typeof value !== "string") {
          problems.push(`${key}: must be a string`);
        }
        break;
      }
    }
  }
  return problems;
}

/**
 * Validate `config/presets/<modelId>/<preset>.json` (CFG-5/6).
 */
export function validatePreset(data: unknown, presetName = "<preset>"): Preset {
  const problems: string[] = [];
  if (!isRecord(data)) {
    throw new AppError(
      "CONFIG_INVALID",
      `preset ${presetName}: expected a JSON object`,
      {
        problems: ["not an object"],
      },
    );
  }
  if (typeof data.version !== "number")
    problems.push("version: missing or not a number");
  if (typeof data.name !== "string" || data.name.length === 0)
    problems.push("name: expected a non-empty string");
  if (data.description !== undefined && typeof data.description !== "string") {
    problems.push("description: not a string");
  }
  if (data.port !== undefined && !isPort(data.port))
    problems.push("port: not a port (1024–65535)");
  if (!isRecord(data.params)) problems.push("params: expected an object");

  if (problems.length > 0) {
    throw new AppError("CONFIG_INVALID", `preset ${presetName} is invalid`, {
      problems,
    });
  }
  return data as unknown as Preset;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-merge a partial config update onto the current one.
 * Arrays and non-plain values are replaced wholesale; plain objects merge.
 */
export function mergePartial<T>(current: T, partial: unknown): T {
  if (
    typeof current !== "object" ||
    current === null ||
    !isPlainObject(partial)
  ) {
    return { ...current } as T;
  }
  const result: Record<string, unknown> = {
    ...(current as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(partial)) {
    const currentVal = (current as Record<string, unknown>)[key];
    result[key] =
      isPlainObject(currentVal) && isPlainObject(value)
        ? mergePartial(currentVal, value)
        : value;
  }
  return result as T;
}

/**
 * Merge a partial `global.json` update and validate the result.
 * @throws AppError('CONFIG_INVALID') when the merged shape is invalid.
 */
export function mergeGlobalConfig(
  current: GlobalConfig,
  partial: unknown,
): GlobalConfig {
  if (!isRecord(partial)) {
    throw new AppError(
      "VALIDATION_FAILED",
      "body: expected a JSON object with config fields",
    );
  }
  const merged = mergePartial(current, partial);
  return validateGlobalConfig(merged, "global.json (merged)");
}
