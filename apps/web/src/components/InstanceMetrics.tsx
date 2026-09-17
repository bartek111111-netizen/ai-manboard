/**
 * InstanceMetrics (Faza 8.4): a grouped, self-contained metrics display that
 * both the model-preview "Metryki" tab and the "Status" page share, so they
 * always show the same data. Metrics are grouped by their source:
 *
 *   - Engine (llama-server): slots, context, generation/prefill speed, TTFT,
 *     work time (from `/metrics` + the engine's runtime probe).
 *   - Process: CPU% and RSS of the backend process.
 *   - GPU: VRAM and utilization (system-wide, sysfs / `nvidia-smi`).
 */
import type { GpuView, InstanceDto, RuntimeInfoView, LaunchMode } from '../api/client.js';
import { t } from '../i18n/index.js';
import { CommandPopover } from './CommandBlock.js';

interface InstanceMetricsProps {
  runtime: RuntimeInfoView | null;
  process: InstanceDto['process'] | null;
  gpu?: GpuView | null;
  ttft?: { tokens: number; seconds: number; tps: number } | null;
  port: number | null;
  uptimeSec: number | null;
  /** The launch command (binary + args) — revealed via the ⓘ on the Engine header. */
  command?: string | null;
  /** The launch mode ("Zostaje w tle" / "Znika z dashboardem") — a chip on the Engine header. */
  mode?: LaunchMode | null;
}

export function InstanceMetrics({ runtime, process, gpu, ttft, port, uptimeSec, command, mode }: InstanceMetricsProps) {
  const prefillTps = runtime?.extras?.prefillTps as number | undefined;
  const workTimeSec = runtime?.extras?.workTimeSec as number | undefined;
  const contextSize = runtime?.contextSize;

  return (
    <>
      {/* Engine metrics (from llama-server /metrics + runtime probe) */}
      <section className="metric-group">
        <h4 className="metric-group-title">
          {t('groupEngine')}
          {mode ? (
            <span
              className="launch-mode-chip"
              title={
                mode === 'background'
                  ? t('launchModeBackgroundDesc')
                  : t('launchModeSessionDesc')
              }
            >
              {mode === 'background'
                ? `🟢 ${t('launchModeBackground')}`
                : `⚪ ${t('launchModeSession')}`}
            </span>
          ) : null}
          {command ? <CommandPopover command={command} label={t('launchCommand')} /> : null}
        </h4>
        <dl className="kv">
          <dt>{t('fieldPort')}</dt>
          <dd>{port ?? '—'}</dd>

          {uptimeSec !== null && uptimeSec !== undefined && (
            <>
              <dt>{t('fieldUptime')}</dt>
              <dd>{formatUptime(uptimeSec)}</dd>
            </>
          )}

          {contextSize !== undefined && (
            <>
              <dt>{t('metricsContextSize')}</dt>
              <dd>{contextSize}</dd>
            </>
          )}

          {runtime?.slots && (
            <>
              <dt>{t('metricsSlots')}</dt>
              <dd>
                {runtime.slots.used}/{runtime.slots.total}
              </dd>
            </>
          )}

          {runtime?.tokensPerSec !== undefined && runtime?.tokensPerSec !== null && (
            <>
              <dt>{t('metricsTokensPerSec')}</dt>
              <dd>{runtime.tokensPerSec.toFixed(1)}</dd>
            </>
          )}

          {prefillTps !== undefined && (
            <>
              <dt>{t('metricsPrefill')}</dt>
              <dd>{prefillTps.toFixed(1)}</dd>
            </>
          )}

          {ttft && ttft.seconds > 0 && (
            <>
              <dt>{t('metricsTtft')}</dt>
              <dd>{formatSeconds(ttft.seconds)}</dd>
            </>
          )}

          {workTimeSec !== undefined && uptimeSec !== null && uptimeSec !== undefined && (
            <>
              <dt>{t('metricsWorkTime')}</dt>
              <dd>{workTimeSec > 0 ? formatUptime(workTimeSec) : '—'}</dd>
              <dt>{t('metricsWorkPct')}</dt>
              <dd>{workTimeSec > 0 ? ((workTimeSec / uptimeSec) * 100).toFixed(1) + '%' : '—'}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Process metrics (per-PID CPU/RSS) */}
      <section className="metric-group">
        <h4 className="metric-group-title">{t('groupProcess')}</h4>
        <dl className="kv">
          <dt>{t('metricsCpu')}</dt>
          <dd>{process?.cpuPct !== null && process?.cpuPct !== undefined ? `${process.cpuPct.toFixed(1)}%` : '—'}</dd>
          <dt>{t('metricsRss')}</dt>
          <dd>{process?.rssMB !== null && process?.rssMB !== undefined ? `${process.rssMB.toFixed(0)} MB` : '—'}</dd>
        </dl>
      </section>

      {/* GPU metrics (system-wide) */}
      <section className="metric-group">
        <h4 className="metric-group-title">{t('groupGpu')}</h4>
        {gpu ? (
          <dl className="kv">
            <dt>{t('metricsGpuName')}</dt>
            <dd>{gpu.name ?? '—'}</dd>
            <dt>{t('metricsGpuMemoryVram')}</dt>
            <dd>
              {gpu.memoryUsedMB !== null && gpu.memoryUsedMB !== undefined && gpu.memoryTotalMB !== null && gpu.memoryTotalMB !== undefined
                ? `${gpu.memoryUsedMB.toFixed(0)} / ${gpu.memoryTotalMB.toFixed(0)} MB`
                : '—'}
            </dd>
            <dt>{t('metricsGpuUtilization')}</dt>
            <dd>{gpu.utilization !== null && gpu.utilization !== undefined ? `${gpu.utilization}%` : '—'}</dd>
          </dl>
        ) : (
          <p className="muted">{t('gpuNotAvailable')}</p>
        )}
      </section>
    </>
  );
}

/** Formats a seconds value as a readable duration (h/m/s). */
export function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Formats a short seconds value (TTFT) — one decimal under a minute. */
function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  return formatUptime(sec);
}
