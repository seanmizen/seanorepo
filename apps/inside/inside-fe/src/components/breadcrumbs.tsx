import {
  Box,
  Breadcrumbs as MuiBreadcrumbs,
  Link as MuiLink,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { crumbsFor } from '@/app/routes';
import { useBreadcrumbTitles } from '@/contexts/breadcrumb-context';

/**
 * The trail, mirroring the URL: `home › subsection › page`.
 *
 * Rendered once by the root layout so every route — including every route
 * added later — gets it without opting in (REQ-NAV-004).
 *
 * Placement: in normal flow beneath the site header. The status chips float
 * over everything at the top-left (REQ-CHIPS-001) and the header reserves
 * space for them (REQ-CHIPS-004); the trail sits below both. Being in flow
 * rather than fixed is what keeps all three clear of each other at 375px,
 * where a centred or right-aligned trail would run into one or the other.
 */
const Breadcrumbs: FC = () => {
  const { pathname } = useLocation();
  const titles = useBreadcrumbTitles();

  // REQ-NAV-003. Any crumb may carry a real name, not just the current page: a
  // nested page knows its ancestors' names too, and a placeholder in the middle
  // of a trail is as unhelpful as one at the end.
  const crumbs = crumbsFor(pathname).map((crumb) =>
    titles[crumb.path] ? { ...crumb, label: titles[crumb.path] } : crumb,
  );

  return (
    /*
     * A tray of its own, rather than the trail floating in the page ground.
     *
     * `background.paper` against the header's `background.default` reads as a
     * lighter band in light mode and a subtle lift in dark, from one token
     * pair — no per-theme colours in the component, which is the rule in
     * apps/inside/CLAUDE.md.
     *
     * Still in normal flow: it sits under the header and above the content,
     * which is what keeps it clear of the floating chips (REQ-CHIPS-001) and
     * the theme toggle at 375px.
     */
    <Box
      component="nav"
      data-testid="breadcrumb-tray"
      sx={{
        backgroundColor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <MuiBreadcrumbs
        aria-label="Breadcrumb"
        separator="›"
        data-testid="breadcrumbs"
        sx={{
          maxWidth: 'lg',
          mx: 'auto',
          width: '100%',
          px: { xs: 3, md: 5 },
          /*
           * Enough that the crumbs clear the floating chips, which overhang
           * the header's bottom edge by a few pixels and would otherwise sit
           * on the first crumb at 375px. The chips overlay everything by
           * design (REQ-CHIPS-001), so it is the trail that yields.
           */
          py: 2,
          color: 'text.secondary',
          fontSize: 13,
          '& .MuiBreadcrumbs-separator': { mx: 0.75 },
        }}
      >
        {crumbs.map((crumb) =>
          // REQ-NAV-002. A crumb is a link only when a route really serves it.
          // For a declared route that is always — REQ-NAV-001 guarantees it, via
          // `findMissingAncestors` — so the inert case can only ever be a URL
          // nobody declared, where linking would be an invitation into a 404.
          crumb.isCurrent || !crumb.exists ? (
            <Typography
              key={crumb.path}
              component="span"
              aria-current={crumb.isCurrent ? 'page' : undefined}
              data-testid="breadcrumb-crumb"
              sx={{
                fontSize: 'inherit',
                color: crumb.isCurrent ? 'text.primary' : 'inherit',
              }}
            >
              {crumb.label}
            </Typography>
          ) : (
            <MuiLink
              key={crumb.path}
              component={RouterLink}
              to={crumb.path}
              color="inherit"
              data-testid="breadcrumb-crumb"
              sx={{
                fontSize: 'inherit',
                // Always underlined, not just on hover: the crumbs sit in a row
                // of separator glyphs, so colour alone would be the only thing
                // marking a link (WCAG 1.4.1 Use of Colour).
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {crumb.label}
            </MuiLink>
          ),
        )}
      </MuiBreadcrumbs>
    </Box>
  );
};

export { Breadcrumbs };
