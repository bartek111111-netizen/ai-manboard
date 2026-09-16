/**
 * ExternalInstanceCard (PLAN §16.4): a Status card for an engine process that
 * was launched OUTSIDE the dashboard (a script, a terminal). It shows the
 * captured settings (the full command line), port, model info, memory and GPU,
 * and is clearly marked "spoza aplikacji" — with a lighter, distinct color
 * scheme so it is obvious at a glance that the app did not start it.
 */
import type { ExternalInstanceView } from '../api/client.js';
import { t } from '../i18n/index.js';
import { formatUptime } from './InstanceMetrics.js';
import { CommandBlock } from './CommandBlock.js';

export function ExternalInstanceCard({ ext }: { ext: ExternalInstanceView }) {
  return (
    <div className="status-card status-card--external">
      <div className="status-card-header">
        <div className="status-card-names">
          <span className="status-card-title">{ext.modelName ?? '—'}</span>
          {ext.preset && <span className="status-card-preset">{ext.preset}</span>}
        </div>
        <span className="status-card-state external">{t('externalBadge')}</span>
      </div>

      <p className="status-card-external-desc">{t('externalDescription')}</p>

      {/* Process (captured from the host) */}
      <section className="metric-group">
        <h4 className="metric-group-title">{t('groupProcess')}</h4>
        <dl className="kv">
          <dt>{t('fieldPid')}</dt>
          <dd>{ext.pid}</dd>
          <dt>{t('fieldPort')}</dt>
          <dd>{ext.port ?? '—'}</dd>
          {ext.host && ext.host !== '127.0.0.1' && (
            <>
              <dt>{t('fieldHost')}</dt>
              <dd>{ext.host}</dd>
            </>
          )}
          {ext.uptimeSec !== null && ext.uptimeSec !== undefined && (
            <>
              <dt>{t('fieldUptime')}</dt>
              <dd>{formatUptime(ext.uptimeSec)}</dd>
            </>
          )}
          {ext.rssMB !== null && ext.rssMB !== undefined && (
            <>
              <dt>{t('metricsRss')}</dt>
              <dd>{`${ext.rssMB} MB`}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Model (from the live server's /v1/models) */}
      <section className="metric-group">
        <h4 className="metric-group-title">{t('groupModel')}</h4>
        <dl className="kv">
          {ext.modelPath && (
            <>
              <dt>{t('fieldModelPath')}</dt>
              <dd className="kv-mono">{ext.modelPath}</dd>
            </>
          )}
          {ext.contextSize !== null && ext.contextSize !== undefined && (
            <>
              <dt>{t('metricsContextSize')}</dt>
              <dd>{ext.contextSize}</dd>
            </>
          )}
          {ext.quantization && (
            <>
              <dt>{t('fieldQuantization')}</dt>
              <dd>{ext.quantization}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Captured settings — the full command line, shown wrapped + copyable. */}
      <section className="metric-group">
        <h4 className="metric-group-title">{t('groupParams')}</h4>
        {ext.cmdline.length > 0 ? (
          <CommandBlock command={ext.cmdline.join(' ')} className="cmd-block--inline" />
        ) : (
          <p className="muted">—</p>
        )}
      </section>

      {/* GPU (system-wide) */}
      <section className="metric-group">
        <h4 className="metric-group-title">{t('groupGpu')}</h4>
        {ext.gpu ? (
          <dl className="kv">
            <dt>{t('metricsGpuName')}</dt>
            <dd>{ext.gpu.name ?? '—'}</dd>
            <dt>{t('metricsGpuMemoryVram')}</dt>
            <dd>
              {ext.gpu.memoryUsedMB !== null && ext.gpu.memoryUsedMB !== undefined && ext.gpu.memoryTotalMB !== null && ext.gpu.memoryTotalMB !== undefined
                ? `${ext.gpu.memoryUsedMB} / ${ext.gpu.memoryTotalMB} MB`
                : '—'}
            </dd>
            <dt>{t('metricsGpuUtilization')}</dt>
            <dd>{ext.gpu.utilization !== null && ext.gpu.utilization !== undefined ? `${ext.gpu.utilization}%` : '—'}</dd>
          </dl>
        ) : (
          <p className="muted">{t('gpuNotAvailable')}</p>
        )}
      </section>
    </div>
  );
}
