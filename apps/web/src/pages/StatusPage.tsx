import { useEffect, useState } from 'react';
import { getStatus, type DashboardStatus } from '../api/client';
import { t } from '../i18n';

/**
 * Home view (phase 0): dashboard API status.
 * From phase 3 on this view becomes the model list.
 */
export function StatusPage() {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getStatus()
      .then((result) => {
        if (!active) return;
        setStatus(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

  return (
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
          {status.engines.length === 0
            ? t('enginesEmpty')
            : String(status.engines.length)}
        </dd>
      </dl>
    </section>
  );
}
