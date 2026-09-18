export const APP_NAME = "AI Model Dashboard";
export const APP_VERSION = "0.1.6";

export * from "./api/dto.js";
export * from "./api/errors.js";
export * from "./config/defaults.js";
export * from "./config/types.js";
export * from "./engine/types.js";
export {
  buildLlamaServerArgs,
  type ArgsContext,
} from "./engine/llama-server/args-core.js";
export {
  fetchLlamaServerRuntimeInfo,
  isLlamaServerReady,
} from "./engine/llama-server/probe.js";
export * from "./process/states.js";
export * from "./schema/validate.js";
