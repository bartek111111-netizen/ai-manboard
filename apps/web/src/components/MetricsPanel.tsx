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
          <dd>{runtime.modelLoaded ? '✓' : '—'}</dd>

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

          {/* Work time: actual generation time */}
          {runtime.extras?.workTimeSec !== undefined && dto?.uptimeSec !== null && dto?.uptimeSec !== undefined && (
            <>
              <dt>{t('metricsWorkTime')}</dt>
              <dd>{formatUptime(runtime.extras.workTimeSec as number)}</dd>
              <dt>{t('metricsWorkPct')}</dt>
              <dd>{((runtime.extras.workTimeSec as number) / dto.uptimeSec * 100).toFixed(1)}%</dd>
            </>
          )}

          {/* CPU/RAM (per-process) */}
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

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
