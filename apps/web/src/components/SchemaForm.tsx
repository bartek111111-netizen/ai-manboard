/**
 * SchemaForm (Faza 9.1, §7.2): generic form rendered declaratively from
 * the engine's `ParamSchema[]`. Groups, types, validation, source layer.
 * Includes a command preview and proper advanced section formatting.
 */
import { buildLlamaServerArgs, type ParamSchema } from '@ai-dashboard/shared';
import { t } from '../i18n/index.js';

interface SchemaFormProps {
  schema: ParamSchema[];
  /** Current values (layer-merged). */
  values: Record<string, unknown>;
  /** Source layer per param (e.g. `schema`, `preset`, `global`). */
  sources?: Record<string, string>;
  /** Validation errors per param key. */
  errors?: Record<string, string>;
  /** Called when the user edits a value. */
  onChange: (key: string, value: unknown) => void;
  /** The model's path (pre-filled for the `model` param). */
  modelPath?: string;
  /** The engine binary path (the real one, from `getEngines()`). */
  binary?: string;
  /** The preset's port (sent as `--port`). */
  port?: number;
}

/** Group label (PL). */
const GROUP_LABELS: Record<string, string> = {
  model: 'Model',
  performance: 'Wydajność',
  sampling: 'Sampling',
  speculative: 'Spekulacja (MTP)',
  vision: 'Wizja (mmproj)',
  moe: 'MoE',
  server: 'Serwer',
  chat: 'Czat (template)',
  advanced: 'Zaawansowane',
};

/**
 * Builds the launch-command preview. It reuses the same shared builder the
 * server uses for the real launch (`buildLlamaServerArgs`), so the preview is
 * always identical to the command that actually runs. Only the params the user
 * actually set (the preset's params) are sent — schema defaults are NOT merged
 * in (the server runs on its own defaults for unset params).
 */
function buildCommandPreview(
  values: Record<string, unknown>,
  binary: string | undefined,
  modelPath: string | undefined,
  port?: number,
): string {
  if (!binary || !modelPath) return '…';
  // Only the preset's params (what the user set) + host/port. Schema defaults
  // are NOT merged — the server runs on its own defaults for unset params.
  const params: Record<string, unknown> = { ...values, host: '127.0.0.1', port: port ?? 8080 };
  const args = buildLlamaServerArgs({ modelPath, params });
  return `${binary} ${args.join(' ')}`;
}

/** A single field rendered per type. */
function Field({
  param,
  value,
  source,
  error,
  onChange,
}: {
  param: ParamSchema;
  value: unknown;
  source?: string;
  error?: string;
  onChange: (key: string, value: unknown) => void;
}) {
  const set = (v: unknown) => onChange(param.key, v);
  const fieldId = `field-${param.key}`;

  return (
    <div className={`schema-field type-${param.type}`}>
      <label htmlFor={fieldId}>
        {param.label}
        {source && <span className="field-source"> ({source})</span>}
      </label>
      {param.description && <p className="field-desc">{param.description}</p>}

      {error && <p className="field-error">{error}</p>}

      {/* int */}
      {param.type === 'int' && (
        <input
          id={fieldId}
          type="number"
          value={value !== null && value !== undefined ? String(value) : ''}
          min={param.min}
          max={param.max}
          onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}
        />
      )}

      {/* float */}
      {param.type === 'float' && (
        <input
          id={fieldId}
          type="number"
          step="0.01"
          value={value !== null && value !== undefined ? String(value) : ''}
          min={param.min}
          max={param.max}
          onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}
        />
      )}

      {/* string */}
      {param.type === 'string' && (
        <input
          id={fieldId}
          type="text"
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => set(e.target.value)}
        />
      )}

      {/* bool */}
      {param.type === 'bool' && (
        <input
          id={fieldId}
          type="checkbox"
          checked={value === true}
          onChange={(e) => set(e.target.checked)}
        />
      )}

      {/* enum (with optional number input) */}
      {param.type === 'enum' && (
        <>
          <select
            id={fieldId}
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__number__' && param.allowNumber) {
                // Don't set yet — the number input below handles it
                return;
              }
              const num = Number(v);
              set(Number.isNaN(num) ? v : num);
            }}
          >
            <option value="">{t('enumSelect')}</option>
            {(param.choices ?? []).map((choice) => (
              <option key={String(choice.value)} value={String(choice.value)}>
                {choice.label ?? String(choice.value)}
              </option>
            ))}
            {param.allowNumber && (
              <option value="__number__">{t('enumCustomNumber')}</option>
            )}
          </select>
          {/* Number input for custom value */}
          {param.allowNumber && value !== null && value !== undefined && typeof value === 'number' && (
            <input
              type="number"
              className="enum-number-input"
              value={value}
              min={param.min}
              max={param.max}
              onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}
            />
          )}
        </>
      )}

      {/* path-model */}
      {param.type === 'path-model' && (
        <input
          id={fieldId}
          type="text"
          value={value !== null && value !== undefined ? String(value) : ''}
          placeholder={t('pathModelPlaceholder')}
          onChange={(e) => set(e.target.value)}
        />
      )}

      {/* path-file */}
      {param.type === 'path-file' && (
        <input
          id={fieldId}
          type="text"
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </div>
  );
}

