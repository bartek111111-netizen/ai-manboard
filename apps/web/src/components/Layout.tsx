import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { t } from '../i18n';
import { getInstances } from '../api/client';
import { useModelState, type ModelStateInfo } from '../hooks/useModelState';
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
      case 'working': return 'var(--color-state-working)';
      case 'idle': return 'var(--color-state-idle)';
      case 'ready': return 'var(--color-state-ready)';
      default: return 'var(--color-muted)';
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
              {modelStates.map((ms) => (
                <span
                  key={ms.instanceId}
                  className="state-dot"
                  style={{ background: getStateColor(ms.state) }}
                  title={`${ms.preset}: ${ms.state} (${ms.slotsUsed}/${ms.slotsTotal})`}
                />
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
