/**
 * Settings (Faza 9.3): global config — model dirs, engine binaries, port range,
 * security token.
 */
import { useCallback, useEffect, useState } from 'react';
import { getEngines, getConfig, putGlobalConfig } from '../api/client';
import type { EngineInfo } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { t } from '../i18n';
import { errInfo } from '../ui/errors';

export function Settings() {
  const [modelDirs, setModelDirs] = useState('');
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [binaryMap, setBinaryMap] = useState<Record<string, string>>({});
  const [portStart, setPortStart] = useState(8080);
  const [portEnd, setPortEnd] = useState(8090);
  const [token, setToken] = useState('');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback((): void => {
    Promise.all([getEngines(), getConfig()])
      .then(([engineList, config]) => {
        setEngines(engineList);
        // Model dirs as newline-separated text
        setModelDirs(config.global.modelDirs.join('\n'));
        // Binary map
        const binaries: Record<string, string> = {};
        for (const eng of engineList) {
          if (eng.binary) binaries[eng.id] = eng.binary;
        }
        setBinaryMap(binaries);
        // Port range
        setPortStart(config.global.portRange.start);
        setPortEnd(config.global.portRange.end);
        // Token
        setToken(config.global.security.token ?? '');
        setError(null);
      })
      .catch((err: unknown) => {
        setError(errInfo(err));
      });
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

  return (
    <section className="settings-page">
      <h2>{t('settingsHeading')}</h2>
      <ErrorNotice message={error?.message ?? null} code={error?.code} />

      {/* Model directories */}
      <fieldset>
        <legend>{t('settingsModelDirs')}</legend>
        <textarea
          className="input"
          rows={4}
          placeholder={t('settingsModelDirsPlaceholder')}
          value={modelDirs}
          onChange={(e) => setModelDirs(e.target.value)}
        />
      </fieldset>

      {/* Engine binaries */}
      <fieldset>
        <legend>{t('settingsEngines')}</legend>
        {engines.map((eng) => (
          <div key={eng.id} className="settings-engine">
            <label className="field">
              <span>{eng.displayName} — {t('settingsEngineBinary')}</span>
              <input
                type="text"
                className="input"
                value={binaryMap[eng.id] ?? ''}
                onChange={(e) =>
                  setBinaryMap((prev) => ({ ...prev, [eng.id]: e.target.value }))
                }
              />
            </label>
          </div>
        ))}
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
