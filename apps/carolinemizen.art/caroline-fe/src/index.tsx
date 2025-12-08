import { AppRoutes } from './routes.tsx';
import './index.css';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Root element with id 'root' not found");
}
const root = ReactDOM.createRoot(rootElement);
root.render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>,
);
