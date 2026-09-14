/**
 * MetricsPanel (Faza 8.2): runtime metrics — engine (slots, tokens/s) +
 * process (CPU/RSS) + optional GPU. Polls the metrics endpoint.
 */
import { useCallback, useEffect, useState } from 'react';
import { getInstance } from '../api/client.js';
import type { InstanceDto } from '../api/client.js';
import { t } from '../i18n/index.js';
import { ErrorNotice } from './ErrorNotice.js';

interface MetricsPanelProps {
  instanceId: string;
}

export function MetricsPanel({ instanceId }: MetricsPanelProps) {
  const [dto, setDto] = useState<InstanceDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getInstance(instanceId)
      .then((d) => {
        setDto(d);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setDto(null);
      });
  }, [instanceId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const runtime = dto?.runtime;
  const isLive = dto?.state === 'running' || dto?.state === 'starting';

  return (
    <section className="metrics-panel">
      <h3>{t('metricsHeading')}</h3>

      {error && <ErrorNotice message={error} />}

      {!isLive && !error && (
        <p className="muted">{t('metricsNotLive')}</p>
      )}

      {isLive && runtime && (
        <dl className="kv">
          <dt>{t('metricsModelLoaded')}</dt>
          <dd>{runtime.modelLoaded ?? '—'}</dd>

          <dt>{t('metricsContextSize')}</dt>
          <dd>{runtime.contextSize ?? '—'}</dd>

          {runtime.slots && (
            <>
              <dt>{t('metricsSlots')}</dt>
              <dd>
                {runtime.slots.used}/{runtime.slots.total}
              </dd>
            </>
          )}

          {runtime.tokensPerSec !== undefined && (
            <>
              <dt>{t('metricsTokensPerSec')}</dt>
              <dd>{runtime.tokensPerSec.toFixed(1)}</dd>
            </>
          )}

          {/* Process metrics (Faza 8.2: CPU/RSS from systeminformation) */}
          {dto?.process && (
            <>
              <dt>{t('metricsCpu')}</dt>
              <dd>{dto.process.cpuPct !== null ? `${dto.process.cpuPct.toFixed(1)}%` : '—'}</dd>
              <dt>{t('metricsRss')}</dt>
              <dd>{dto.process.rssMB !== null ? `${dto.process.rssMB.toFixed(0)} MB` : '—'}</dd>
            </>
          )}
        </dl>
      )}

      {isLive && !runtime && (
        <p className="muted">…</p>
      )}
    </section>
  );
}
