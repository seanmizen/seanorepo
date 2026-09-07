import { Box, Button, Container, Stack, Typography } from '@mui/material';
import type { FC } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/contexts/auth-context';

/**
 * The site header, on every page.
 *
 * Before this there was no navigation at all: /designers existed but nothing
 * linked to it, so the only way to reach a page was to type its URL.
 *
 * It is in normal flow rather than fixed, so nothing overlaps it and the page
 * beneath does not need to reserve space for it.
 */
const NavLink: FC<{ to: string; children: string; current: boolean }> = ({
  to,
  children,
  current,
}) => (
  <Button
    component={Link}
    to={to}
    size="small"
    color="inherit"
    // Marks the section you are in for a screen reader, not just visually.
    aria-current={current ? 'page' : undefined}
    sx={{
      minWidth: 0,
      px: 1,
      opacity: current ? 1 : 0.72,
      borderBottom: '1px solid',
      borderColor: current ? 'text.primary' : 'transparent',
      borderRadius: 0,
      '&:hover': { opacity: 1, backgroundColor: 'transparent' },
    }}
  >
    {children}
  </Button>
);

const SiteHeader: FC = () => {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  return (
    <Box
      component="header"
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.default',
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction="row"
          alignItems="center"
          spacing={{ xs: 1, sm: 2 }}
          sx={{
            height: 68,
            /*
             * No left indent, deliberately. It used to reserve 104/124px for
             * the floating chips (REQ-CHIPS-004), which meant the brand sat
             * offset from the breadcrumb trail below it for a reason that is
             * invisible in production — where, since #222, there are no chips
             * at all.
             *
             * REQ-CHIPS-004 still holds: the chips now avoid the header by
             * living at the bottom-left (REQ-CHIPS-009) rather than by the
             * header moving aside for them.
             */
          }}
        >
          <Typography
            component={Link}
            to="/"
            variant="h5"
            sx={{
              textDecoration: 'none',
              color: 'text.primary',
              letterSpacing: '-0.02em',
              mr: { xs: 0.5, sm: 2 },
            }}
          >
            inside
          </Typography>

          <Stack direction="row" component="nav" aria-label="Main">
            <NavLink
              to="/designers"
              current={pathname.startsWith('/designers')}
            >
              Designers
            </NavLink>
          </Stack>

          <Box sx={{ flexGrow: 1 }} />

          {/*
            Waits for the session check rather than guessing. Rendering
            "Sign in" and then swapping it for "Account" is the same
            assert-before-you-know problem fixed in SEAN-183.
          */}
          {!loading && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              {user?.role === 'admin' && (
                <NavLink to="/admin" current={pathname.startsWith('/admin')}>
                  Admin
                </NavLink>
              )}
              <NavLink
                to={user ? '/account' : '/login'}
                current={pathname === '/account'}
              >
                {user ? 'Account' : 'Sign in'}
              </NavLink>
            </Stack>
          )}

          <ThemeToggle />
        </Stack>
      </Container>
    </Box>
  );
};

export { SiteHeader };
