/**
 * LogViewer (Faza 8.3): live log lines from SSE + persisted run logs.
 * - Live view: SSE stream with filters + auto-scroll
 * - Saved runs: list of previous runs, click to view
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { openLogStream } from "../api/sse.js";
import type { LogLine } from "../api/sse.js";
import { t } from "../i18n/index.js";
import { ErrorNotice } from "./ErrorNotice.js";

/**
 * The live view accumulates the full history (no truncation) — the user wants
 * "wszystko na raz bez przycinania". The server ring already caps the replay
 * tail, so the client only needs to keep appending; we keep a generous ceiling
 * purely to bound memory for very long sessions.
 */
const MAX_LINES = 10000;

interface RunLog {
  file: string;
  path: string;
  ts: string;
  size: number;
  type: "auto" | "manual" | "engine";
}

/**
 * The preset name for a log file. LogWriter files are
 * `<preset>-<YYYY-MM-DD_HH-MM-SS>.log` (the preset is the part before the
 * timestamp); store snapshots are `auto-*.log` / `manual-*.log` (the "preset"
 * is the snapshot type).
 */
function presetOf(log: RunLog): string {
  if (log.type === "auto" || log.type === "manual") return log.type;
  const m = log.file.match(/^(.*?)-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/);
  return m ? m[1] : log.file;
}

/** Short label + tooltip for each log type, rendered as a badge in the list. */
const TYPE_LABEL: Record<RunLog["type"], string> = {
  engine: "silnik",
  auto: "auto",
  manual: "ręcznie",
};
const TYPE_TITLE: Record<RunLog["type"], string> = {
  engine: "Prawdziwy log silnika (llama-server) — nowy plik na każdy start",
  auto: "Auto-zapis dashboardu (przy stopie instancji)",
  manual: "Zapis ręczny (przycisk „Zapisz”)",
};

