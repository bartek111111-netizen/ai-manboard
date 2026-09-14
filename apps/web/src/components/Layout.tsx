import { NavLink, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { t } from '../i18n';

/**
 * App shell: left sidebar (nav + always-on system stats) + main content.
 */
export function Layout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <header className="app-header">
          <h1>
            <NavLink to="/">{t('appTitle')}</NavLink>
          </h1>
        </header>
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
