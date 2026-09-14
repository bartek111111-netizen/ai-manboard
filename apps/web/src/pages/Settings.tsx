/**
 * Settings (Faza 9.3): global config — model dirs, engine binaries, GPU selection,
 * port range, security token.
 */
import { useCallback, useEffect, useState } from 'react';
import { getEngines, getConfig, putGlobalConfig } from '../api/client';
import type { EngineInfo } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { t } from '../i18n';
import { errInfo } from '../ui/errors';

interface GpuInfo {
  id: string;
  name: string;
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

    // Load GPUs
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

  const handleBrowseModelDir = (): void => {
    const input = window.prompt(t('browseModelDirPrompt'), '/mnt/dane/');
    if (input) {
      const dirs = modelDirs.split('\n').filter((d) => d.trim() !== '');
      dirs.push(input.trim());
      setModelDirs(dirs.join('\n'));
    }
  };

  const handleBrowseBinary = (engineId: string): void => {
    const current = binaryMap[engineId] ?? '';
    const input = window.prompt(t('browseBinaryPrompt'), current || '/mnt/dane/');
    if (input) {
      setBinaryMap((prev) => ({ ...prev, [engineId]: input.trim() }));
    }
  };

  return (
    <section className="settings-page">
      <h2>{t('settingsHeading')}</h2>
      <ErrorNotice message={error?.message ?? null} code={error?.code} />

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
          <button type="button" className="btn small" onClick={handleBrowseModelDir}>
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
                  onClick={() => handleBrowseBinary(eng.id)}
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
        {gpus.length === 0 ? (
          <p className="muted">{t('noGpusDetected')}</p>
        ) : (
          gpus.map((gpu) => (
            <label key={gpu.id} className="checkbox-field">
              <input
                type="checkbox"
                checked={selectedGpu === gpu.id}
                onChange={() => setSelectedGpu(gpu.id)}
              />
              <span>
                {gpu.name}
                {gpu.memoryTotalMB != null && (
                  <span className="gpu-memory-badge">
                    {' '}{(gpu.memoryTotalMB / 1024).toFixed(0)} GB
                  </span>
                )}
              </span>
            </label>
          ))
        )}
        {selectedGpu && (
          <p className="muted small">{t('selectedGpuForModels')} {selectedGpu}</p>
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
