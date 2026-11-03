import type { HealthResponse } from '@shared/types';
import { StrictMode, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; body: HealthResponse }
  | { kind: 'error'; message: string };

const HealthCheck = () => {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    fetch(`${import.meta.env.API_URL}/health`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as HealthResponse;
        setStatus({ kind: 'ok', body });
      })
      .catch((error: unknown) => {
        setStatus({ kind: 'error', message: String(error) });
      });
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1>crm</h1>
      <p>
        <code>GET /api/health</code>:{' '}
        {status.kind === 'loading' && 'checking...'}
        {status.kind === 'ok' && <code>{JSON.stringify(status.body)}</code>}
        {status.kind === 'error' && `failed (${status.message})`}
      </p>
    </main>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element with id 'root' not found");

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <HealthCheck />
  </StrictMode>,
);
