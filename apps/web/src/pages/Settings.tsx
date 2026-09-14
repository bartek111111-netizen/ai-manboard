/**
 * Settings (Faza 9.3): global config — model dirs, engine binaries, GPU selection,
 * port range, security token.
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
  const [modelDirs, setModelDirs] = useState('');
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [binaryMap, setBinaryMap] = useState<Record<string, string>>({});
  const [portStart, setPortStart] = useState(8080);
  const [portEnd, setPortEnd] = useState(8090);
  const [token, setToken] = useState('');
  const [gpus, setGpus] = useState<GpuInfo[]>([]);
  const [selectedGpu, setSelectedGpu] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pickerMode, setPickerMode] = useState<{ type: 'modelDir' | 'binary'; engineId?: string } | null>(null);

  const load = useCallback((): void => {
    Promise.all([getEngines(), getConfig()])
      .then(([engineList, config]) => {
        setEngines(engineList);
        setModelDirs(config.global.modelDirs.join('\n'));
        const binaries: Record<string, string> = {};
        for (const eng of engineList) {
          if (eng.binary) binaries[eng.id] = eng.binary;
        }
        setBinaryMap(binaries);
        setPortStart(config.global.portRange.start);
        setPortEnd(config.global.portRange.end);
        setToken(config.global.security.token ?? '');
        setError(null);
      })
      .catch((err: unknown) => {
        setError(errInfo(err));
      });

    fetch('/api/v1/gpus')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { gpus: GpuInfo[] }) => {
        setGpus(data.gpus);
      })
      .catch(() => setGpus([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = (): void => {
    setBusy(true);
    setSaved(false);
    const dirs = modelDirs.split('\n').map((s) => s.trim()).filter(Boolean);
    const body = {
      version: 1,
      modelDirs: dirs,
      defaults: {},
      portRange: { start: portStart, end: portEnd },
      engines: Object.fromEntries(
        Object.entries(binaryMap).map(([id, binary]) => [id, { binary }]),
      ),
      server: { host: '127.0.0.1', port: 3100 },
      security: { token: token.trim() !== '' ? token.trim() : null },
      monitoring: { probeIntervalSec: 2, startupTimeoutSec: 30 },
      logs: { ringLines: 200, retentionFiles: 5 },
      gpu: { preferred: selectedGpu },
    };
    putGlobalConfig(body)
      .then(() => {
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      })
      .catch((err: unknown) => {
        setError(errInfo(err));
      })
      .finally(() => setBusy(false));
  };

  const handlePickerSelect = (path: string): void => {
    if (pickerMode?.type === 'modelDir') {
      const dirs = modelDirs.split('\n').filter((d) => d.trim() !== '');
      if (!dirs.includes(path)) dirs.push(path);
      setModelDirs(dirs.join('\n'));
    } else if (pickerMode?.type === 'binary' && pickerMode.engineId) {
      setBinaryMap((prev) => ({ ...prev, [pickerMode.engineId!]: path }));
    }
    setPickerMode(null);
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

      {/* Model directories */}
      <fieldset>
        <legend>{t('settingsModelDirs')}</legend>
        <div className="file-input-row">
          <textarea
            className="input"
            rows={4}
            placeholder={t('settingsModelDirsPlaceholder')}
            value={modelDirs}
            onChange={(e) => setModelDirs(e.target.value)}
          />
          <button type="button" className="btn small" onClick={() => setPickerMode({ type: 'modelDir' })}>
            {t('browseBtn')}
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
              </div>
            </label>
          </div>
        ))}
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
                checked={selectedGpu === gpu.id}
                onChange={() => setSelectedGpu(gpu.id)}
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
