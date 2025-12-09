import { createBrowserRouter } from 'react-router-dom';
import { App } from '@/app';
import { GameSession } from '@/features';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
  },
  {
    path: '/session',
    element: <GameSession />,
  },
]);
