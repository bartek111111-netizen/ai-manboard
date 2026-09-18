/**
 * System status page (Faza 10+): GPU/CPU usage, memory, temperature.
 * Polls the system metrics endpoint every 3s.
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";

interface GpuMetrics {
  name: string;
  memoryUsedMB?: number;
  memoryTotalMB?: number;
  utilization?: number;
}

interface CpuMetrics {
  loadAvg?: number[];
  temperatureC?: number;
  usagePct?: number;
}

interface SystemMetrics {
  gpu?: GpuMetrics | null;
  cpu?: CpuMetrics | null;
  ram?: { usedMB: number; totalMB: number };
  os?: string;
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color =
    pct > 90
      ? "var(--color-state-error)"
      : pct > 70
        ? "var(--color-state-stopping)"
        : "var(--color-state-running)";
  return (
    <div className="progress-bar">
      <div className="progress-bar-label">
        <span>{label}</span>
        <span>{value > 0 ? `${(value / 100).toFixed(1)}%` : "—"}</span>
      </div>
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function SystemStatus() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/v1/system/metrics")
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((data: SystemMetrics) => {
        setMetrics(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setMetrics(null);
      });
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const gpu = metrics?.gpu ?? null;
  const cpu = metrics?.cpu ?? null;
  const ram = metrics?.ram ?? null;

  return (
    <section className="system-status">
      <h2>{t("systemStatusHeading")}</h2>

      {error && <p className="muted">{error} — system metrics unavailable</p>}

      <div className="system-status-grid">
        {/* GPU */}
        <div className="system-card">
          <h3>{t("gpuHeading")}</h3>
          {gpu ? (
            <>
              <p className="system-card-name">{gpu.name}</p>
              <ProgressBar
                value={gpu.utilization ?? 0}
                max={100}
                label={t("gpuUtilization")}
              />
              {gpu.memoryUsedMB !== undefined &&
                gpu.memoryTotalMB !== undefined && (
                  <div className="kv">
                    <dt>{t("gpuMemory")}</dt>
                    <dd>
                      {formatMB(gpu.memoryUsedMB)} /{" "}
                      {formatMB(gpu.memoryTotalMB)}
                    </dd>
                  </div>
                )}
            </>
          ) : (
            <p className="muted">{t("gpuNotAvailable")}</p>
          )}
        </div>

        {/* CPU */}
        <div className="system-card">
          <h3>{t("cpuHeading")}</h3>
          {cpu ? (
            <>
              <ProgressBar
                value={cpu.usagePct ?? 0}
                max={100}
                label={t("cpuUsage")}
              />
              <dl className="kv">
                {cpu.loadAvg && (
                  <>
                    <dt>{t("cpuLoadAvg")}</dt>
                    <dd>{cpu.loadAvg.map((v) => v.toFixed(2)).join(" / ")}</dd>
                  </>
                )}
                {cpu.temperatureC !== undefined && (
                  <>
                    <dt>{t("cpuTemperature")}</dt>
                    <dd>{cpu.temperatureC.toFixed(0)}°C</dd>
                  </>
                )}
              </dl>
            </>
          ) : (
            <p className="muted">{t("cpuNotAvailable")}</p>
          )}
        </div>

        {/* RAM */}
        <div className="system-card">
          <h3>{t("ramHeading")}</h3>
          {ram ? (
            <>
              <ProgressBar
                value={ram.usedMB}
                max={ram.totalMB}
                label={t("ramUsage")}
              />
              <dl className="kv">
                <dt>{t("ramUsed")}</dt>
                <dd>
                  {formatMB(ram.usedMB)} / {formatMB(ram.totalMB)}
                </dd>
              </dl>
            </>
          ) : (
            <p className="muted">{t("ramNotAvailable")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
