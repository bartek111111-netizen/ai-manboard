/**
 * Left sidebar with always-on system stats (GPU/CPU/RAM).
 * Polls the system metrics endpoint every 3s.
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

export function Sidebar() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  const load = useCallback(() => {
    fetch('/api/v1/system/metrics')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: SystemMetrics) => setMetrics(data))
      .catch(() => setMetrics(null));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const gpu = metrics?.gpu ?? null;
  const cpu = metrics?.cpu ?? null;
  const ram = metrics?.ram ?? null;

  const gpuPct = gpu?.utilization ?? 0;
  const cpuPct = cpu?.usagePct ?? 0;
  const ramPct = ram ? (ram.usedMB / ram.totalMB) * 100 : 0;

  const gpuColor = gpuPct > 90 ? 'var(--color-state-error)' : gpuPct > 70 ? 'var(--color-state-stopping)' : 'var(--color-state-running)';
  const cpuColor = cpuPct > 90 ? 'var(--color-state-error)' : cpuPct > 70 ? 'var(--color-state-stopping)' : 'var(--color-state-running)';
  const ramColor = ramPct > 90 ? 'var(--color-state-error)' : ramPct > 70 ? 'var(--color-state-stopping)' : 'var(--color-state-running)';

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <a href="#/" className="sidebar-link">{t('navDashboard')}</a>
        <a href="#/status" className="sidebar-link">{t('navStatus')}</a>
        <a href="#/settings" className="sidebar-link">{t('navSettings')}</a>
      </nav>

      <div className="sidebar-stats">
        <h3>{t('systemStatsHeading')}</h3>

        {/* GPU */}
        <StatRow
          label={t('gpuHeading')}
          value={gpu ? `${gpu.utilization ?? 0}%` : '—'}
          pct={gpuPct}
          color={gpuColor}
        />
        {gpu && gpu.memoryUsedMB != null && gpu.memoryTotalMB != null && (
          <div className="sidebar-substat">
            <span>{t('gpuMemory')}</span>
            <span>{(gpu.memoryUsedMB / 1024).toFixed(1)} / {(gpu.memoryTotalMB / 1024).toFixed(1)} GB</span>
          </div>
        )}

        {/* CPU */}
        <StatRow
          label={t('cpuHeading')}
          value={`${cpuPct.toFixed(0)}%`}
          pct={cpuPct}
          color={cpuColor}
        />

        {/* RAM */}
        <StatRow
          label={t('ramHeading')}
          value={ram ? `${(ramPct / 100).toFixed(2).slice(0, -1)}%` : '—'}
          pct={ramPct}
          color={ramColor}
        />
        {ram && (
          <div className="sidebar-substat">
            <span>{t('ramUsed')}</span>
            <span>{(ram.usedMB / 1024).toFixed(1)} / {(ram.totalMB / 1024).toFixed(1)} GB</span>
          </div>
        )}
      </div>
    </aside>
  );
}
