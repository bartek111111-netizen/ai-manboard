/**
 * Settings (Faza 9.3): global config — model dirs (list), engine binaries,
 * GPU selection, port range, security token.
 */
import { useCallback, useEffect, useState } from 'react';
import { getEngines, getConfig, putGlobalConfig } from '../api/client';
import type { EngineInfo } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { FilePicker } from '../components/FilePicker';
import { t } from '../i18n';
import { errInfo } from '../ui/errors';

interface GpuInfo {
  id: string;
  name: string;
  pciSlot: string;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
  utilization: number | null;
  driver: string;
}

export function Settings() {
  const [modelDirs, setModelDirs] = useState<string[]>([]);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [binaryMap, setBinaryMap] = useState<Record<string, string>>({});
  const [portStart, setPortStart] = useState(8080);
  const [portEnd, setPortEnd] = useState(8090);
  const [token, setToken] = useState('');
  const [gpus, setGpus] = useState<GpuInfo[]>([]);
  const [preferredGpu, setPreferredGpu] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pickerMode, setPickerMode] = useState<{ type: 'modelDir' | 'binary'; engineId?: string } | null>(null);
  const [hiddenModels, setHiddenModels] = useState<{ id: string; displayName: string; path: string }[]>([]);

  const load = useCallback((): void => {
    Promise.all([getEngines(), getConfig()])
      .then(([engineList, config]) => {
        setEngines(engineList);
        setModelDirs(config.global.modelDirs);
        const binaries: Record<string, string> = {};
        for (const eng of engineList) {
          if (eng.binary) binaries[eng.id] = eng.binary;
        }
        setBinaryMap(binaries);
        setPortStart(config.global.portRange.start);
        setPortEnd(config.global.portRange.end);
        setToken(config.global.security.token ?? '');
        setPreferredGpu(config.global.gpu?.preferred ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(errInfo(err));
      });

    fetch('/api/v1/gpus')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { gpus: GpuInfo[] }) => setGpus(data.gpus))
      .catch(() => setGpus([]));

    fetch('/api/v1/models/hidden')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { models: { id: string; displayName: string; path: string }[] }) => {
        setHiddenModels(data.models);
      })
      .catch(() => setHiddenModels([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = (): void => {
    setBusy(true);
    setSaved(false);
    const body = {
      version: 1,
      modelDirs,
      defaults: {},
      portRange: { start: portStart, end: portEnd },
      engines: Object.fromEntries(
        Object.entries(binaryMap).map(([id, binary]) => [id, { binary }]),
      ),
      server: { host: '127.0.0.1', port: 3100 },
      security: { token: token.trim() !== '' ? token.trim() : null },
      monitoring: { probeIntervalSec: 2, startupTimeoutSec: 30 },
      logs: { ringLines: 200, retentionFiles: 5 },
      gpu: { preferred: preferredGpu },
    };
    putGlobalConfig(body)
      .then(() => {
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      })
      .catch((err: unknown) => setError(errInfo(err)))
      .finally(() => setBusy(false));
  };

  const handlePickerSelect = (path: string): void => {
    if (pickerMode?.type === 'modelDir') {
      if (!modelDirs.includes(path)) setModelDirs([...modelDirs, path]);
    } else if (pickerMode?.type === 'binary' && pickerMode.engineId) {
      setBinaryMap((prev) => ({ ...prev, [pickerMode.engineId!]: path }));
    }
    setPickerMode(null);
  };

  const removeDir = (dir: string): void => {
    setModelDirs(modelDirs.filter((d) => d !== dir));
  };

  return (
    <section className="settings-page">
      <h2>{t('settingsHeading')}</h2>
      <ErrorNotice message={error?.message ?? null} code={error?.code} />

      {/* File picker modal */}
      {pickerMode && (
        <FilePicker
          initialPath="/mnt/dane"
          onSelect={handlePickerSelect}
          onClose={() => setPickerMode(null)}
          isFile={pickerMode.type === 'binary'}
        />
      )}

      {/* Model directories — list with add/remove */}
      <fieldset>
        <legend>{t('settingsModelDirs')}</legend>
        <div className="settings-dir-list">
          {modelDirs.length === 0 ? (
            <p className="muted">{t('noModelDirs')}</p>
          ) : (
            modelDirs.map((dir, idx) => (
              <div key={idx} className="settings-dir-row">
                <span className="settings-dir-path">{dir}</span>
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() => removeDir(dir)}
                  title={t('removeDir')}
                >
                  ✕
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn small"
            onClick={() => setPickerMode({ type: 'modelDir' })}
          >
            + {t('addModelDir')}
          </button>
        </div>
      </fieldset>

      {/* Engine binaries */}
      <fieldset>
        <legend>{t('settingsEngines')}</legend>
        {engines.map((eng) => (
          <div key={eng.id} className="settings-engine">
            <label className="field">
              <span>{eng.displayName} — {t('settingsEngineBinary')}</span>
              <div className="file-input-row">
                <input
                  type="text"
                  className="input"
                  value={binaryMap[eng.id] ?? ''}
                  onChange={(e) =>
                    setBinaryMap((prev) => ({ ...prev, [eng.id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setPickerMode({ type: 'binary', engineId: eng.id })}
                >
                  {t('browseBtn')}
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    fetch('/api/v1/engines/detect')
                      .then((r) => r.json())
                      .then((data: { found: boolean; binary: string | null }) => {
                        if (data.found && data.binary) {
                          setBinaryMap((prev) => ({ ...prev, [eng.id]: data.binary as string }));
                        }
                      })
                      .catch(() => {});
                  }}
                >
                  {t('autoDetectBtn')}
                </button>
              </div>
            </label>
          </div>
        ))}
      </fieldset>

      {/* Hidden models */}
      <fieldset>
        <legend>{t('hiddenModelsHeading')}</legend>
        {hiddenModels.length === 0 ? (
          <p className="muted">{t('noHiddenModels')}</p>
        ) : (
          <div className="hidden-models-list">
            {hiddenModels.map((model) => (
              <div key={model.id} className="hidden-model-row">
                <span className="hidden-model-name">{model.displayName}</span>
                <span className="hidden-model-path">{model.path}</span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    fetch(`/api/v1/models/${model.id}/hide`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ hidden: false }),
                    })
                      .then(() => {
                        setHiddenModels(hiddenModels.filter((m) => m.id !== model.id));
                      })
                      .catch(() => {});
                  }}
                >
                  {t('unhideModel')}
                </button>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      {/* GPU selection */}
      <fieldset>
        <legend>{t('settingsGpuSelection')}</legend>
        <p className="settings-gpu-desc">{t('gpuSelectionDesc')}</p>
        {gpus.length === 0 ? (
          <p className="muted">{t('noGpusDetected')}</p>
        ) : (
          gpus.map((gpu) => (
            <label key={gpu.id} className="checkbox-field gpu-card">
              <input
                type="checkbox"
                checked={preferredGpu === gpu.id}
                onChange={() => setPreferredGpu(gpu.id)}
              />
              <div className="gpu-card-info">
                <div className="gpu-card-name">{gpu.name}</div>
                <div className="gpu-card-details">
                  <span className="gpu-pci-slot">{gpu.pciSlot}</span>
                  {gpu.memoryTotalMB != null && (
                    <span className="gpu-memory-badge">{(gpu.memoryTotalMB / 1024).toFixed(0)} GB VRAM</span>
                  )}
                  <span className="gpu-driver">{gpu.driver}</span>
                </div>
              </div>
            </label>
          ))
        )}
      </fieldset>

      {/* Port range */}
      <fieldset>
        <legend>{t('settingsPortRange')}</legend>
        <label className="field">
          <span>{t('settingsPortStart')}</span>
          <input
            type="number"
            className="input"
            value={portStart}
            onChange={(e) => setPortStart(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>{t('settingsPortEnd')}</span>
          <input
            type="number"
            className="input"
            value={portEnd}
            onChange={(e) => setPortEnd(Number(e.target.value))}
          />
        </label>
      </fieldset>

      {/* Security */}
      <fieldset>
        <legend>{t('settingsSecurity')}</legend>
        <label className="field">
          <span>{t('settingsToken')}</span>
          <input
            type="text"
            className="input"
            placeholder={t('settingsTokenPlaceholder')}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </fieldset>

      <div className="instance-actions">
        <button type="button" className="btn" disabled={busy} onClick={save}>
          {t('settingsSave')}
        </button>
        {saved && <span className="status-ok">{t('settingsSaved')}</span>}
      </div>
    </section>
  );
}
