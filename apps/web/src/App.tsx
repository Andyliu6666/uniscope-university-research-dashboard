import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { ComparePage } from './pages/ComparePage.js';
import { ContributePage } from './pages/ContributePage.js';
import { DetailPage } from './pages/DetailPage.js';
import { ExplorePage } from './pages/ExplorePage.js';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ExplorePage />} />
        <Route path="universities/:slug" element={<DetailPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="contribute" element={<ContributePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
