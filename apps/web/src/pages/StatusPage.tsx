/**
 * Status page: shows running models with live metrics in columns.
 * Polls every 3s for real-time updates. Uses the shared `InstanceMetrics`
 * component (same grouped data as the model-preview "Metryki" tab).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getInstances,
  getInstance,
  getModels,
  getExternalInstances,
  type InstanceInfo,
  type InstanceDto,
  type ModelView,
  type ExternalInstanceView,
} from '../api/client';
import { t } from '../i18n';
import { InstanceMetrics } from '../components/InstanceMetrics.js';
import { ExternalInstanceCard } from '../components/ExternalInstanceCard.js';

const REFRESH_INTERVAL_MS = 3000;

interface ModelMetrics {
  instanceId: string;
  modelId: string;
  preset: string;
  state: string;
  port: number | null;
  command: string;
  endpoint: string;
  uptimeSec: number | null;
  runtime: InstanceDto['runtime'];
  process: InstanceDto['process'];
  gpu?: InstanceDto['gpu'];
  ttft?: InstanceDto['ttft'];
}

export function StatusPage() {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [models, setModels] = useState<ModelView[]>([]);
  const [metrics, setMetrics] = useState<Record<string, ModelMetrics>>({});
  const [external, setExternal] = useState<ExternalInstanceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    // External detection is best-effort: a failure there must not blank the whole page.
    Promise.all([getInstances(), getModels(), getExternalInstances().catch(() => [] as ExternalInstanceView[])])
      .then(([instanceList, modelList, extList]) => {
        setInstances(instanceList);
        setModels(modelList);
        setExternal(extList);
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
                  command: dto.command,
                  endpoint: dto.endpoint,
                  uptimeSec: dto.uptimeSec,
                  runtime: dto.runtime,
                  process: dto.process,
                  gpu: dto.gpu,
                  ttft: dto.ttft,
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

  if (running.length === 0 && external.length === 0) {
    return (
      <section>
        <h2>{t('statusHeading')}</h2>
        <p className="muted">{t('noRunningModels')}</p>
      </section>
    );
  }

  const total = running.length + external.length;

  return (
    <section>
      <h2>{t('statusHeading')} ({total})</h2>
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

              {m?.endpoint && (
                <a
                  className="status-card-chat"
                  href={new URL(m.endpoint).origin + '/'}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t('openChatInBrowser')}
                </a>
              )}

              {m ? (
                <div className="status-card-metrics">
                  <InstanceMetrics
                    runtime={m.runtime}
                    process={m.process}
                    gpu={m.gpu}
                    ttft={m.ttft}
                    port={m.port}
                    uptimeSec={m.uptimeSec}
                    command={m.command}
                  />
                </div>
              ) : (
                <dl className="kv status-kv">
                  <dt>{t('fieldPort')}</dt>
                  <dd>{'—'}</dd>
                </dl>
              )}
            </div>
          );
        })}

        {/* Engine processes launched outside the app (PLAN §16.4) — same grid,
            lighter color + a "spoza aplikacji" title marker. */}
        {external.map((ext) => (
          <ExternalInstanceCard key={ext.pid} ext={ext} />
        ))}
      </div>
    </section>
  );
}
