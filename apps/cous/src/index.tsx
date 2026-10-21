import { type FC, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Cous } from './cous/cous';
import { Leaderboard, type Run } from './cous/leaderboard';
import { Provenance } from './cous/provenance';
import { RotateHint, useLandscapeLock } from './landscape';
import { registerServiceWorker } from './pwa/register';
import { ThemeToggle, useTheme } from './theme-toggle';
import './index.css';

const App: FC = () => {
  const { mode, theme, toggleMode } = useTheme();
  useLandscapeLock();
  const [run, setRun] = useState<Run | null>(null);
  return (
    <>
      <main>
        <h1>cous</h1>
        <Cous
          dark={theme === 'dark'}
          onCrash={(score, durationMs, birds) =>
            setRun({ id: Date.now(), score, durationMs, birds })
          }
        />
        {/* Two columns on a wide screen: links and gallery, then the board. */}
        <div className="below">
          <div>
            <a href="https://seanmizen.com">seanmizen.com</a>
            <Provenance />
          </div>
          <Leaderboard run={run} />
        </div>
      </main>
      <ThemeToggle mode={mode} toggleMode={toggleMode} />
      <RotateHint />
    </>
  );
};

registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
