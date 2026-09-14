/**
 * LogViewer (Faza 8.1): live log lines from SSE + filters + auto-scroll.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { openLogStream } from '../api/sse.js';
import type { LogLine } from '../api/sse.js';
import { t } from '../i18n/index.js';
import { ErrorNotice } from './ErrorNotice.js';

const MAX_LINES = 500;

interface LogViewerProps {
  instanceId: string;
}

export function LogViewer({ instanceId }: LogViewerProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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
    // Flush buffer periodically (batch SSE events)
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

  return (
    <div className="log-viewer">
      {/* Filters */}
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

      {/* Error notice */}
      {error && (
        <ErrorNotice
          message={error}
        />
      )}

      {/* Log lines */}
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
    </div>
  );
}
