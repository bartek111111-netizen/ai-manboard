import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomeView } from './pages/HomeView';
import { ModelDetail } from './pages/ModelDetail';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { StatusPage } from './pages/StatusPage';

/**
 * Routes (hash routing — works from the static build, no server config).
 * Faza 7: `/` = onboarding or model list (§20.1), `/models/:id` = detail
 * (§20.2), `/status` = API/config status (P-12), `/settings` = Faza 9.
 */
export default function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomeView />} />
          <Route path="/models/:modelId" element={<ModelDetail />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/settings" element={<PlaceholderPage />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
