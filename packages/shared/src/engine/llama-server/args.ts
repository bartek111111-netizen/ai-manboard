/**
 * `buildLaunch` for llama-server (PLAN §10.1, Faza 2.4):
 * - always `--model`, `--host`, `--port`;
 * - `--metrics` (build supports it + enabled — dashboard default true),
 *   `--offline` (dashboard default true);
 * - every other parameter: sent only when it differs from the schema default;
 * - bools: `--metrics`/`--offline` sent when true; `--fit off` when fit=false;
 *   `--no-slots` / `--no-ui` when the respective flag is disabled.
 */
import { dirname } from 'node:path';
import type { LaunchCommand, LaunchContext } from '../types.js';
import { LLAMA_SERVER_SCHEMA } from './schema.js';

/** Builds the spawn-ready command (synchronous; the async wrapper is on the engine). */
export function buildLlamaServerLaunch(ctx: LaunchContext): LaunchCommand {
  const params = ctx.params;
  const args: string[] = [];

  // Always sent (PLAN §10.1).
  args.push('--model', ctx.modelPath);
  args.push('--host', String(params.host ?? '127.0.0.1'), '--port', String(params.port ?? 8080));

  for (const p of LLAMA_SERVER_SCHEMA) {
    if (p.key === 'model' || p.key === 'host' || p.key === 'port') continue;
    const value = params[p.key];
    if (value === undefined || value === null) continue;

    if (p.type === 'bool') {
      if (value === true) {
        // `true` is the default for offFlag/offValue params → nothing to send.
        if (p.offFlag || p.offValue) continue;
        args.push(p.flag ?? '');
      } else if (value === false) {
        if (p.offFlag) args.push(p.offFlag);
        else if (p.offValue) args.push(p.flag ?? '', p.offValue);
      }
    } else {
      // Empty strings (device, api-key, ...) are "unset", not values.
      if (typeof value === 'string' && value.trim() === '') continue;
      if (value !== p.default) args.push(p.flag ?? '', String(value));
    }
  }

  return {
    binary: ctx.binary,
    args,
    cwd: ctx.cwd ?? dirname(ctx.modelPath),
    env: ctx.env ?? {},
  };
}
