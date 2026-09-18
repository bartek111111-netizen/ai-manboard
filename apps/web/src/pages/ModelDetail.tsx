import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { ModelView } from '@ai-dashboard/shared';
import { ApiError, getModels, getPresets } from '../api/client';
import type { Preset } from '../api/client';
import { CapabilityIcons } from '../components/CapabilityIcons';
import { InstancePanel } from '../components/InstancePanel';
import { LogViewer } from '../components/LogViewer';
import { MetricsPanel } from '../components/MetricsPanel';
import { PresetSelect } from '../components/PresetSelect';
import { t } from '../i18n';

/** Extracts a human-readable name from a model filename. */
function nameFromPath(path: string): string {
  const base = path.split('/').pop() ?? '';
  return base.replace(/\.gguf$/i, '').replace(/[-_]/g, ' ').trim();
}

type Tab = 'preview' | 'config' | 'instance' | 'logs' | 'metrics';
const TAB_IDS: readonly string[] = ['preview', 'config', 'instance', 'logs', 'metrics'];

/**
 * Model detail view (Faza 7, PLAN §20.2): tabs — Podgląd, Konfiguracja
 * (PresetSelect), Instancja (InstancePanel); Logi/Metryki = Faza 8.
 *
 * The selected sub-tab + preset live in the URL search params
 * (`#/models/:id?tab=logs&preset=...`), so a sub-page is a stable hard-link:
 * a refresh (or the Status page's "Konfiguracja" / "Logi" shortcuts) restores
 * the exact sub-view instead of bouncing back to "Instancja".
 */
export function ModelDetail() {
  const { modelId } = useParams<{ modelId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [model, setModel] = useState<ModelView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [savingName, setSavingName] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);

  // The sub-tab + preset are persisted in the URL (see the component note).
  const tab: Tab = TAB_IDS.includes(searchParams.get('tab') ?? '')
    ? (searchParams.get('tab') as Tab)
    : 'instance';
  const preset = searchParams.get('preset');

  const updateTab = (next: Tab): void =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev.toString());
        p.set('tab', next);
        return p;
      },
      { replace: true },
    );

  const updatePreset = (name: string | null): void =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev.toString());
        if (name) p.set('preset', name);
        else p.delete('preset');
        return p;
      },
      { replace: true },
    );

  // Select a preset AND move to the instance tab in ONE navigation. Two
  // back-to-back setSearchParams calls in the same tick both read the same
  // stale base and the last one wins, clobbering the preset we just set —
  // this was the "old profile still in the URL" bug.
  const selectPreset = (name: string | null): void =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev.toString());
        if (name) {
          p.set('preset', name);
          p.set('tab', 'instance');
        } else {
          p.delete('preset');
        }
        return p;
      },
      { replace: true },
    );

  // Load the model + its presets (on model change).
  useEffect(() => {
    setModel(null);
    setError(null);
    setPresets([]);
    getModels()
      .then((models) => {
        const found = models.find((m) => m.id === modelId) ?? null;
        setModel(found);
        // Auto-detect name from filename (or use existing displayName)
        if (found) {
          setEditName(found.displayName || nameFromPath(found.path));
        }
        if (!found) setError(t('modelNotFound'));
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));

    getPresets(modelId ?? '')
      .then((list) => setPresets(list))
      .catch(() => {
        // presets unavailable — the PresetSelect shows its own error
      });
  }, [modelId]);

  // Default to the first preset (fast path: list → model → preset) when the
  // URL carries none — a fresh navigation lands ready to run.
  useEffect(() => {
    if (!preset && presets.length > 0) {
      updatePreset(presets[0].name);
    }
  }, [preset, presets]);

  const saveName = async (): Promise<void> => {
    if (!model) return;
    setSavingName(true);
    try {
      await fetch(`/api/v1/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: editName }),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      setModel((prev) => (prev ? { ...prev, displayName: editName } : prev));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSavingName(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'preview', label: t('tabPreview') },
    { id: 'config', label: t('tabConfig') },
    { id: 'instance', label: t('tabInstance') },
    { id: 'logs', label: t('tabLogs') },
    { id: 'metrics', label: t('tabMetrics') },
  ];

  return (
    <>
      {error && !model && (
        <section>
          <h2>{error}</h2>
        </section>
      )}

      {model && (
        <>
          <h2>{model.displayName}</h2>
          <div className="tabs">
            {tabs.map((tabDef) => (
              <button
                key={tabDef.id}
                type="button"
                className={`tab${tab === tabDef.id ? ' active' : ''}`}
                onClick={() => updateTab(tabDef.id)}
              >
                {tabDef.label}
              </button>
            ))}
          </div>

          {tab === 'preview' && (
            <section>
              <h3>{t('tabPreview')}</h3>
              <div className="form-field">
                <label className="form-field-label">{t('fieldName')}</label>
                <div className="form-field-row">
                  <input
                    type="text"
                    className="input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <button type="button" className="btn small" disabled={savingName} onClick={saveName}>
                    {t('actionSave')}
                  </button>
                </div>
              </div>
              <dl className="kv">
                <dt>{t('fieldEngine')}</dt>
                <dd>{model.engineId}</dd>
                <dt>{t('fieldPath')}</dt>
                <dd>{model.path}</dd>
                <dt>{t('fieldSize')}</dt>
                <dd>{model.sizeBytes !== null ? `${(model.sizeBytes / 1e9).toFixed(1)} GB` : '—'}</dd>
                {model.gguf?.architecture && (
                  <>
                    <dt>{t('fieldArch')}</dt>
                    <dd>{model.gguf.architecture}</dd>
                  </>
                )}
                {model.gguf?.contextLength && (
                  <>
                    <dt>{t('fieldContext')}</dt>
                    <dd>{model.gguf.contextLength}</dd>
                  </>
                )}
                <dt>{t('colCapabilities')}</dt>
                <dd>
                  <CapabilityIcons flags={model.capabilities.flags} manual={model.capabilities.source === 'manual'} />
                </dd>
              </dl>
            </section>
          )}

          {tab === 'config' && (
            <PresetSelect
              modelId={model.id}
              selected={preset}
              onSelect={selectPreset}
            />
          )}

          {tab === 'instance' &&
            (preset ? (
              <InstancePanel modelId={model.id} presetName={preset} />
            ) : (
              <p className="muted">{t('presetRequired')}</p>
            ))}

          {tab === 'logs' &&
            (preset ? (
              <LogViewer instanceId={`${model.id}--${preset}`} modelId={model.id} />
            ) : (
              <p className="muted">{t('presetRequired')}</p>
            ))}
          {tab === 'metrics' &&
            (preset ? (
              <MetricsPanel instanceId={`${model.id}--${preset}`} />
            ) : (
              <p className="muted">{t('presetRequired')}</p>
            ))}
        </>
      )}
    </>
  );
}
