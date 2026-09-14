import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { t } from '../i18n';
import { getInstances, getModels } from '../api/client';

/**
 * App shell: left sidebar (nav + always-on system stats) + main content.
 * Header: app title (shifted right) + current model status indicator.
 * Only shows model name when an instance is actually running.
 */
export function Layout() {
  const [runningModel, setRunningModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkStatus = async () => {
      try {
        const [instances, models] = await Promise.all([getInstances(), getModels()]);
        if (cancelled) return;
        const running = instances.find((i) => i.state === 'running' || i.state === 'starting');
        if (running) {
          const model = models.find((m) => m.id === running.modelId);
          setRunningModel(model?.displayName ?? running.modelId);
        } else {
          setRunningModel(null);
        }
      } catch {
        if (!cancelled) setRunningModel(null);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <header className="app-header">
          <h1 className="app-header-title">
            <NavLink to="/">{t('appTitle')}</NavLink>
          </h1>
          <div className="app-header-status">
            {runningModel ? (
              <>
                <span className="status-dot on" />
                <span className="status-label">{t('modelRunning')}</span>
                <span className="status-model-name">{runningModel}</span>
              </>
            ) : (
              <>
                <span className="status-dot blink" />
                <span className="status-label">{t('noModelLoaded')}</span>
              </>
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
