import type { ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute, RouteErrorElement } from '@/components';
import { Account } from '@/pages/account';
/**
 * What each declared route renders.
 *
 * Typed by `RoutePath`, so `ROUTES` stays the single source of truth: add a
 * route to the table without an element here — or an element here for a path
 * that is not in the table — and it is a type error, not a runtime blank.
 */
import { AccountBrief } from '@/pages/account/brief';
import { AccountBriefs } from '@/pages/account/briefs';
import { AdminHome } from '@/pages/admin';
import { AdminDesignerReview } from '@/pages/admin/designer-review';
import { AdminDesigners } from '@/pages/admin/designers';
import { BriefPage } from '@/pages/briefs/brief';
import { Briefs } from '@/pages/briefs/index';
import { Designers } from '@/pages/designers';
import { DesignerPortfolio } from '@/pages/designers/portfolio';
import { DesignerProfilePage } from '@/pages/designers/profile';
import { PortfolioProjectPage } from '@/pages/designers/project';
import { Login } from '@/pages/login';
import { MyStudio } from '@/pages/me';
import { MyPortfolio } from '@/pages/me/portfolio';
import { MyProfileEditor } from '@/pages/me/profile';
import { MyProjectEditor } from '@/pages/me/project';
import { NotFound } from '@/pages/not-found';
import { Verify } from '@/pages/verify';
import { App } from './app';
import { RootLayout } from './root-layout';
import { NOT_FOUND_PATH, ROUTES, type RoutePath } from './routes';

const ELEMENTS: Record<RoutePath, ReactNode> = {
  '/': <App />,
  '/login': <Login />,
  '/verify': <Verify />,
  '/account': (
    <ProtectedRoute>
      <Account />
    </ProtectedRoute>
  ),
  '/briefs': <Briefs />,
  '/briefs/:slug': <BriefPage />,
  '/account/briefs': (
    <ProtectedRoute>
      <AccountBriefs />
    </ProtectedRoute>
  ),
  '/account/briefs/:id': (
    <ProtectedRoute>
      <AccountBrief />
    </ProtectedRoute>
  ),
  '/designers': <Designers />,
  '/designers/:slug': <DesignerProfilePage />,
  '/designers/:slug/portfolio': <DesignerPortfolio />,
  '/designers/:slug/portfolio/:projectSlug': <PortfolioProjectPage />,
  '/me': (
    <ProtectedRoute roles={['designer']}>
      <MyStudio />
    </ProtectedRoute>
  ),
  '/me/profile': (
    <ProtectedRoute roles={['designer']}>
      <MyProfileEditor />
    </ProtectedRoute>
  ),
  '/me/portfolio': (
    <ProtectedRoute roles={['designer']}>
      <MyPortfolio />
    </ProtectedRoute>
  ),
  '/me/portfolio/:id': (
    <ProtectedRoute roles={['designer']}>
      <MyProjectEditor />
    </ProtectedRoute>
  ),
  '/admin': (
    <ProtectedRoute roles={['admin']}>
      <AdminHome />
    </ProtectedRoute>
  ),
  '/admin/designers': (
    <ProtectedRoute roles={['admin']}>
      <AdminDesigners />
    </ProtectedRoute>
  ),
  '/admin/designers/:id': (
    <ProtectedRoute roles={['admin']}>
      <AdminDesignerReview />
    </ProtectedRoute>
  ),
};

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    // REQ-FAIL-004. Without this, React Router renders its own error page —
    // "Unexpected Application Error!" plus a stack trace — for any render
    // crash inside a route, and it does so before the app's own boundary can
    // see it.
    errorElement: <RouteErrorElement />,
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
