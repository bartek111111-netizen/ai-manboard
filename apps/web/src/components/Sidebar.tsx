/**
 * Left sidebar with always-on system stats (GPU/CPU/RAM).
 * Uses the preferred GPU from Settings config.
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';

interface GpuMetrics {
  name: string;
  memoryUsedMB?: number | null;
  memoryTotalMB?: number | null;
  utilization?: number | null;
}

interface CpuMetrics {
  usagePct?: number;
  temperatureC?: number | null;
}

interface SystemMetrics {
  gpu?: GpuMetrics | null;
  cpu?: CpuMetrics | null;
  ram?: { usedMB: number; totalMB: number };
}

interface GpuEntry {
  id: string;
  name: string;
  pciSlot: string;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
  utilization: number | null;
  driver: string;
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="sidebar-bar-track">
      <div className="sidebar-bar-fill" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

function StatRow({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="sidebar-stat">
      <div className="sidebar-stat-header">
        <span className="sidebar-stat-label">{label}</span>
        <span className="sidebar-stat-value">{value}</span>
      </div>
      <MiniBar pct={pct} color={color} />
    </div>
  );
}

function colorForPct(pct: number): string {
  if (pct > 90) return 'var(--color-state-error)';
  if (pct > 70) return 'var(--color-state-stopping)';
  return 'var(--color-state-running)';
}

export function Sidebar() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [gpus, setGpus] = useState<GpuEntry[]>([]);
  const [preferredGpu, setPreferredGpu] = useState<string | null>(null);
  const [runningCount, setRunningCount] = useState(0);

  const load = useCallback(() => {
    // Load metrics
    fetch('/api/v1/system/metrics')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: SystemMetrics) => setMetrics(data))
      .catch(() => setMetrics(null));

    // Load GPU list
    fetch('/api/v1/gpus')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { gpus: GpuEntry[] }) => setGpus(data.gpus))
      .catch(() => setGpus([]));

    // Load config for preferred GPU
    fetch('/api/v1/config')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { global: { gpu?: { preferred?: string | null } } }) => {
        setPreferredGpu(data.global.gpu?.preferred ?? null);
      })
      .catch(() => setPreferredGpu(null));

    // Load running instance count
    fetch('/api/v1/instances')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { instances: { state: string }[] }) => {
        const count = data.instances.filter((i) => i.state === 'running' || i.state === 'starting').length;
        setRunningCount(count);
      })
      .catch(() => setRunningCount(0));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const cpu = metrics?.cpu ?? null;
  const ram = metrics?.ram ?? null;
  const cpuPct = cpu?.usagePct ?? 0;
  const ramPct = ram ? (ram.usedMB / ram.totalMB) * 100 : 0;

  const cpuColor = colorForPct(cpuPct);
  const ramColor = colorForPct(ramPct);

  // Find the preferred GPU from the config
  const gpu = gpus.find((g) => g.id === preferredGpu) ?? null;

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <a href="#/" className="sidebar-link">{t('navDashboard')}</a>
        <a href="#/status" className="sidebar-link">
          {t('navStatus')}
          {runningCount > 0 && <span className="sidebar-count">{runningCount}</span>}
        </a>
        <a href="#/settings" className="sidebar-link">{t('navSettings')}</a>
        <a href="#/info" className="sidebar-link sidebar-info-link">ℹ️ {t('navInfo')}</a>
      </nav>

      <div className="sidebar-stats">
        {/* GPU section */}
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">{t('gpuHeading')}</h3>
          {gpu ? (
            <>
              <StatRow
                label={t('gpuUtilization')}
                value={`${gpu.utilization ?? 0}%`}
                pct={gpu.utilization ?? 0}
                color={colorForPct(gpu.utilization ?? 0)}
              />
              <StatRow
                label={t('gpuMemory')}
                value={
                  gpu.memoryTotalMB != null && gpu.memoryUsedMB != null
                    ? `${(gpu.memoryUsedMB / 1024).toFixed(1)} / ${(gpu.memoryTotalMB / 1024).toFixed(0)} GB`
                    : '—'
                }
                pct={
                  gpu.memoryTotalMB != null && gpu.memoryUsedMB != null
                    ? (gpu.memoryUsedMB / gpu.memoryTotalMB) * 100
                    : 0
                }
                color={colorForPct(
                  gpu.memoryTotalMB != null && gpu.memoryUsedMB != null
                    ? (gpu.memoryUsedMB / gpu.memoryTotalMB) * 100
                    : 0,
                )}
              />
            </>
          ) : (
            <p className="sidebar-section-empty">{t('gpuNotSelected')}</p>
          )}
        </div>

        {/* CPU section */}
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">{t('cpuHeading')}</h3>
          <StatRow
            label={t('cpuUsage')}
            value={`${cpuPct.toFixed(0)}%`}
            pct={cpuPct}
            color={cpuColor}
          />
          {cpu?.temperatureC != null && (
            <div className="sidebar-substat">
              <span>{t('cpuTemperature')}</span>
              <span>{cpu.temperatureC.toFixed(0)}°C</span>
            </div>
          )}
        </div>

        {/* RAM section */}
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">{t('ramHeading')}</h3>
          <StatRow
            label={t('ramUsage')}
            value={ram ? `${ramPct.toFixed(0)}%` : '—'}
            pct={ramPct}
            color={ramColor}
          />
          {ram && (
            <div className="sidebar-substat">
              <span>{t('ramUsed')}</span>
              <span>
                {(ram.usedMB / 1024).toFixed(1)} / {(ram.totalMB / 1024).toFixed(1)} GB
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
