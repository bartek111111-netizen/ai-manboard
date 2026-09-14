import { useCallback, useEffect, useState } from 'react';
import type { Preset } from '@ai-dashboard/shared';
import { deletePreset, duplicatePreset, getPresets, putPreset } from '../api/client';
import { ErrorNotice } from './ErrorNotice';
import { t } from '../i18n';
import { errInfo } from '../ui/errors';

/**
 * Preset selector + CRUD (Faza 7.3, PLAN §20.2/Konfiguracja): choose a preset
 * and manage the preset set (new / duplicate / delete; port + description edit).
 * The full parameter form is Faza 9 (SchemaForm).
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
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPort, setNewPort] = useState('');

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

  const current = presets.find((p) => p.name === selected) ?? null;

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
    void run(() => putPreset(modelId, current.name, { version: current.version, name: current.name, port }));
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
