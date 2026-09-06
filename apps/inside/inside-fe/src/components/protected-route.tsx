import { Box, CircularProgress } from '@mui/material';
import type { UserRole } from '@shared/types';
import type { FC, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';

interface ProtectedRouteProps {
  children: ReactNode;
  /** When set, the signed-in user must hold one of these roles. */
  roles?: UserRole[];
}

export const ProtectedRoute: FC<ProtectedRouteProps> = ({
  children,
  roles,
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Must wait: redirecting before /me resolves would bounce signed-in users
  // to the login page on every hard refresh.
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    // Carry where they were so signing in resumes it.
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
