import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ModelView } from '@ai-dashboard/shared';
import { ApiError, getModels, getPresets } from '../api/client';
import { CapabilityIcons } from '../components/CapabilityIcons';
import { InstancePanel } from '../components/InstancePanel';
import { PresetSelect } from '../components/PresetSelect';
import { t } from '../i18n';

type Tab = 'preview' | 'config' | 'instance' | 'logs' | 'metrics';

/**
 * Model detail view (Faza 7, PLAN §20.2): tabs — Podgląd, Konfiguracja
 * (PresetSelect), Instancja (InstancePanel); Logi/Metryki = Faza 8.
 */
export function ModelDetail() {
  const { modelId } = useParams<{ modelId: string }>();
  const [model, setModel] = useState<ModelView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('instance');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  // Guards the one-time default so we don't overwrite the user's choice.
  const presetDefaulted = useRef(false);

  useEffect(() => {
    presetDefaulted.current = false;
    setSelectedPreset(null);
    setModel(null);
    setError(null);
    getModels()
      .then((models) => {
        const found = models.find((m) => m.id === modelId) ?? null;
        setModel(found);
        if (!found) setError(t('modelNotFound'));
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));

    // Default to the first preset (fast path: list → model → preset).
    getPresets(modelId ?? '')
      .then((list) => {
        if (list.length > 0 && !presetDefaulted.current) {
          presetDefaulted.current = true;
          setSelectedPreset(list[0].name);
        }
      })
      .catch(() => {
        // presets unavailable — the PresetSelect shows its own error
      });
  }, [modelId]);

  const tabs: Array<{ id: Tab; label: string; disabled?: boolean }> = [
    { id: 'preview', label: t('tabPreview') },
    { id: 'config', label: t('tabConfig') },
    { id: 'instance', label: t('tabInstance') },
    { id: 'logs', label: t('tabLogs'), disabled: true },
    { id: 'metrics', label: t('tabMetrics'), disabled: true },
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
                disabled={tabDef.disabled}
                onClick={() => setTab(tabDef.id)}
              >
                {tabDef.label}
                {tabDef.disabled && <span className="muted"> (Faza 8)</span>}
              </button>
            ))}
          </div>

          {tab === 'preview' && (
            <section>
              <h3>{t('tabPreview')}</h3>
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
              selected={selectedPreset}
              onSelect={(name) => {
                setSelectedPreset(name);
                if (name) setTab('instance');
              }}
            />
          )}

          {tab === 'instance' &&
            (selectedPreset ? (
              <InstancePanel modelId={model.id} presetName={selectedPreset} />
            ) : (
              <p className="muted">{t('presetRequired')}</p>
            ))}

          {tab === 'logs' && <p className="muted">{t('comingFaza8')}</p>}
          {tab === 'metrics' && <p className="muted">{t('comingFaza8')}</p>}
        </>
      )}
    </>
  );
}
