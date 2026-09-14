import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { t } from '../i18n';
import { getInstances, getModels } from '../api/client';

/**
 * App shell: left sidebar (nav + always-on system stats) + main content.
 * Header: app title (shifted right) + current model status indicator.
 */
export function Layout() {
  const [model, setModel] = useState<{ name: string; running: boolean } | null>(null);

  useEffect(() => {
    getModels()
      .then((models) => {
        if (models.length === 0) {
          setModel(null);
          return;
        }
        // Check if any instance is running
        getInstances()
          .then((instances) => {
            const running = instances.find((i) => i.state === 'running');
            setModel({
              name: models[0].displayName,
              running: running !== undefined,
            });
          })
          .catch(() => {
            setModel({ name: models[0].displayName, running: false });
          });
      })
      .catch(() => setModel(null));
  }, []);

  const hasModel = model !== null;
  const isRunning = model?.running ?? false;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <header className="app-header">
          <h1 className="app-header-title">
            <NavLink to="/">{t('appTitle')}</NavLink>
          </h1>
          <div className="app-header-status">
            {hasModel ? (
              <>
                <span className={`status-dot ${isRunning ? 'on' : 'off'}`} />
                <span className="status-label">
                  {isRunning ? t('modelRunning') : t('modelStopped')}
                </span>
                <span className="status-model-name">{model.name}</span>
              </>
            ) : (
              <>
                <span className="status-dot off" />
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
