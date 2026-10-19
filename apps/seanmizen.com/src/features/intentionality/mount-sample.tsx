import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/providers';
import '@/index.css';

/* Mounts one story stage as a page of its own. The story shows that page
   in an iframe, so the stage runs with its own document, listeners and
   router, apart from the site and from the other stages. A memory router
   keeps its navigation inside the frame. */
const mountSample = (routes: ReactNode) => {
  const root = document.getElementById('root');
  if (!root) return;
  ReactDOM.createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <MemoryRouter>
          <Routes>{routes}</Routes>
        </MemoryRouter>
      </ThemeProvider>
    </StrictMode>,
  );
};

export { mountSample };
