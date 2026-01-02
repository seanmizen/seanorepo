import { Artwork, Collection, Collections, Home, Swatch } from '../pages';
import { AdminDashboard, AdminLogin, AdminVerify } from '../pages/admin';

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
  collection: { path: '/collections/:id', Component: Collection },
  artwork: { path: '/collections/:id/:artworkId', Component: Artwork },
  swatch: { path: '/swatch', Component: Swatch },

  // Admin routes
  adminLogin: { path: '/admin/login', Component: AdminLogin },
  adminVerify: { path: '/admin/verify', Component: AdminVerify },
  adminDashboard: { path: '/admin/dashboard', Component: AdminDashboard },
  Artworks: { path: '/admin/artworks' },
  adminArtworkEdit: { path: '/admin/artworks/:id' },
  adminGalleries: { path: '/admin/galleries' },
  adminGalleryEdit: { path: '/admin/galleries/:id' },
  adminImages: { path: '/admin/images' },
  adminContent: { path: '/admin/content' },
  adminOrders: { path: '/admin/orders' },
  adminOrderDetail: { path: '/admin/orders/:id' },
};

export type { RouteType };
export { ROUTES };
