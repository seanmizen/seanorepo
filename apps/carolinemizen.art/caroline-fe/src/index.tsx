import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './routes.tsx';
import './index.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <AppRoutes />
  </React.StrictMode>,
);
