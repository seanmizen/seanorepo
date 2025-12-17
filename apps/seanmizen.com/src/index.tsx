import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