/** Formats a byte count as a compact human string (B / KB / MB). */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A short relative age ("just now", "5 min ago", "3 d ago") from a timestamp. */
function relativeAge(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "teraz";
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} godz. temu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} dni temu`;
  return new Date(ts).toLocaleDateString();
}

interface LogViewerProps {
  instanceId: string;
  modelId: string;
}

export function LogViewer({ instanceId, modelId }: LogViewerProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [levelFilter, setLevelFilter] = useState<
    "all" | "info" | "warn" | "error"
  >("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Persisted logs
  const [savedLogs, setSavedLogs] = useState<RunLog[]>([]);
  const [viewingLog, setViewingLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which copy-button (30/50) just copied — shows a brief confirmation. */
  const [copiedLines, setCopiedLines] = useState<number | null>(null);

  // Load saved logs list (refreshed periodically so the LIVE badge, sizes,
  // and relative ages stay current as the engine writes to the current log).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/v1/models/${modelId}/logs`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setSavedLogs(data.logs);
        })
        .catch(() => {
          if (!cancelled) setSavedLogs([]);
        });
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [modelId]);

  // Instance state — decides whether the live view IS the current log
  // (the instance runs) or the newest saved run should auto-open instead.
  // Also derives the live instanceId: after a dashboard restart the adopted
  // instance's preset may differ from the one in the URL query, so we target
  // whichever instance is actually running for this model (falls back to the
  // prop when none is found or the model has no live instance).
  const [liveInstanceId, setLiveInstanceId] = useState<string>(instanceId);
  // The state of the LIVE instance (the one actually running for this model,
  // which may differ from the URL's instance after a dashboard restart).
  // Drives the 🟢 LIVE badge + auto-open (not the URL's instance state).
  const [liveInstanceState, setLiveInstanceState] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setLiveInstanceId(instanceId);
    setLiveInstanceState(null);
    fetch("/api/v1/instances")
      .then((r) => r.json())
      .then((data) => {
        const running = data.instances.find(
          (i: { instanceId: string; modelId: string; state: string }) =>
            i.modelId === modelId &&
            (i.state === "running" || i.state === "starting"),
        );
        if (running?.instanceId) {
          setLiveInstanceId(running.instanceId);
          setLiveInstanceState(running.state);
        } else {
          // No running instance for this model — fall back to the URL's state.
          setLiveInstanceId(instanceId);
          setLiveInstanceState(
            data.instances.find(
              (i: { instanceId: string }) => i.instanceId === instanceId,
            )?.state ?? null,
          );
        }
      })
      .catch(() => {
        setLiveInstanceId(instanceId);
        setLiveInstanceState(null);
      });
  }, [instanceId, modelId]);

  // Load a specific saved log
  const loadSavedLog = useCallback(
    (file: string) => {
      setBusy(true);
      fetch(`/api/v1/models/${modelId}/logs/${file}`)
        .then((r) => r.json())
        .then((data) => {
          setLogContent(data.content);
          setViewingLog(file);
        })
        .catch(() => setLogContent(null))
        .finally(() => setBusy(false));
    },
    [modelId],
  );

  // The log file the engine is CURRENTLY writing to (the newest LogWriter
  // file for the running instance's preset). Shown with a 🟢 LIVE badge and
  // auto-opened while the instance runs. Uses `liveInstanceState` (the adopted
  // instance's state), not the URL's.
  const liveFile: string | null = (() => {
    if (liveInstanceState !== "running" && liveInstanceState !== "starting")
      return null;
    const preset = liveInstanceId.split("--")[1] ?? null;
    if (!preset) return null;
    // LogWriter files carry a timestamp suffix; store snapshots don't.
    const newest = savedLogs.find(
      (log) =>
        presetOf(log) === preset &&
        log.file.match(/-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/),
    );
    return newest?.file ?? null;
  })();

  // Auto-open the "current" log so it is visible without a click:
  // - While the instance runs, the current log is the LIVE LogWriter file
  //   (`liveFile`) — open it in the saved-log view (which polls every 2 s).
  // - When the instance is stopped, the newest saved run is the last log.
  // The SSE live stream is a separate, in-memory feed that goes stale after a
  // dashboard restart, so the saved-log view is the reliable source.
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current || viewingLog) return;
    if (savedLogs.length === 0 || liveInstanceState === null) return;
    if (liveInstanceState === "running" || liveInstanceState === "starting") {
      // Only open once the LIVE LogWriter file is actually resolvable. If it
      // isn't yet (savedLogs still settling / liveInstanceId still stale),
      // don't claim the one-shot — let the next render retry.
      if (liveFile) {
        autoLoadedRef.current = true;
        loadSavedLog(liveFile);
      }
    } else {
      autoLoadedRef.current = true;
      loadSavedLog(savedLogs[0].file);
    }
  }, [savedLogs, liveInstanceState, viewingLog, loadSavedLog, liveFile]);

  // While viewing a saved log, poll for new content every 2 s. The current
  // run's log file keeps growing on disk (the engine still writes to it), so
  // a one-shot fetch goes stale immediately; polling keeps the box in sync.
  useEffect(() => {
    if (!viewingLog) return;
    const interval = setInterval(() => {
      fetch(`/api/v1/models/${modelId}/logs/${viewingLog}`)
        .then((r) => r.json())
        .then((data) => setLogContent(data.content))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [viewingLog, modelId]);

  // Save current log
  const saveCurrentLog = useCallback(() => {
    if (lines.length === 0) return;
    setBusy(true);
    const content = lines
      .map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`)
      .join("\n");
    fetch(`/api/v1/models/${modelId}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
      .then(() => {
        // Refresh saved logs
        fetch(`/api/v1/models/${modelId}/logs`)
          .then((r) => r.json())
          .then((data) => setSavedLogs(data.logs));
      })
      .catch(() => setError("Nie udało się zapisać logu"))
      .finally(() => setBusy(false));
  }, [lines, modelId]);

  // Copy last 40 lines to clipboard
  const copyLastLines = useCallback(() => {
    const lastLines = lines.slice(-40);
    const text = lastLines
      .map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      // Show a brief confirmation
      const btn = document.querySelector(".log-actions .btn:last-child");
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "✅ Skopiowano!";
        setTimeout(() => {
          btn.textContent = original;
        }, 2000);
      }
    });
  }, [lines]);

  // Copy the last N lines of the OPEN log file (usually the LIVE log) to the
  // clipboard. Copies straight from `logContent` (the 2 s-poll of the file),
  // which stays current even after a dashboard restart — unlike the SSE feed.
  const copyFileLines = useCallback(
    (n: number) => {
      const lines = (logContent ?? "").split("\n");
      // A trailing newline yields a final empty line — drop trailing empties.
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
      }
      const text = lines.slice(-n).join("\n");
      navigator.clipboard.writeText(text).then(() => {
        setCopiedLines(n);
        setTimeout(() => setCopiedLines(null), 2000);
      });
    },
    [logContent],
  );

  // Delete a saved log
  const deleteSavedLog = useCallback(
    (file: string) => {
      fetch(`/api/v1/models/${modelId}/logs/${file}`, { method: "DELETE" })
        .then(() => {
          setSavedLogs((prev) => prev.filter((l) => l.file !== file));
          if (viewingLog === file) {
            setViewingLog(null);
            setLogContent(null);
          }
        })
        .catch(() => {});
    },
    [modelId, viewingLog],
  );

  // Clear all logs
  const clearAllLogs = useCallback(() => {
    fetch(`/api/v1/models/${modelId}/logs`, { method: "DELETE" })
      .then(() => {
        setSavedLogs([]);
        setViewingLog(null);
        setLogContent(null);
      })
      .catch(() => {});
  }, [modelId]);

  useEffect(() => {
    setError(null);
    setLines([]);
    let buffer: LogLine[] = [];
    const close = openLogStream(liveInstanceId, (line) => {
      buffer = [...buffer, line];
    });
    const interval = setInterval(() => {
      if (buffer.length > 0) {
        // Append (not replace) so the full history stays — the old code swapped
        // `lines` with each 500 ms batch, so the box "reset" to the latest lines.
        setLines((prev) => [...prev, ...buffer].slice(-MAX_LINES));
        buffer = [];
      }
    }, 500);
    return () => {
      clearInterval(interval);
      close();
    };
  }, [liveInstanceId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
    setAutoScroll(atBottom);
  }, []);

  // Filtered lines
  const filtered = lines.filter((l) => {
    if (levelFilter !== "all" && l.level !== levelFilter) return false;
    if (search && !l.line.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  // When viewing a saved log, show its content instead of live
  const displayContent = viewingLog ? logContent : null;

  return (
    <div className="log-viewer">
      {/* Saved logs panel */}
      {savedLogs.length > 0 && (
        <div className="log-saved-panel">
          <div className="log-saved-header">
            <span>Zapisane uruchomienia ({savedLogs.length})</span>
            <button type="button" className="btn small" onClick={clearAllLogs}>
              Wyczyść wszystkie
            </button>
          </div>
          <div className="log-saved-list">
            {savedLogs.map((log, idx) => {
              const isLive = log.file === liveFile;
              const isTop = idx === 0;
              return (
                <div
                  key={log.file}
                  className={`log-saved-item ${viewingLog === log.file ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="log-saved-btn"
                    onClick={() => loadSavedLog(log.file)}
                    title={log.path}
                  >
                    <span className="log-saved-num">{idx + 1}.</span>
                    {log.type === "engine"
                      ? "⚙️ "
                      : log.type === "auto"
                        ? "🤖 "
                        : "📝 "}
                    <span
                      className={`log-saved-type log-saved-type-${log.type}`}
                      title={TYPE_TITLE[log.type]}
                    >
                      {TYPE_LABEL[log.type]}
                    </span>
                    {log.type === "engine" && (
                      <span className="log-saved-preset">{presetOf(log)}</span>
                    )}
                    {/* The server sends a full ISO timestamp (with `Z`);
                        `toLocaleString` renders it in the viewer's local TZ. */}
                    <span
                      className="log-saved-age"
                      title={new Date(log.ts).toLocaleString()}
                    >
                      {relativeAge(log.ts)}
                    </span>
                    <span className="log-saved-size">
                      {formatSize(log.size)}
                    </span>
                    {isLive && <span className="log-saved-live">🟢 LIVE</span>}
                    {isTop && !isLive && (
                      <span className="log-saved-newest">najnowszy</span>
                    )}
                  </button>
                  <span className="log-saved-actions">
                    <button
                      type="button"
                      className="btn small"
                      title="Kopiuj ścieżkę"
                      onClick={() => {
                        navigator.clipboard.writeText(log.path).catch(() => {});
                      }}
                    >
                      📋
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      title="Otwórz w edytorze"
                      onClick={() =>
                        fetch(
                          `/api/v1/models/${modelId}/logs/${encodeURIComponent(log.file)}/open`,
                          { method: "POST" },
                        )
                          .then((r) => r.json())
                          .catch(() => {})
                      }
                    >
                      📂
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => deleteSavedLog(log.file)}
                    >
                      ×
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save + Copy buttons */}
      {lines.length > 0 && !viewingLog && (
        <div className="log-actions">
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={saveCurrentLog}
          >
            💾 Zapisz
          </button>
          <button type="button" className="btn small" onClick={copyLastLines}>
            📋 Kopiuj ostatnie 40
          </button>
        </div>
      )}

      {/* Filters (only when viewing live) */}
      {!viewingLog && (
        <div className="log-viewer-filters">
          <select
            value={levelFilter}
            onChange={(e) =>
              setLevelFilter(
                e.target.value as "all" | "info" | "warn" | "error",
              )
            }
            aria-label={t("logFilterLevel")}
          >
            <option value="all">{t("logFilterAll")}</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("logSearchPlaceholder")}
            aria-label={t("logSearchPlaceholder")}
          />
          <label className="log-autoscroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            {t("logAutoScroll")}
          </label>
          <span className="log-line-count">
            {filtered.length}/{lines.length}
          </span>
        </div>
      )}

      {/* Viewing saved log (usually the LIVE log) — with copy-latest actions */}
      {viewingLog && displayContent !== null && (
        <>
          <div className="log-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => copyFileLines(30)}
            >
              {copiedLines === 30
                ? "✅ Skopiowano"
                : `📋 ${t("logCopy30")}`}
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => copyFileLines(50)}
            >
              {copiedLines === 50
                ? "✅ Skopiowano"
                : `📋 ${t("logCopy50")}`}
            </button>
          </div>
          <div className="log-viewer-container">
            <pre className="log-saved-content">{displayContent}</pre>
          </div>
        </>
      )}

      {/* Error notice */}
      {error && <ErrorNotice message={error} />}

      {/* Live log lines */}
      {!viewingLog && (
        <div
          className="log-viewer-container"
          ref={containerRef}
          onScroll={handleScroll}
        >
          {filtered.length === 0 ? (
            <div className="log-viewer-empty">{t("logEmpty")}</div>
          ) : (
            filtered.map((line, i) => (
              <div
                key={`${line.ts}-${i}`}
                className={`log-line log-line-${line.level}`}
              >
                <span className="log-timestamp">
                  {new Date(line.ts).toLocaleTimeString()}
                </span>
                <span className={`log-level log-level-${line.level}`}>
                  {line.level.toUpperCase()}
                </span>
                <span className="log-text">{line.line}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
