/**
 * `buildLaunch` for llama-server (PLAN §10.1, Faza 2.4):
 * - the flag list comes from the shared, browser-safe `buildLlamaServerArgs`
 *   (single source of truth — the web preview uses the same function);
 * - this wrapper adds the spawn context (`cwd` defaulting to the model's
 *   directory, `env` defaulting to `{}`) to produce a spawn-ready `LaunchCommand`.
 */
import { dirname } from "node:path";
import type { LaunchCommand, LaunchContext } from "../types.js";
import { buildLlamaServerArgs } from "./args-core.js";

/** Builds the spawn-ready command (synchronous; the async wrapper is on the engine). */
export function buildLlamaServerLaunch(ctx: LaunchContext): LaunchCommand {
  const args = buildLlamaServerArgs({
    modelPath: ctx.modelPath,
    params: ctx.params,
  });
  return {
    binary: ctx.binary,
    args,
    cwd: ctx.cwd ?? dirname(ctx.modelPath),
    env: ctx.env ?? {},
  };
}
