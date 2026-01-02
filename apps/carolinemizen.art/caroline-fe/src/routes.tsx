import type { FC } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './components/admin-layout';
import { ProtectedRoute } from './components/protected-route';
import { ROUTES } from './constants';
import { AuthProvider } from './contexts';
import { NotFound } from './pages';
import {
  AdminArtworkEdit,
  AdminGalleries,
  AdminGalleryEdit,
  AdminImages,
  Artworks,
} from './pages/admin';

const AppRoutes: FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path={ROUTES.home.path} Component={ROUTES.home.Component} />
          <Route
            path={ROUTES.collections.path}
            Component={ROUTES.collections.Component}
          />
          <Route
            path={ROUTES.collection.path}
            Component={ROUTES.collection.Component}
          />
          <Route
            path={ROUTES.artwork.path}
            Component={ROUTES.artwork.Component}
          />
          <Route
            path={ROUTES.swatch.path}
            Component={ROUTES.swatch.Component}
          />

          {/* Admin auth routes (not protected) */}
          <Route
            path={ROUTES.adminLogin.path}
            Component={ROUTES.adminLogin.Component}
          />
          <Route
            path={ROUTES.adminVerify.path}
            Component={ROUTES.adminVerify.Component}
          />

          {/* Protected admin routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route
              path={ROUTES.adminDashboard.path}
              Component={ROUTES.adminDashboard.Component}
            />
            <Route path={ROUTES.Artworks.path} Component={Artworks} />
            <Route
              path={ROUTES.adminArtworkEdit.path}
              Component={AdminArtworkEdit}
            />
            <Route
              path={ROUTES.adminGalleries.path}
              Component={AdminGalleries}
            />
            <Route
              path={ROUTES.adminGalleryEdit.path}
              Component={AdminGalleryEdit}
            />
            <Route path={ROUTES.adminImages.path} Component={AdminImages} />
            <Route
              path={ROUTES.adminContent.path}
              element={<div>Content</div>}
            />
            <Route path={ROUTES.adminOrders.path} element={<div>Orders</div>} />
            <Route
              path={ROUTES.adminOrderDetail.path}
              element={<div>Order Detail</div>}
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export { AppRoutes };
