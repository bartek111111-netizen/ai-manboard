import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { t } from '../i18n';
import { getInstances } from '../api/client';
import { useModelState } from '../hooks/useModelState';
import { getConfig } from '../api/client';

/**
 * App shell: left sidebar (nav + always-on system stats) + main content.
 * Header: app title + model state indicators (dots + toasts).
 */
export function Layout() {
  const [debounceMs, setDebounceMs] = useState(0);
  const [toast, setToast] = useState<{ message: string; state: string } | null>(null);
  const prevStates = useRef<Record<string, string>>({});
  const toastTimer = useRef<NodeJS.Timeout | null>(null);

  // Load debounce setting from config
  useEffect(() => {
    getConfig()
      .then((config: any) => {
        setDebounceMs(config.global?.notifications?.stateChangeDelayMs ?? 0);
      })
      .catch(() => {});
  }, []);

  const modelStates = useModelState(debounceMs);

  // Show toast on state change
  useEffect(() => {
    modelStates.forEach((ms) => {
      const prev = prevStates.current[ms.instanceId];
      // Log state changes for debugging
      if (prev !== ms.state) {
        console.log(`State change: ${ms.preset} ${prev ?? 'new'} → ${ms.state}`);
      }
      if (prev && prev !== ms.state) {
        const stateLabel = ms.state === 'working' ? t('stateWorking') : ms.state === 'idle' ? t('stateIdle') : t('stateReady');
        setToast({ message: `${ms.preset}: ${stateLabel}`, state: ms.state });

        // Auto-dismiss after 5s
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
      }
      prevStates.current[ms.instanceId] = ms.state;
    });

    // Clean up states for stopped models
    const runningIds = new Set(modelStates.map((s) => s.instanceId));
    Object.keys(prevStates.current).forEach((id) => {
      if (!runningIds.has(id)) delete prevStates.current[id];
    });
  }, [modelStates]);

  // Get total running count for sidebar badge
  const [runningCount, setRunningCount] = useState(0);
  useEffect(() => {
    const check = async () => {
      try {
        const instances = await getInstances();
        setRunningCount(instances.filter((i) => i.state === 'running' || i.state === 'starting').length);
      } catch {
        setRunningCount(0);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStateColor = (state: string): string => {
    switch (state) {
      case 'working': return '#f5a623'; // yellow/amber = generating
      case 'idle': return '#2ea86a'; // green = ready/idle
      case 'ready': return '#2ea86a'; // green = ready
      default: return '#666'; // gray = unknown
    }
  };

  return (
    <div className="app-layout">
      <Sidebar runningCount={runningCount} />
      <main className="app-main">
        <header className="app-header">
          <h1 className="app-header-title">
            <NavLink to="/">{t('appTitle')}</NavLink>
          </h1>
          <div className="app-header-status">
            {/* State dots per model */}
            <div className="state-dots">
              {modelStates.map((ms, idx) => (
                <span key={ms.instanceId} className="state-dot-group">
                  {idx > 0 && <span className="state-dot-sep">|</span>}
                  <span
                    className="state-dot blink"
                    style={{ background: getStateColor(ms.state) }}
                    title={`${ms.preset}: ${ms.state} (${ms.slotsUsed}/${ms.slotsTotal})`}
                  />
                  <span className="state-dot-name">{ms.preset}</span>
                </span>
              ))}
            </div>
            {/* Toast notification */}
            {toast && (
              <div className={`toast-notification state-${toast.state}`}>
                {toast.message}
              </div>
            )}
          </div>
        </header>
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
