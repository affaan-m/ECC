import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import TabBar from './components/TabBar.jsx';
import GoalsPage from './pages/GoalsPage.jsx';
import PlannerPage from './pages/PlannerPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import ContactDetailPage from './pages/ContactDetailPage.jsx';
import MapPage from './pages/MapPage.jsx';
import MorePage from './pages/MorePage.jsx';
import { useStore } from './data/store.jsx';

export default function App() {
  const { state } = useStore();
  const theme = state.settings?.theme || 'system';

  // Apply the selected theme to the document root.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/goals" replace />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/goals" replace />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  );
}
