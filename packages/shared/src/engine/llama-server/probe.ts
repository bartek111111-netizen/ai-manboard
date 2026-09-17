/**
 * Runtime probes for a live llama-server (PLAN §10.2, §10.3).
 * - isReady: `GET <base>/v1/models` with a 2 s timeout → HTTP 200 = ready.
 * - fetchRuntimeInfo: reads `/v1/models`, `/slots`, `/metrics`, `/health`;
 *   each is optional (older/newer builds differ — e.g. build 67672dc5 has
 *   no `/state`, `/parallel_info`), raw responses are preserved in `extras`.
 */
import type { InstanceView, RuntimeInfo } from '../types.js';

const PROBE_TIMEOUT_MS = 2_000;

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '');
}

async function getJson(url: string): Promise<Record<string, unknown> | unknown[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body !== null && typeof body === 'object') return body as Record<string, unknown> | unknown[];
    return null;
  } catch {
    return null;
  }
}

/** Readiness probe (FP-5): `GET /v1/models`, 2 s timeout, HTTP 200 = ready. */
export async function isLlamaServerReady(_instance: InstanceView, base: string): Promise<boolean> {
  const url = `${normalizeBase(base)}/v1/models`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Runtime info from the backend API (FMK-6); null when nothing is reachable. */
export async function fetchLlamaServerRuntimeInfo(base: string): Promise<RuntimeInfo | null> {
  const root = normalizeBase(base);
  const info: RuntimeInfo = { extras: {} };
  let reachable = false;

  const models = await getJson(`${root}/v1/models`);
  if (Array.isArray(models) ? models.length > 0 : models !== null) {
    reachable = true;
    const data = (models as Record<string, unknown>)?.data;
    const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    if (first && typeof first.id === 'string') info.modelLoaded = first.id;
    info.extras.models = models;
  }

  const slots = await getJson(`${root}/slots`);
  if (Array.isArray(slots)) {
    reachable = true;
    info.slots = {
      total: slots.length,
      used: slots.filter((s) => {
        if (typeof s !== 'object' || s === null) return false;
        // Check both possible field names: is_processing (newer builds) or used (older)
        const slot = s as Record<string, unknown>;
        return slot['is_processing'] === true || slot['used'] === true;
      }).length,
    };
    info.extras.slots = slots;
  }

  const health = await getJson(`${root}/health`);
  if (health !== null) {
    reachable = true;
    info.extras.health = health;
  }

  // `/metrics` (Prometheus text): parse tokens/sec and context size
  try {
    const res = await fetch(`${root}/metrics`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res.ok) {
      reachable = true;
      const text = await res.text();
      info.extras.metricsAvailable = true;
      info.extras.metricsSample = text.slice(0, 2_000);

      // Parse Prometheus format: metric_name value
      const metrics: Record<string, number> = {};
      for (const line of text.split('\n')) {
        if (line.startsWith('#') || !line.trim()) continue;
        const [name, value] = line.split(' ');
        if (name && value) {
          const num = parseFloat(value);
          if (!isNaN(num)) metrics[name] = num;
        }
      }

      // tokensPerSec = tokens_predicted_total / tokens_predicted_seconds_total
      const tokensTotal = metrics['llamacpp:tokens_predicted_total'];
      const tokensTime = metrics['llamacpp:tokens_predicted_seconds_total'];
      if (tokensTotal !== undefined && tokensTime > 0) {
        // CUMULATIVE average over all generation since launch. The dashboard
        // overwrites this with a LIVE rate (delta over the poll interval) — see
        // lifecycle's per-instance sampler. Kept here as the raw fallback.
        info.tokensPerSec = tokensTotal / tokensTime;
      }

      // Context size: use n_tokens_max as approximation
      const ctxSize = metrics['llamacpp:n_tokens_max'];
      if (ctxSize !== undefined) {
        info.contextSize = Math.round(ctxSize);
      }

      // Work time: total seconds spent generating (from metrics)
      if (tokensTime !== undefined) {
        info.extras.workTimeSec = tokensTime;
      }

      // Prefill (prompt processing) speed: average prompt tokens/s since launch.
      // `prompt_seconds_total` is the cumulative prompt-processing time and
      // `prompt_tokens_total` the cumulative prompt tokens processed.
      const prefillTokens = metrics['llamacpp:prompt_tokens_total'];
      const prefillTime = metrics['llamacpp:prompt_seconds_total'];
      if (prefillTime !== undefined) {
        info.extras.prefillSeconds = prefillTime;
      }
      if (prefillTokens !== undefined && prefillTime > 0) {
        info.extras.prefillTps = prefillTokens / prefillTime;
      }

      // Raw cumulative COUNTERS. These grow over the server's life; the
      // dashboard keeps the previous sample per instance and derives a LIVE
      // rate from the delta over the poll interval (current tok/s while a slot
      // is active), which is what the user actually wants to see during a long
      // generation. A cumulative average alone lags behind a new task.
      const counters: Record<string, number> = {};
      const counterKeys: Record<string, string> = {
        'llamacpp:tokens_predicted_total': 'tokensPredictedTotal',
        'llamacpp:tokens_predicted_seconds_total': 'tokensPredictedSeconds',
        'llamacpp:prompt_tokens_total': 'promptTokensTotal',
        'llamacpp:prompt_seconds_total': 'promptSecondsTotal',
      };
      for (const [metric, key] of Object.entries(counterKeys)) {
        const v = metrics[metric];
        if (v !== undefined && Number.isFinite(v)) counters[key] = v;
      }
      if (Object.keys(counters).length > 0) {
        info.extras.counters = counters;
      }
    }
  } catch {
    // unavailable — ignore
  }

  return reachable ? info : null;
}
