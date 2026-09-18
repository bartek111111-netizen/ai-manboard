/**
 * Capabilities (PLAN §8.3, FM-6):
 * - source 1 (heuristic): `engine.detectCapabilities` — from the GGUF
 *   architecture and the file name. Weak: a suggestion, not a fact.
 * - source 2 (authority): manual edit from the UI (`PATCH /models/:id`).
 *   A manual value always wins (`capabilitiesManual = true`).
 */
import type { Capability, ModelConfig } from "@ai-dashboard/shared";

export interface ResolvedCapabilities {
  /** Effective capability flags, e.g. `{ text: true, vision: false }`. */
  flags: Record<string, boolean>;
  /** Where the flags came from. */
  source: "manual" | "heuristic";
}

/**
 * Resolves the effective capabilities for a model:
 * manual (authoritative) when set, otherwise the engine heuristic.
 */
export function resolveCapabilities(
  config: ModelConfig,
  heuristics: Capability[],
): ResolvedCapabilities {
  const manual = config.capabilities;
  if (config.capabilitiesManual && Object.keys(manual ?? {}).length > 0) {
    return { flags: manual, source: "manual" };
  }
  const flags: Record<string, boolean> = {};
  for (const cap of heuristics) flags[cap] = true;
  return { flags, source: "heuristic" };
}
