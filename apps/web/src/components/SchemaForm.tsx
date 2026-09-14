/**
 * SchemaForm (Faza 9.1, §7.2): generic form rendered declaratively from
 * the engine's `ParamSchema[]`. Groups, types, validation, source layer.
 */
import { useState } from 'react';
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
  /** Whether to show the advanced (collapsed) section. */
  showAdvanced?: boolean;
}

/** Group label (PL). */
const GROUP_LABELS: Record<string, string> = {
  model: 'Model',
  performance: 'Wydajność',
  sampling: 'Sampling',
  speculative: 'Spekulacja',
  server: 'Serwer',
  advanced: 'Zaawansowane',
};

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

  // Skip required-engine-feature params (e.g. GPU params without GPU).
  if (param.requiresEngineFeature) {
    // MVP: render but mark as unavailable (the real check is server-side).
  }

  const fieldId = `field-${param.key}`;

  return (
    <div className={`schema-field type-${param.type}${param.advanced ? ' advanced' : ''}`}>
      <label htmlFor={fieldId}>
        {param.label}
        {source && <span className="field-source"> ({source})</span>}
        {param.description && <span className="field-desc"> — {param.description}</span>}
      </label>

      {error && <p className="field-error">{error}</p>}

      {/* Type-specific input */}
      {param.type === 'int' && (
        <input
          id={fieldId}
          type="number"
          value={value !== null && value !== undefined ? String(value) : ''}
          min={param.min}
          max={param.max}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            set(v);
          }}
        />
      )}

      {param.type === 'float' && (
        <input
          id={fieldId}
          type="number"
          step="0.01"
          value={value !== null && value !== undefined ? String(value) : ''}
          min={param.min}
          max={param.max}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            set(v);
          }}
        />
      )}

      {param.type === 'string' && (
        <input
          id={fieldId}
          type="text"
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => set(e.target.value)}
        />
      )}

      {param.type === 'bool' && (
        <input
          id={fieldId}
          type="checkbox"
          checked={value === true}
          onChange={(e) => set(e.target.checked)}
        />
      )}

      {param.type === 'enum' && (
        <select
          id={fieldId}
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => {
            const v = e.target.value;
            // gpu-layers: allowNumber → also accept arbitrary integers
            if (param.allowNumber && v === '__number__') {
              // Handle in a separate input (simplification: just set the string)
              set(v);
            } else {
              // Try to parse as number
              const num = Number(v);
              set(Number.isNaN(num) ? v : num);
            }
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
      )}

      {param.type === 'path-model' && (
        <input
          id={fieldId}
          type="text"
          value={value !== null && value !== undefined ? String(value) : ''}
          placeholder={t('pathModelPlaceholder')}
          onChange={(e) => set(e.target.value)}
        />
      )}

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
  showAdvanced = false,
}: SchemaFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(showAdvanced);

  // Group params by `group`
  const groups = new Map<string, ParamSchema[]>();
  for (const param of schema) {
    const arr = groups.get(param.group) ?? [];
    arr.push(param);
    groups.set(param.group, arr);
  }

  return (
    <div className="schema-form">
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
      {schema.some((p) => p.advanced) && (
        <details className="schema-advanced" open={advancedOpen}>
          <summary onClick={() => setAdvancedOpen(!advancedOpen)}>
            {t('advancedSection')}
          </summary>
        </details>
      )}
    </div>
  );
}
