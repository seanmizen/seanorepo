import { Collections, Home, Swatch } from '../pages';

type RouteType = {
  path: string;
  exact?: boolean;
  Component?: React.FC;
};

/**
 * Routes for the application. Contains the path, exact, and Component for each route.
 */
const ROUTES: Record<string, RouteType> = {
  home: { exact: true, path: '/', Component: Home },
  collections: { path: '/collections', Component: Collections },
  collection: { path: '/collections/:id' },
  artwork: { path: '/collections/:id/:artworkId' },
  swatch: { path: '/swatch', Component: Swatch },
};

export type { RouteType };
export { ROUTES };
