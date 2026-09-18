/**
 * Engine registry (PLAN §7.1, Faza 2): the registry registers the engine
 * modules; the process manager and the API resolve engines by id.
 * Node-only (engine modules use fs/child_process) — import from
 * `@ai-dashboard/shared/engine` on the server side; the web reads engine
 * data (schemas) from the API, not from this module.
 */
import type { InferenceEngine } from "./types.js";
import { LlamaServerEngine } from "./llama-server/index.js";

export * from "./types.js";
export { LlamaServerEngine } from "./llama-server/index.js";
export {
  LLAMA_SERVER_SCHEMA,
  buildLlamaServerLaunch,
} from "./llama-server/index.js";

const engines = new Map<string, InferenceEngine>();

export function registerEngine(engine: InferenceEngine): void {
  if (engines.has(engine.id)) {
    throw new Error(`engine already registered: ${engine.id}`);
  }
  engines.set(engine.id, engine);
}

export function getEngine(id: string): InferenceEngine | undefined {
  return engines.get(id);
}

export function listEngines(): InferenceEngine[] {
  return [...engines.values()];
}

// The MVP ships one engine (§7.1).
registerEngine(new LlamaServerEngine());
