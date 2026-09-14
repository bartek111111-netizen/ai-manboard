import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { InstanceInfo, ModelView, Preset } from '@ai-dashboard/shared';
import { AddModelModal } from '../components/AddModelModal';
import { CapabilityIcons } from '../components/CapabilityIcons';
import { ErrorNotice } from '../components/ErrorNotice';
import { StatusBadge } from '../components/StatusBadge';
import { discoverModels, restartInstance, startInstance, stopInstance } from '../api/client';
import { t } from '../i18n';
import { useModelData } from '../hooks/useModelData';
import { errInfo } from '../ui/errors';
import { isLiveState } from '../ui/state';

function instanceFor(instances: InstanceInfo[], modelId: string, presetName: string): InstanceInfo | null {
  return instances.find((i) => i.modelId === modelId && i.preset === presetName) ?? null;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/**
 * Model list (Faza 7.1, PLAN §20.1): one row per model, with a preset select,
 * the selected instance's state/port, and start/stop/restart actions.
 */
export function ModelList() {
  const { models, instances, presets, error, refresh, scan } = useModelData();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setActionError(null);
      refresh();
    } catch (err) {
      setActionError(errInfo(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedPreset = (model: ModelView): string | undefined =>
    selected[model.id] ?? (presets[model.id]?.[0]?.name ?? undefined);

  const [scanResult, setScanResult] = useState<{ added: number; removed: number; total: number; hidden: number } | null>(null);

  const handleScan = async (): Promise<void> => {
    setBusy(true);
    setScanResult(null);
    try {
      const result = await discoverModels();
      // Refresh first, then count hidden from the updated list
      await refresh();
      // Use the models state (which is now updated by refresh)
      setTimeout(() => {
        const hiddenCount = models.filter((m) => m.hidden).length;
        setScanResult({ added: result.added.length, removed: result.removed.length, total: result.total, hidden: hiddenCount });
      }, 100);
    } catch (err) {
      setError(errInfo(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <button type="button" onClick={handleScan} className="btn">
          {t('actionScan')}
        </button>
        <button type="button" className="btn" onClick={() => setShowAddModal(true)}>
          {t('actionAddModel')}
        </button>
        <Link to="/settings" className="btn">
          {t('navSettings')}
        </Link>
      </div>

      <ErrorNotice message={actionError?.message ?? null} code={actionError?.code} />
      {error && (
        <ErrorNotice message={error} />
      )}
      {scanResult && (
        <div className="scan-result">
          <span>
            {t('scanResult')} +{scanResult.added}, łącznie {scanResult.total}
            {scanResult.hidden > 0 ? ` (${scanResult.hidden} ukryte)` : ''}
          </span>
          <button type="button" className="btn small" onClick={() => setScanResult(null)}>×</button>
        </div>
      )}

      {showAddModal && (
        <AddModelModal
          onClose={() => setShowAddModal(false)}
          onAdded={refresh}
        />
      )}

      {models.length === 0 ? (
        <p className="muted">{t('modelsEmpty')}</p>
      ) : (
        <table className="model-table">
          <thead>
            <tr>
              <th>{t('colName')}</th>
              <th>{t('colEngine')}</th>
              <th>{t('colCapabilities')}</th>
              <th>{t('colSize')}</th>
              <th>{t('colPreset')}</th>
              <th>{t('colPort')}</th>
              <th>{t('colState')}</th>
              <th>{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const presetList: Preset[] = presets[model.id] ?? [];
              const presetName = selectedPreset(model);
              const instance = presetName ? instanceFor(instances, model.id, presetName) : null;
              const state = instance?.state ?? 'unknown';
              return (
                <tr key={model.id}>
                  <td>
                    <Link to={`/models/${encodeURIComponent(model.id)}`} className="model-name" title={model.path}>
                      {model.displayName}
                    </Link>
                  </td>
                  <td>{model.engineId}</td>
                  <td>
                    <CapabilityIcons flags={model.capabilities.flags} manual={model.capabilities.source === 'manual'} />
                  </td>
                  <td>{formatSize(model.sizeBytes)}</td>
                  <td>
                    <select
                      className="preset-select"
                      value={presetName ?? ''}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [model.id]: e.target.value }))}
                      disabled={presetList.length === 0}
                    >
                      {presetList.length === 0 && <option value="">{t('presetNone')}</option>}
                      {presetList.map((preset) => (
                        <option key={preset.name} value={preset.name}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{instance?.port ?? '—'}</td>
                  <td>
                    <StatusBadge state={state} small />
                  </td>
                  <td className="actions">
                    <button type="button" className="btn small" title="Ukryj" onClick={() => run(() => fetch(`/api/v1/models/${model.id}/hide`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden: true }) }))}>👁</button>
                    {presetName && (
                      <>
                        {!isLiveState(state) && (
                          <button
                            type="button"
                            className="btn small"
                            disabled={busy}
                            onClick={() => run(() => startInstance(`${model.id}--${presetName}`))}
                          >
                            ▶
                          </button>
                        )}
                        {isLiveState(state) && (
                          <button
                            type="button"
                            className="btn small"
                            disabled={busy}
                            onClick={() => run(() => stopInstance(`${model.id}--${presetName}`))}
                          >
                            ⏹
                          </button>
                        )}
                        {isLiveState(state) && (
                          <button
                            type="button"
                            className="btn small"
                            disabled={busy}
                            onClick={() => run(() => restartInstance(`${model.id}--${presetName}`))}
                          >
                            ↻
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
