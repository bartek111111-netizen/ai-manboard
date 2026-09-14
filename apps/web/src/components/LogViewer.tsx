/**
 * LogViewer (Faza 8.3): live log lines from SSE + persisted run logs.
 * - Live view: SSE stream with filters + auto-scroll
 * - Saved runs: list of previous runs, click to view
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { openLogStream } from '../api/sse.js';
import type { LogLine } from '../api/sse.js';
import { t } from '../i18n/index.js';
import { ErrorNotice } from './ErrorNotice.js';

const MAX_LINES = 500;

interface RunLog {
  file: string;
  ts: string;
  size: number;
  type: 'auto' | 'manual';
}

interface LogViewerProps {
  instanceId: string;
  modelId: string;
}

export function LogViewer({ instanceId, modelId }: LogViewerProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Persisted logs
  const [savedLogs, setSavedLogs] = useState<RunLog[]>([]);
  const [viewingLog, setViewingLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load saved logs list
  useEffect(() => {
    fetch(`/api/v1/models/${modelId}/logs`)
      .then((r) => r.json())
      .then((data) => setSavedLogs(data.logs))
      .catch(() => setSavedLogs([]));
  }, [modelId]);

  // Load a specific saved log
  const loadSavedLog = useCallback((file: string) => {
    setBusy(true);
    fetch(`/api/v1/models/${modelId}/logs/${file}`)
      .then((r) => r.json())
      .then((data) => {
        setLogContent(data.content);
        setViewingLog(file);
      })
      .catch(() => setLogContent(null))
      .finally(() => setBusy(false));
  }, [modelId]);

  // Save current log
  const saveCurrentLog = useCallback(() => {
    if (lines.length === 0) return;
    setBusy(true);
    const content = lines
      .map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`)
      .join('\n');
    fetch(`/api/v1/models/${modelId}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
      .then(() => {
        // Refresh saved logs
        fetch(`/api/v1/models/${modelId}/logs`)
          .then((r) => r.json())
          .then((data) => setSavedLogs(data.logs));
      })
      .catch(() => setError('Nie udało się zapisać logu'))
      .finally(() => setBusy(false));
  }, [lines, modelId]);

  // Copy last 40 lines to clipboard
  const copyLastLines = useCallback(() => {
    const lastLines = lines.slice(-40);
    const text = lastLines.map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      // Show a brief confirmation
      const btn = document.querySelector('.log-actions .btn:last-child');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = '✅ Skopiowano!';
        setTimeout(() => { btn.textContent = original; }, 2000);
      }
    });
  }, [lines]);

  // Delete a saved log
  const deleteSavedLog = useCallback((file: string) => {
    fetch(`/api/v1/models/${modelId}/logs/${file}`, { method: 'DELETE' })
      .then(() => {
        setSavedLogs((prev) => prev.filter((l) => l.file !== file));
        if (viewingLog === file) {
          setViewingLog(null);
          setLogContent(null);
        }
      })
      .catch(() => {});
  }, [modelId, viewingLog]);

  // Clear all logs
  const clearAllLogs = useCallback(() => {
    fetch(`/api/v1/models/${modelId}/logs`, { method: 'DELETE' })
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
    const close = openLogStream(
      instanceId,
      (line) => {
        buffer = [...buffer, line].slice(-MAX_LINES);
      },
    );
    const interval = setInterval(() => {
      if (buffer.length > 0) {
        setLines(buffer);
        buffer = [];
      }
    }, 500);
    return () => {
      clearInterval(interval);
      close();
    };
  }, [instanceId]);

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
    if (levelFilter !== 'all' && l.level !== levelFilter) return false;
    if (search && !l.line.toLowerCase().includes(search.toLowerCase())) return false;
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
            <button type="button" className="btn small" onClick={clearAllLogs}>Wyczyść wszystkie</button>
          </div>
          <div className="log-saved-list">
            {savedLogs.map((log) => (
              <div key={log.file} className={`log-saved-item ${viewingLog === log.file ? 'active' : ''}`}>
                <button
                  type="button"
                  className="log-saved-btn"
                  onClick={() => loadSavedLog(log.file)}
                >
                  {log.type === 'auto' ? '🤖 ' : '📝 '}
                  {new Date(log.ts.replace(/-/g, ':')).toLocaleString()}
                </button>
                <button type="button" className="btn small" onClick={() => deleteSavedLog(log.file)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save + Copy buttons */}
      {lines.length > 0 && !viewingLog && (
        <div className="log-actions">
          <button type="button" className="btn small" disabled={busy} onClick={saveCurrentLog}>
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
            onChange={(e) => setLevelFilter(e.target.value as 'all' | 'info' | 'warn' | 'error')}
            aria-label={t('logFilterLevel')}
          >
            <option value="all">{t('logFilterAll')}</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('logSearchPlaceholder')}
            aria-label={t('logSearchPlaceholder')}
          />
          <label className="log-autoscroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            {t('logAutoScroll')}
          </label>
          <span className="log-line-count">
            {filtered.length}/{lines.length}
          </span>
        </div>
      )}

      {/* Viewing saved log */}
      {viewingLog && displayContent !== null && (
        <div className="log-viewer-container">
          <pre className="log-saved-content">{displayContent}</pre>
        </div>
      )}

      {/* Error notice */}
      {error && (
        <ErrorNotice
          message={error}
        />
      )}

      {/* Live log lines */}
      {!viewingLog && (
        <div
          className="log-viewer-container"
          ref={containerRef}
          onScroll={handleScroll}
        >
          {filtered.length === 0 ? (
            <div className="log-viewer-empty">{t('logEmpty')}</div>
          ) : (
            filtered.map((line, i) => (
              <div
                key={`${line.ts}-${i}`}
                className={`log-line log-line-${line.level}`}
              >
                <span className="log-timestamp">{new Date(line.ts).toLocaleTimeString()}</span>
                <span className={`log-level log-level-${line.level}`}>{line.level.toUpperCase()}</span>
                <span className="log-text">{line.line}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
