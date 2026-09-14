/**
 * Status page: shows running models with live metrics in columns.
 * Polls every 3s for real-time updates.
 */
import { useCallback, useEffect, useState } from 'react';
import { getInstances, getInstance, type InstanceInfo, type InstanceDto } from '../api/client';
import { t } from '../i18n';

const REFRESH_INTERVAL_MS = 3000;

interface ModelMetrics {
  instanceId: string;
  modelId: string;
  preset: string;
  state: string;
  port: number | null;
  uptimeSec: number | null;
  runtime: {
    modelLoaded?: string | null;
    contextSize?: number | null;
    slots?: { used: number; total: number } | null;
    tokensPerSec?: number | null;
  } | null;
  process: { cpuPct: number | null; rssMB: number | null } | null;
}

export function StatusPage() {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [metrics, setMetrics] = useState<Record<string, ModelMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    getInstances()
      .then((list) => {
        setInstances(list);
        setError(null);

        // Fetch metrics for each running instance
        const running = list.filter((i) => i.state === 'running' || i.state === 'starting');
        running.forEach((inst) => {
          getInstance(inst.instanceId)
            .then((dto: InstanceDto) => {
              setMetrics((prev) => ({
                ...prev,
                [inst.instanceId]: {
                  instanceId: inst.instanceId,
                  modelId: inst.modelId,
                  preset: inst.preset,
                  state: dto.state,
                  port: dto.port,
                  uptimeSec: dto.uptimeSec,
                  runtime: dto.runtime,
                  process: dto.process,
                },
              }));
            })
            .catch(() => {});
        });
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

  if (error) {
    return (
      <section>
        <h2>{t('statusHeading')}</h2>
        <p className="status-error">{error}</p>
      </section>
    );
  }

  const running = instances.filter((i) => i.state === 'running' || i.state === 'starting');

  if (running.length === 0) {
    return (
      <section>
        <h2>{t('statusHeading')}</h2>
        <p className="muted">{t('noRunningModels')}</p>
      </section>
    );
  }

  return (
    <section>
      <h2>{t('statusHeading')} ({running.length})</h2>
      <div className="status-grid">
        {running.map((inst) => {
          const m = metrics[inst.instanceId];
          return (
            <div key={inst.instanceId} className="status-card">
              <div className="status-card-header">
                <span className="status-card-title">
                  {m ? m.preset : inst.preset}
                </span>
                <span className="status-card-state running">
                  {t('stateRunning')}
                </span>
              </div>

              <dl className="kv status-kv">
                <dt>{t('fieldPort')}</dt>
                <dd>{m?.port ?? '—'}</dd>

                {m?.uptimeSec !== null && m?.uptimeSec !== undefined && (
                  <>
                    <dt>{t('fieldUptime')}</dt>
                    <dd>{formatUptime(m.uptimeSec)}</dd>
                  </>
                )}

                {m?.runtime?.slots && (
                  <>
                    <dt>{t('metricsSlots')}</dt>
                    <dd>{m.runtime.slots.used}/{m.runtime.slots.total}</dd>
                  </>
                )}

                {m?.runtime?.tokensPerSec !== null && m?.runtime?.tokensPerSec !== undefined && (
                  <>
                    <dt>{t('metricsTokensPerSec')}</dt>
                    <dd>{m.runtime.tokensPerSec.toFixed(1)}</dd>
                  </>
                )}

                {m?.process && (
                  <>
                    <dt>{t('metricsCpu')}</dt>
                    <dd>{m.process.cpuPct !== null ? `${m.process.cpuPct.toFixed(1)}%` : '—'}</dd>
                    <dt>{t('metricsRss')}</dt>
                    <dd>{m.process.rssMB !== null ? `${m.process.rssMB.toFixed(0)} MB` : '—'}</dd>
                  </>
                )}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Formats uptime in seconds to a readable string. */
function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  return `${hours}h ${mins}m`;
}
