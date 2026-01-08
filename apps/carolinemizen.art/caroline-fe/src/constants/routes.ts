import { Artwork, Collection, Collections, Home } from '../pages';
import {
  AdminCarousel,
  AdminDashboard,
  AdminFeaturedGalleries,
  AdminLogin,
  AdminVerify,
} from '../pages/admin';

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

  // Admin routes
  adminLogin: { path: '/admin/login', Component: AdminLogin },
  adminVerify: { path: '/admin/verify', Component: AdminVerify },
  adminDashboard: { path: '/admin/dashboard', Component: AdminDashboard },
  Artworks: { path: '/admin/artworks' },
  adminArtworkEdit: { path: '/admin/artworks/:id' },
  adminGalleries: { path: '/admin/collections' },
  adminGalleryEdit: { path: '/admin/collections/:id' },
  adminFeaturedGalleries: {
    path: '/admin/featured-collections',
    Component: AdminFeaturedGalleries,
  },
  adminImages: { path: '/admin/images' },
  adminContent: { path: '/admin/carousel', Component: AdminCarousel },
};

export type { RouteType };
export { ROUTES };
