import type { ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from '@/components';
import { Account } from '@/pages/account';
import { Login } from '@/pages/login';
import { NotFound } from '@/pages/not-found';
import { Verify } from '@/pages/verify';
import { App } from './app';
import { RootLayout } from './root-layout';
import { NOT_FOUND_PATH, ROUTES, type RoutePath } from './routes';

/**
 * What each declared route renders.
 *
 * Typed by `RoutePath`, so `ROUTES` stays the single source of truth: add a
 * route to the table without an element here — or an element here for a path
 * that is not in the table — and it is a type error, not a runtime blank.
 */
const ELEMENTS: Record<RoutePath, ReactNode> = {
  '/': <App />,
  '/login': <Login />,
  '/verify': <Verify />,
  '/account': (
    <ProtectedRoute>
      <Account />
    </ProtectedRoute>
  ),
};

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      ...ROUTES.map((route) => ({
        path: route.path,
        element: ELEMENTS[route.path],
      })),
      // Last, and outside the table: it is the answer to "no such place",
      // not a place of its own.
      { path: NOT_FOUND_PATH, element: <NotFound /> },
    ],
  },
]);
