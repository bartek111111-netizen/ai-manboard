/**
 * SchemaForm (Faza 9.1, §7.2): generic form rendered declaratively from
 * the engine's `ParamSchema[]`. Groups, types, validation, source layer.
 * Includes a command preview at the top.
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
};

/** Builds a preview of the launch command from current values. */
function buildCommandPreview(schema: ParamSchema[], values: Record<string, unknown>): string {
  const parts: string[] = ['llama-server'];

  for (const param of schema) {
    const val = values[param.key];
    if (val === null || val === undefined || val === '') continue;

    const flag = param.flag ?? `--${param.key}`;
    if (param.type === 'bool') {
      // Bool: only include when true (or offFlag when false)
      if (val === true) {
        parts.push(flag);
      } else if (val === false && param.offFlag) {
        parts.push(param.offFlag);
      }
    } else if (param.type === 'enum') {
      if (typeof val === 'number') {
        parts.push(`${flag}=${val}`);
      } else {
        parts.push(`${flag}=${val}`);
      }
    } else {
      parts.push(`${flag}=${val}`);
    }
  }

  // Model path last
  const modelPath = values['model'];
  if (typeof modelPath === 'string' && modelPath) {
    parts.push(modelPath);
  }

  return parts.join(' \\\n  ');
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
    <div className={`schema-field type-${param.type}${param.advanced ? ' advanced' : ''}`}>
      <label htmlFor={fieldId}>
        {param.label}
        {source && <span className="field-source"> ({source})</span>}
        {param.description && <span className="field-desc"> — {param.description}</span>}
      </label>

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

export function SchemaForm({
  schema,
  values,
  sources,
  errors,
  onChange,
}: SchemaFormProps) {
  // Command preview
  const command = buildCommandPreview(schema, values);

  // Group params by `group` (exclude advanced params from the main view)
  const groups = new Map<string, ParamSchema[]>();
  for (const param of schema) {
    if (param.advanced) continue; // advanced params shown in the collapsible section
    const arr = groups.get(param.group) ?? [];
    arr.push(param);
    groups.set(param.group, arr);
  }

  // Advanced params (separate section)
  const advancedParams = schema.filter((p) => p.advanced);

  return (
    <div className="schema-form">
      {/* Command preview */}
      <div className="command-preview">
        <h3>{t('commandPreview')}</h3>
        <pre className="command-preview-code">{command}</pre>
      </div>

      {/* Main groups */}
      {[...groups.entries()].map(([group, params]) => (
        <fieldset key={group} className={`schema-group group-${group}`}>
          <legend>{GROUP_LABELS[group] ?? group}</legend>
          {params.map((param) => (
            <Field
              key={param.key}
              param={param}
              value={values[param.key]}
              source={sources?.[param.key]}
              error={errors?.[param.key]}
              onChange={onChange}
            />
          ))}
        </fieldset>
      ))}

      {/* Advanced section (collapsed by default) */}
      {advancedParams.length > 0 && (
        <details className="schema-advanced">
          <summary>{t('advancedSection')}</summary>
          {advancedParams.map((param) => (
            <Field
              key={param.key}
              param={param}
              value={values[param.key]}
              source={sources?.[param.key]}
              error={errors?.[param.key]}
              onChange={onChange}
            />
          ))}
        </details>
      )}
    </div>
  );
}
