import type { FC } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { MapNetwork } from '@/features/Glasto/Map';
import { ThemeProvider } from '@/providers';
import { Apps, Cous, HireLab, Home, Shaders } from './routes';
import '../index.css';

const App: FC = () => {
  return (
    <ThemeProvider>
      <Router basename="/">
        <Routes>
          <Route path="/apps" element={<Apps />} />
          <Route path="/cous" element={<Cous />} />
          <Route path="/glasto" element={<MapNetwork />} />
          <Route path="/shaders" element={<Shaders />} />
          {/* One path segment: assets load from a relative prefix, so a nested
              path would ask for them under /shaders/. */}
          <Route path="/shaders-hire" element={<HireLab />} />
          <Route path="/*" element={<Home />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export { App };
