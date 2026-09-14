import { useCallback, useEffect, useState } from 'react';
import type { ParamSchema, Preset } from '@ai-dashboard/shared';
import { deletePreset, duplicatePreset, getEngineSchema, getModels, getPresets, putPreset } from '../api/client';
import { ErrorNotice } from './ErrorNotice';
import { SchemaForm } from './SchemaForm';
import { t } from '../i18n';
import { errInfo } from '../ui/errors';

/**
 * Preset selector + CRUD (Faza 7.3 + 9.2): choose a preset, manage the set
 * (new / duplicate / delete), and edit the full parameter form (SchemaForm).
 */
export function PresetSelect({
  modelId,
  selected,
  onSelect,
}: {
  modelId: string;
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [schema, setSchema] = useState<ParamSchema[]>([]);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPort, setNewPort] = useState('');
  const [editParams, setEditParams] = useState<Record<string, unknown>>({});
  const [savingParams, setSavingParams] = useState(false);

  const refresh = useCallback((): void => {
    getPresets(modelId)
      .then((list) => {
        setPresets(list);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(errInfo(err));
      });
  }, [modelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fetch the model's engine schema (for the SchemaForm).
  useEffect(() => {
    getModels()
      .then((models) => {
        const model = models.find((m) => m.id === modelId);
        if (model) {
          return getEngineSchema(model.engineId).then(setSchema);
        }
        return null;
      })
      .catch(() => {
        // schema unavailable — the form will be empty
      });
  }, [modelId]);

  const current = presets.find((p) => p.name === selected) ?? null;

  // Sync editParams when the preset changes.
  useEffect(() => {
    if (current) {
      setEditParams({ ...current.params });
    } else {
      setEditParams({});
    }
  }, [selected, current]);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      await refresh();
    } catch (err) {
      setError(errInfo(err));
    } finally {
      setBusy(false);
    }
  };

  const createPreset = (): void => {
    const name = newName.trim();
    if (!name) return;
    const port = newPort.trim() !== '' ? Number(newPort) : undefined;
    void run(() => putPreset(modelId, name, { version: 1, name, port, params: {} })).then(() => {
      setNewName('');
      setNewPort('');
      onSelect(name);
    });
  };

  const duplicate = (): void => {
    if (!current) return;
    const target = window.prompt(t('dupPrompt'), `${current.name}-copy`) ?? '';
    if (!target) return;
    void run(() => duplicatePreset(modelId, current.name, target));
  };

  const remove = (): void => {
    if (!current) return;
    if (!window.confirm(t('delConfirm'))) return;
    void run(() => deletePreset(modelId, current.name)).then(() => onSelect(null));
  };

  const saveMeta = (): void => {
    if (!current) return;
    const port = newPort.trim() !== '' ? Number(newPort) : current.port;
    void run(() =>
      putPreset(modelId, current.name, {
        version: current.version,
        name: current.name,
        port,
        params: current.params,
      }),
    );
  };

  const saveParams = (): void => {
    if (!current) return;
    setSavingParams(true);
    void run(() =>
      putPreset(modelId, current.name, {
        version: current.version,
        name: current.name,
        port: current.port,
        params: editParams,
      }),
    ).finally(() => setSavingParams(false));
  };

  const handleParamChange = (key: string, value: unknown): void => {
    setEditParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <section>
      <h3>{t('presetHeading')}</h3>
      <ErrorNotice message={error?.message ?? null} code={error?.code} />

      {presets.length === 0 ? (
        <p className="muted">{t('presetsEmpty')}</p>
      ) : (
        <>
          <label className="field">
            <span>{t('presetSelect')}</span>
            <select className="preset-select" value={selected ?? ''} onChange={(e) => onSelect(e.target.value || null)}>
              {presets.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name}
                  {preset.port ? ` (${preset.port})` : ''}
                </option>
              ))}
            </select>
          </label>

          {current && (
            <>
              <dl className="kv">
                <dt>{t('fieldPort')}</dt>
                <dd>
                  <input
                    type="number"
                    className="input"
                    value={newPort !== '' ? newPort : (current.port ?? 0).toString()}
                    onChange={(e) => setNewPort(e.target.value)}
                  />
                  <button type="button" className="btn small" onClick={saveMeta}>
                    {t('actionSave')}
                  </button>
                </dd>
              </dl>

              {/* SchemaForm: full parameter editing (Faza 9.2) */}
              {schema.length > 0 && (
                <div className="preset-params">
                  <h4>{t('presetParamsHeading')}</h4>
                  <SchemaForm
                    schema={schema.filter((p) => p.key !== 'model')}
                    values={editParams}
                    onChange={handleParamChange}
                  />
                  <div className="instance-actions">
                    <button type="button" className="btn" disabled={savingParams} onClick={saveParams}>
                      {t('presetSave')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={savingParams}
                      onClick={() => {
                        // Reset to the preset's current params
                        setEditParams({ ...current.params });
                      }}
                    >
                      {t('presetCancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="instance-actions">
            {current && (
              <button type="button" className="btn small" disabled={busy} onClick={duplicate}>
                {t('actionDuplicate')}
              </button>
            )}
            {current && (
              <button type="button" className="btn small danger" disabled={busy} onClick={remove}>
                {t('actionDelete')}
              </button>
            )}
          </div>
        </>
      )}

      <div className="preset-create">
        <input
          type="text"
          className="input"
          placeholder={t('newPresetPlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          type="number"
          className="input"
          placeholder={t('newPresetPortPlaceholder')}
          value={newPort}
          onChange={(e) => setNewPort(e.target.value)}
        />
        <button type="button" className="btn" disabled={busy || newName.trim() === ''} onClick={createPreset}>
          {t('actionNewPreset')}
        </button>
      </div>
    </section>
  );
}
