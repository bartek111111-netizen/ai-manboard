/**
 * SchemaForm (Faza 9.1, §7.2): generic form rendered declaratively from
 * the engine's `ParamSchema[]`. Groups, types, validation, source layer.
 * Includes a command preview and proper advanced section formatting.
 */
import type { ParamSchema } from '@ai-dashboard/shared';
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
  advanced: 'Zaawansowane',
};

/** Builds a preview of the launch command from current values (matches llama-server CLI). */
function buildCommandPreview(schema: ParamSchema[], values: Record<string, unknown>): string {
  const lines: string[] = ['/home/bat/llama.cpp/build/bin/llama-server \\'];

  // Model path first (always sent)
  const modelPath = values['model'];
  if (typeof modelPath === 'string' && modelPath) {
    lines.push(`  --model ${modelPath} \\`);
  }

  // Host and port (only when set by user)
  if (values['host'] !== undefined && values['host'] !== null && values['host'] !== '') {
    lines.push(`  --host ${values['host']} \\`);
  }
  if (values['port'] !== undefined && values['port'] !== null && values['port'] !== '') {
    lines.push(`  --port ${values['port']} \\`);
  }

  // Other params (only when set)
  let last = false;
  for (const param of schema) {
    if (param.key === 'model' || param.key === 'host' || param.key === 'port') continue;
    const val = values[param.key];
    if (val === null || val === undefined || val === '') continue;

    last = true;
    const flag = param.flag ?? `--${param.key}`;
    if (param.type === 'bool') {
      if (val === true) {
        if (param.offFlag || param.offValue) { last = false; continue; }
        lines.push(`  ${flag} \\`);
      } else if (val === false) {
        if (param.offFlag) lines.push(`  ${param.offFlag} \\`);
        else if (param.offValue) lines.push(`  ${flag} ${param.offValue} \\`);
        else { last = false; }
      }
    } else {
      lines.push(`  ${flag} ${val} \\`);
    }
  }

  // Remove trailing \ from the last line
  if (last && lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    lines[lines.length - 1] = lastLine.replace(' \\', '');
  }

  return lines.join('\n');
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
}: SchemaFormProps) {
  // Command preview
  const command = buildCommandPreview(schema, values);

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
