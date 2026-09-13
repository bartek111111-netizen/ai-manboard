import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StatusPage } from './pages/StatusPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

/**
 * Routes (hash routing — works from the static build, no server config).
 * Phase 0: home (API status) + placeholders for the future views.
 */
export default function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<StatusPage />} />
          <Route path="/models" element={<PlaceholderPage />} />
          <Route path="/settings" element={<PlaceholderPage />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
