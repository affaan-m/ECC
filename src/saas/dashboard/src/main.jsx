import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import IncidentList from './pages/IncidentList';
import IncidentDetail from './pages/IncidentDetail';
import CreateIncident from './pages/CreateIncident';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"                  element={<IncidentList />} />
          <Route path="/incidents/:id"     element={<IncidentDetail />} />
          <Route path="/create"            element={<CreateIncident />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  </StrictMode>
);
