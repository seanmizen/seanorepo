import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from '@/components';
import { Account } from '@/pages/account';
import { Login } from '@/pages/login';
import { Verify } from '@/pages/verify';
import { App } from './app';

export const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/login', element: <Login /> },
  { path: '/verify', element: <Verify /> },
  {
    path: '/account',
    element: (
      <ProtectedRoute>
        <Account />
      </ProtectedRoute>
    ),
  },
]);
