import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { t } from '../i18n';

/** App shell: header + navigation (hash routing) + content area. */
export function Layout({ children }: { children: ReactNode }) {
  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    `nav-link${isActive ? ' active' : ''}`;

  return (
    <div className="layout">
      <header className="header">
        <span className="app-title">{t('appTitle')}</span>
        <nav className="nav">
          <NavLink to="/" className={linkClass} end>
            {t('navDashboard')}
          </NavLink>
          <NavLink to="/status" className={linkClass}>
            {t('navStatus')}
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            {t('navSettings')}
          </NavLink>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
