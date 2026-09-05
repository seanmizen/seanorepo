import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProvider, router } from '@/app';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element with id 'root' not found");

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  </StrictMode>,
);
