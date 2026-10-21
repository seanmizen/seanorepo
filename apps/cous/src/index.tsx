import { type FC, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Cous } from './cous/cous';
import { Provenance } from './cous/provenance';
import { ThemeToggle, useTheme } from './theme-toggle';
import './index.css';

const App: FC = () => {
  const { mode, theme, toggleMode } = useTheme();
  return (
    <>
      <main>
        <h1>Cous Cous Bruus-Barnett</h1>
        <Cous dark={theme === 'dark'} />
        <a href="https://seanmizen.com">seanmizen.com</a>
        <Provenance />
      </main>
      <ThemeToggle mode={mode} toggleMode={toggleMode} />
    </>
  );
};

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
