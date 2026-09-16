/**
 * Pure argument builder for `llama-server` (PLAN §10.1, Faza 2.4) — browser-safe
 * (no Node built-ins). This is the single source of truth for the flag list;
 * `buildLlamaServerLaunch` (args.ts) wraps it with `cwd`/`env` for spawning, and
 * the web command preview imports it directly so the preview is always identical
 * to the real launch command (same function, same params).
 *
 * Rules (user preference 2026-09-16 — "send only what the user set"):
 * - `--model` is always sent (required);
 * - every other parameter (including `--host`/`--port`): sent **only** when it
 *   differs from the schema default; at the default it is omitted entirely
 *   (the server then runs on its own default for that option);
 * - bools: `true` on an offFlag/offValue param → nothing (true is the default);
 *   `false` → the offFlag/offValue; plain bools sent when `true`
 *   (a flag-only option whose absence is the default state).
 */
import { LLAMA_SERVER_SCHEMA } from './schema.js';

export interface ArgsContext {
  /** The resolved model file path (always sent as `--model`). */
  modelPath: string;
  /** The fully resolved params (all schema keys, layer-merged). */
  params: Record<string, unknown>;
}

/** Builds the `--flag value` args array (no `cwd`/`env` — see `buildLlamaServerLaunch`). */
export function buildLlamaServerArgs(ctx: ArgsContext): string[] {
  const params = ctx.params;
  const args: string[] = [];

  // `--model` is always sent (required). Everything else — including host/port —
  // is sent only when it differs from the schema default (see the loop below).
  args.push('--model', ctx.modelPath);

  for (const p of LLAMA_SERVER_SCHEMA) {
    if (p.key === 'model') continue;
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

  return args;
}
