/**
 * Info page: app version, engine status, config watch state.
 * The old "Status" content moved here.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getStatus,
  getEngines,
  type DashboardStatus,
  type EngineInfo,
} from "../api/client";
import { t } from "../i18n";

const REFRESH_INTERVAL_MS = 5000;

export function InfoPage() {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineTest, setEngineTest] = useState<
    Record<string, { running: boolean; result: string | null }>
  >({});

  const refresh = useCallback((): void => {
    Promise.all([getStatus(), getEngines()])
      .then(([statusResult, engineList]) => {
        setStatus(statusResult);
        setEngines(engineList);
        setError(null);
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

  const testEngine = (engineId: string): void => {
    setEngineTest((prev) => ({
      ...prev,
      [engineId]: { running: true, result: null },
    }));
    fetch(`/api/v1/engines/${engineId}/check`)
      .then((r) => r.json())
      .then((data: { ok: boolean; message: string }) => {
        setEngineTest((prev) => ({
          ...prev,
          [engineId]: {
            running: false,
            result: data.ok ? data.message : data.message,
          },
        }));
      })
      .catch((err: unknown) => {
        setEngineTest((prev) => ({
          ...prev,
          [engineId]: {
            running: false,
            result: err instanceof Error ? err.message : String(err),
          },
        }));
      });
  };

  if (loading) {
    return <p className="muted">{t("statusLoading")}</p>;
  }

  if (error || !status) {
    return (
      <section>
        <h2>{t("infoHeading")}</h2>
        <p className="status-error">{error ?? t("statusError")}</p>
      </section>
    );
  }

  const config = status.config;

  return (
    <>
      {/* App info */}
      <section>
        <h2>{t("infoHeading")}</h2>
        <dl className="kv">
          <dt>{t("fieldAppName")}</dt>
          <dd>{status.name}</dd>
          <dt>{t("fieldVersion")}</dt>
          <dd>{status.version}</dd>
          <dt>{t("fieldState")}</dt>
          <dd>{status.state}</dd>
          <dt>{t("fieldUptime")}</dt>
          <dd>{status.uptimeSec} s</dd>
        </dl>
        <p className="muted small">{t("statusAutoRefresh")}</p>
      </section>

      {/* Engine status */}
      <section>
        <h2>{t("engineHeading")}</h2>
        {engines.length === 0 ? (
          <p className="muted">{t("enginesEmpty")}</p>
        ) : (
          engines.map((eng) => {
            const test = engineTest[eng.id];
            return (
              <div key={eng.id} className="engine-card">
                <div className="engine-card-header">
                  <span className="engine-name">{eng.displayName}</span>
                  <span
                    className={`engine-status-badge ${eng.configured ? "ok" : "warn"}`}
                  >
                    {eng.configured
                      ? t("engineConfigured")
                      : t("engineNotConfigured")}
                  </span>
                </div>
                {eng.binary && (
                  <div className="engine-binary">
                    <span className="muted">{t("engineBinary")}:</span>
                    <code className="engine-path">{eng.binary}</code>
                  </div>
                )}
                <button
                  type="button"
                  className="btn small"
                  disabled={test?.running ?? false}
                  onClick={() => testEngine(eng.id)}
                >
                  {test?.running ? t("testingEngine") : t("testEngineBtn")}
                </button>
                {test?.result && (
                  <p
                    className={`engine-test-result ${test.result.startsWith("OK") ? "ok" : "error"}`}
                  >
                    {test.result}
                  </p>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Config watch */}
      {config && (
        <section>
          <h2>{t("configHeading")}</h2>
          <dl className="kv">
            <dt>{t("configHome")}</dt>
            <dd>{config.home}</dd>
            <dt>{t("configWatchActive")}</dt>
            <dd>
              {config.watchActive ? t("configWatchOn") : t("configWatchOff")}
            </dd>
            <dt>{t("configLastChange")}</dt>
            <dd>{config.lastExternalChangeAt ?? t("configNoChanges")}</dd>
            <dt>{t("configReloadCount")}</dt>
            <dd>{config.reloadCount}</dd>
            {config.lastReloadError && (
              <>
                <dt>{t("configReloadError")}</dt>
                <dd className="status-error">{config.lastReloadError}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </>
  );
}
