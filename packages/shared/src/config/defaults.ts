/**
 * First-run seed for `config/global.json` (PLAN §9.4).
 * Values the onboarding wizard (ONB-1/ONB-2, Faza 7) will fill in:
 * empty `modelDirs`, placeholder engine binary from the plan example.
 */
import { CURRENT_CONFIG_VERSION, type GlobalConfig } from './types.js';

export function defaultGlobalConfig(): GlobalConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    modelDirs: [],
    defaults: {},
    portRange: { start: 8080, end: 8099 },
    engines: {
      'llama-server': { binary: '~/llama.cpp/build/bin/llama-server' },
    },
    server: { host: '127.0.0.1', port: 3100 },
    security: { token: null },
    monitoring: { probeIntervalSec: 5, startupTimeoutSec: 120 },
    logs: { ringLines: 1000, retentionFiles: 10 },
  };
}
