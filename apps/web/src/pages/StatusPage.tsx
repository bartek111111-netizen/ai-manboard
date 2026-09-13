import { useCallback, useEffect, useState } from 'react';
import { getStatus, type DashboardStatus } from '../api/client';
import { t } from '../i18n';

const REFRESH_INTERVAL_MS = 5000;

/**
 * Home view (Faza 1): dashboard API status + config watch state (P-12).
 * Polls the status every 5 s so on-disk config changes surface in the UI.
 * From phase 3 on this view becomes the model list.
 */
export function StatusPage() {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback((): void => {
    getStatus()
      .then((result) => {
        setStatus(result);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (loading) {
    return <p className="muted">{t('statusLoading')}</p>;
  }

  if (error || !status) {
    return (
      <section>
        <h2>{t('statusHeading')}</h2>
        <p className="status-error">{error ?? t('statusError')}</p>
        <p className="muted">{t('statusErrorHint')}</p>
      </section>
    );
  }

  const config = status.config;

  return (
    <>
      <section>
        <h2>{t('statusHeading')}</h2>
        <p className="status-ok">{t('statusOk')}</p>
        <dl className="kv">
          <dt>{t('fieldAppName')}</dt>
          <dd>{status.name}</dd>
          <dt>{t('fieldVersion')}</dt>
          <dd>{status.version}</dd>
          <dt>{t('fieldState')}</dt>
          <dd>{status.state}</dd>
          <dt>{t('fieldUptime')}</dt>
          <dd>{status.uptimeSec} s</dd>
          <dt>{t('fieldEngines')}</dt>
          <dd>
            {status.engines.length === 0 ? t('enginesEmpty') : String(status.engines.length)}
          </dd>
        </dl>
        <p className="muted small">{t('statusAutoRefresh')}</p>
      </section>

      {config && (
        <section>
          <h2>{t('configHeading')}</h2>
          <dl className="kv">
            <dt>{t('configHome')}</dt>
            <dd>{config.home}</dd>
            <dt>{t('configWatchActive')}</dt>
            <dd>{config.watchActive ? t('configWatchOn') : t('configWatchOff')}</dd>
            <dt>{t('configLastChange')}</dt>
            <dd>{config.lastExternalChangeAt ?? t('configNoChanges')}</dd>
            <dt>{t('configReloadCount')}</dt>
            <dd>{config.reloadCount}</dd>
            {config.lastReloadError && (
              <>
                <dt>{t('configReloadError')}</dt>
                <dd className="status-error">{config.lastReloadError}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </>
  );
}
