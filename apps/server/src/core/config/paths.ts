/**
 * `~/.ai-dashboard` layout (PLAN §9.3): directories and file paths.
 * Override: env `AI_DASHBOARD_HOME` (or explicit argument).
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DashboardHome {
  /** Root: `~/.ai-dashboard` (or AI_DASHBOARD_HOME). */
  root: string;
  /** `config/` — all editable config files. */
  configDir: string;
  /** `config/engines/` — engine configs (CFG-3). */
  enginesDir: string;
  /** `config/models/` — model configs (CFG-4). */
  modelsDir: string;
  /** `config/presets/<modelId>/` — presets (CFG-5). */
  presetsDir: string;
  /** `config/global.json` — dashboard-wide settings. */
  globalFile: string;
  /** `state/` — dashboard-owned runtime state (PID registry etc.). */
  stateDir: string;
  /** `state/instances/` — per-instance runtime files. */
  instancesDir: string;
  /** `logs/` — per-instance logs. */
  logsDir: string;
  /** `.backups/` — `.bak` of the last version of config files before overwrite. */
  backupsDir: string;
}

/** Resolves the dashboard home: argument > AI_DASHBOARD_HOME env > `~/.ai-dashboard`. */
export function resolveHome(homeOverride?: string): DashboardHome {
  const root = homeOverride ?? process.env.AI_DASHBOARD_HOME ?? join(homedir(), '.ai-dashboard');
  const configDir = join(root, 'config');
  return {
    root,
    configDir,
    enginesDir: join(configDir, 'engines'),
    modelsDir: join(configDir, 'models'),
    presetsDir: join(configDir, 'presets'),
    globalFile: join(configDir, 'global.json'),
    stateDir: join(root, 'state'),
    instancesDir: join(root, 'state', 'instances'),
    logsDir: join(root, 'logs'),
    backupsDir: join(root, '.backups'),
  };
}

/** Creates the directory skeleton (idempotent). */
export function ensureHome(home: DashboardHome): void {
  const dirs = [
    home.configDir,
    home.enginesDir,
    home.modelsDir,
    home.presetsDir,
    home.stateDir,
    home.instancesDir,
    home.logsDir,
    home.backupsDir,
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}
