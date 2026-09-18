/**
 * Environment configuration (phase 0).
 * From phase 1 on these values live in ~/.ai-dashboard/config/global.json.
 */
export interface ServerEnv {
  /** Interface the dashboard listens on. Loopback by default (plan S-1). */
  host: string;
  port: number;
  /** Override of ~/.ai-dashboard (used from phase 1 on). */
  home: string | undefined;
}

export function loadEnv(): ServerEnv {
  return {
    host: process.env.AI_DASHBOARD_HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.AI_DASHBOARD_PORT ?? "3100", 10),
    home: process.env.AI_DASHBOARD_HOME,
  };
}
