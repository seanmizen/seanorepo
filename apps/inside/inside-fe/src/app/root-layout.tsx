import type { FC } from 'react';
import { Outlet } from 'react-router-dom';
import { Breadcrumbs } from '@/components';
import { BreadcrumbTitleProvider } from '@/contexts/breadcrumb-context';

/**
 * Wraps every route, so the breadcrumb is structural rather than something
 * each page has to remember to render. A new page inherits the trail — and
 * the no-dead-intermediate-paths guard that comes with it — for free.
 */
const RootLayout: FC = () => (
  <BreadcrumbTitleProvider>
    <Breadcrumbs />
    <Outlet />
  </BreadcrumbTitleProvider>
);

export { RootLayout };
