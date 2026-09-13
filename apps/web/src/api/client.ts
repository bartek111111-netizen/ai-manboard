/**
 * REST client for the dashboard API (Faza 1: status + config).
 * SSE streams are added in phase 6 (api/sse.ts).
 */
import type { ConfigResponse } from '@ai-dashboard/shared';

export interface DashboardStatus {
  name: string;
  version: string;
  state: string;
  uptimeSec: number;
  timestamp: string;
  engines: unknown[];
  /** Config watch state (P-12). */
  config?: ConfigResponse['state'];
}

/** Error thrown by the REST client (maps to the API error envelope). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as ErrorEnvelope;
      if (body.error?.message) {
        message = body.error.message;
      }
      code = body.error?.code;
    } catch {
      // non-JSON body — keep the HTTP status message
    }
    throw new ApiError(message, code);
  }
  return (await response.json()) as T;
}

/** GET /api/v1/status */
export function getStatus(): Promise<DashboardStatus> {
  return request<DashboardStatus>('/api/v1/status');
}

/** GET /api/v1/config — all layers + effective merge + watch state. */
export function getConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>('/api/v1/config');
}
