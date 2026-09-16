/**
 * Status page: shows running models with live metrics in columns.
 * Polls every 3s for real-time updates.
 */
import { useCallback, useEffect, useState } from 'react';
import { getInstances, getInstance, getModels, type InstanceInfo, type InstanceDto, type ModelView } from '../api/client';
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
    modelLoaded?: boolean;
    contextSize?: number;
    slots?: { total: number; used: number };
    tokensPerSec?: number;
    extras: Record<string, unknown>;
  } | null;
  process: { cpuPct: number | null; rssMB: number | null };
}

export function StatusPage() {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [models, setModels] = useState<ModelView[]>([]);
  const [metrics, setMetrics] = useState<Record<string, ModelMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    Promise.all([getInstances(), getModels()])
      .then(([instanceList, modelList]) => {
        setInstances(instanceList);
        setModels(modelList);
        setError(null);

        // Fetch metrics for each running instance
        const running = instanceList.filter((i) => i.state === 'running' || i.state === 'starting');
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
          const model = models.find((mdl) => mdl.id === inst.modelId);
          const modelName = model?.displayName ?? inst.modelId;
          return (
            <div key={inst.instanceId} className="status-card">
              <div className="status-card-header">
                <div className="status-card-names">
                  <span className="status-card-title">
                    {modelName}
                  </span>
                  <span className="status-card-preset">{inst.preset}</span>
                </div>
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

                {/* Work time: actual generation time */}
                {m?.runtime?.extras?.workTimeSec !== undefined && m?.uptimeSec !== null && m?.uptimeSec !== undefined && (
                  <>
                    <dt>{t('metricsWorkTime')}</dt>
                    <dd>{(m.runtime.extras.workTimeSec as number) > 0 ? formatUptime(m.runtime.extras.workTimeSec as number) : '—'}</dd>
                    <dt>{t('metricsWorkPct')}</dt>
                    <dd>{(m.runtime.extras.workTimeSec as number) > 0 ? ((m.runtime.extras.workTimeSec as number) / m.uptimeSec * 100).toFixed(1) + '%' : '—'}</dd>
                  </>
                )}

                {/* CPU/RAM (per-process) */}
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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60); // round to whole seconds
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
