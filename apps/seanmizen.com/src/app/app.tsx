import type { FC } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { MapNetwork } from '@/features/Glasto/Map';
import { ThemeProvider } from '@/providers';
import { Apps, Home } from './routes';
import '../index.css';

const App: FC = () => {
  return (
    <ThemeProvider>
      <Router basename="/">
        <Routes>
          <Route path="/apps" element={<Apps />} />
          <Route path="/glasto" element={<MapNetwork />} />
          <Route path="/*" element={<Home setIsSnowing={() => {}} />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export { App };
