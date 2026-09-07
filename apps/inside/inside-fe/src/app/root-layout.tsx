import type { FC } from 'react';
import { Outlet } from 'react-router-dom';
import { Breadcrumbs, SiteHeader } from '@/components';
import { BreadcrumbTitleProvider } from '@/contexts/breadcrumb-context';

/**
 * Wraps every route, so the breadcrumb is structural rather than something
 * each page has to remember to render. A new page inherits the trail — and
 * the no-dead-intermediate-paths guard that comes with it — for free.
 *
 * REQ-NAV-004. Do not move `<Breadcrumbs />` down into pages that "need" it:
 * the first route someone forgot would lose its trail silently, and the guard
 * reads the route table rather than the DOM, so it would still pass.
 */
const RootLayout: FC = () => (
  <BreadcrumbTitleProvider>
    <SiteHeader />
    <Breadcrumbs />
    <Outlet />
  </BreadcrumbTitleProvider>
);

export { RootLayout };
