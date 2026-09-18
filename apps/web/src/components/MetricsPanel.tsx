/**
 * MetricsPanel (Faza 8.2): the model-preview "Metryki" tab. Shows the same
 * grouped metrics as the "Status" page via the shared `InstanceMetrics`
 * component (engine + process + GPU, incl. prefill speed and TTFT). Polls the
 * instance DTO every 3 s.
 */
import { useCallback, useEffect, useState } from "react";
import { getInstance } from "../api/client.js";
import type { InstanceDto } from "../api/client.js";
import { t } from "../i18n/index.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { InstanceMetrics } from "./InstanceMetrics.js";

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

  const isLive = dto?.state === "running" || dto?.state === "starting";

  return (
    <section className="metrics-panel">
      <h3>{t("metricsHeading")}</h3>

      {error && <ErrorNotice message={error} />}

      {!isLive && !error && <p className="muted">{t("metricsNotLive")}</p>}

      {isLive && dto && (
        <InstanceMetrics
          runtime={dto.runtime}
          process={dto.process}
          gpu={dto.gpu}
          ttft={dto.ttft}
          port={dto.port}
          uptimeSec={dto.uptimeSec}
          command={dto.command}
          mode={dto.mode}
        />
      )}
    </section>
  );
}