/** Renders a group of params with proper formatting. */
function ParamGroup({
  group,
  params,
  values,
  sources,
  errors,
  onChange,
  modelPath,
}: {
  group: string;
  params: ParamSchema[];
  values: Record<string, unknown>;
  sources?: Record<string, string>;
  errors?: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
  modelPath?: string;
}) {
  return (
    <fieldset className={`schema-group group-${group}`}>
      <legend>{GROUP_LABELS[group] ?? group}</legend>
      {params.map((param) => {
        // Pre-fill the model path
        let val = values[param.key];
        if (param.key === 'model' && (val === undefined || val === null || val === '') && modelPath) {
          val = modelPath;
        }
        return (
          <Field
            key={param.key}
            param={param}
            value={val}
            source={sources?.[param.key]}
            error={errors?.[param.key]}
            onChange={onChange}
          />
        );
      })}
    </fieldset>
  );
}

export function SchemaForm({
  schema,
  values,
  sources,
  errors,
  onChange,
  modelPath,
  binary,
  port,
}: SchemaFormProps) {
  // Command preview — identical to the real launch command (shared builder).
  const command = buildCommandPreview(values, binary, modelPath, port);

  // Separate advanced params from main params
  const mainParams = schema.filter((p) => !p.advanced);
  const advancedParams = schema.filter((p) => p.advanced);

  // Group main params by `group`
  const mainGroups = new Map<string, ParamSchema[]>();
  for (const param of mainParams) {
    const arr = mainGroups.get(param.group) ?? [];
    arr.push(param);
    mainGroups.set(param.group, arr);
  }

  // Group advanced params by `group`
  const advancedGroups = new Map<string, ParamSchema[]>();
  for (const param of advancedParams) {
    const arr = advancedGroups.get(param.group) ?? [];
    arr.push(param);
    advancedGroups.set(param.group, arr);
  }

  return (
    <div className="schema-form">
      {/* Command preview */}
      <div className="command-preview">
        <h3>{t('commandPreview')}</h3>
        <pre className="command-preview-code">{command}</pre>
      </div>

      {/* Main groups */}
      {[...mainGroups.entries()].map(([group, params]) => (
        <ParamGroup
          key={group}
          group={group}
          params={params}
          values={values}
          sources={sources}
          errors={errors}
          onChange={onChange}
          modelPath={modelPath}
        />
      ))}

      {/* Advanced section (collapsed by default) */}
      {advancedParams.length > 0 && (
        <details className="schema-advanced">
          <summary>{t('advancedSection')}</summary>
          <div className="schema-advanced-content">
            {[...advancedGroups.entries()].map(([group, params]) => (
              <ParamGroup
                key={group}
                group={group}
                params={params}
                values={values}
                sources={sources}
                errors={errors}
                onChange={onChange}
                modelPath={modelPath}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
