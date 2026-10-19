import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Cous } from './cous/cous';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>cous</h1>
      <Cous />
      <a href="https://seanmizen.com">seanmizen.com</a>
    </main>
  </StrictMode>,
);
