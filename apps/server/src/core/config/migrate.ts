/**
 * Config file versions and migrations (PLAN §9.3: files carry `version: 1`
 * so future formats can be migrated instead of breaking on startup).
 *
 * Faza 1: only v1 exists. Files without a `version` field are treated as
 * v0 and get the field added; `version > CURRENT_CONFIG_VERSION` is a hard
 * error (the file belongs to a newer dashboard build).
 */
import { CURRENT_CONFIG_VERSION, AppError } from '@ai-dashboard/shared';

export type ConfigFileKind = 'global' | 'engine' | 'model' | 'preset';

/**
 * Migration table: fromVersion → transform.
 * v0 = file without a `version` field (legacy/manual) → v1 adds the field.
 */
const migrations: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {
  0: (data) => ({ ...data, version: CURRENT_CONFIG_VERSION }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Migrate a raw config file object to the current version.
 * @throws AppError('CONFIG_INVALID') when the file is not a JSON object
 * or its version is beyond what this dashboard build supports.
 */
export function migrateConfigFile(raw: unknown, kind: ConfigFileKind): unknown {
  if (!isRecord(raw)) {
    throw new AppError('CONFIG_INVALID', `${kind}.json: expected a JSON object`);
  }
  const data: Record<string, unknown> = { ...raw };
  const version = typeof data.version === 'number' ? data.version : 0;

  if (version > CURRENT_CONFIG_VERSION) {
    throw new AppError(
      'CONFIG_INVALID',
      `${kind}.json: version ${version} is newer than this dashboard supports (${CURRENT_CONFIG_VERSION})`,
    );
  }

  let current = version;
  while (current < CURRENT_CONFIG_VERSION) {
    const migrate = migrations[current];
    if (!migrate) {
      throw new AppError(
        'CONFIG_INVALID',
        `${kind}.json: no migration path from version ${current}`,
      );
    }
    const migrated = migrate(data);
    Object.assign(data, migrated);
    current = typeof migrated.version === 'number' ? migrated.version : current + 1;
  }

  data.version = CURRENT_CONFIG_VERSION;
  return data;
}
