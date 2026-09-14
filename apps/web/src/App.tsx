import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomeView } from './pages/HomeView';
import { ModelDetail } from './pages/ModelDetail';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { Settings } from './pages/Settings';
import { StatusPage } from './pages/StatusPage';
import { SystemStatus } from './pages/SystemStatus';

/**
 * Routes (hash routing — works from the static build, no server config).
 * `/` = onboarding or model list (§20.1), `/models/:id` = detail (§20.2),
 * `/status` = API/config status (P-12), `/settings` = global config (Faza 9.3).
 */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeView />} />
          <Route path="/models/:modelId" element={<ModelDetail />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/system" element={<SystemStatus />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
