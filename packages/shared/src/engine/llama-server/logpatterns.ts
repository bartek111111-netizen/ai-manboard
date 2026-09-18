/**
 * Log-line classification for llama-server (PLAN §10.4, Faza 2.6).
 * Order matters: known warnings (e.g. the RADV conformance notice) are
 * checked FIRST and never count as errors; then error patterns; then
 * warnings; ready markers are informational.
 */
import type { LogClassification } from "../types.js";

/** Known non-error warnings: level = info, flagged as knownWarning. */
const KNOWN_WARNINGS: RegExp[] = [
  /radv is not a conformant vulkan implementation/i,
];

const ERROR_PATTERNS: RegExp[] = [
  /\bout of memory\b/i,
  /\bOOM\b/i,
  /CUDA error/i,
  /Vulkan: failed/i,
  /no Vulkan devices? found/i,
  /failed to load/i,
  /error loading/i,
  /could not allocate/i,
  /invalid model/i,
  /corrupt\b.*\.(gguf|bin)/i,
];

const WARN_PATTERNS: RegExp[] = [/\bwarning\b/i, /\bslow\b/i, /fallback/i];

/** Informational ready markers (§10.2). */
const READY_MARKERS: RegExp[] = [
  /server is listening/i,
  /all slots are idle/i,
  /\bloaded\b/i,
];

export function classifyLlamaServerLog(line: string): LogClassification {
  if (KNOWN_WARNINGS.some((p) => p.test(line))) {
    return { level: "info", knownWarning: true };
  }
  if (ERROR_PATTERNS.some((p) => p.test(line))) {
    return { level: "error" };
  }
  if (WARN_PATTERNS.some((p) => p.test(line))) {
    return { level: "warn" };
  }
  if (READY_MARKERS.some((p) => p.test(line))) {
    return { level: "info", readyMarker: true };
  }
  return { level: "info" };
}
