import {
  Breadcrumbs as MuiBreadcrumbs,
  Link as MuiLink,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { crumbsFor } from '@/app/routes';
import { useBreadcrumbTitleValue } from '@/contexts/breadcrumb-context';

/**
 * The trail, mirroring the URL: `home › subsection › page`.
 *
 * Rendered once by the root layout so every route — including every route
 * added later — gets it without opting in.
 *
 * Placement: fixed top-left, *below* the status chips, which occupy
 * `top: 16` and stand at most two chips tall (~50px). The theme toggle owns
 * the top-right corner. Sitting under the chips rather than beside them is
 * what keeps all three clear of each other at 375px, where a centred or
 * right-aligned trail would run into one or the other.
 */
const Breadcrumbs: FC = () => {
  const { pathname } = useLocation();
  const pageTitle = useBreadcrumbTitleValue();

  const crumbs = crumbsFor(pathname).map((crumb, index, all) =>
    // Only the page you are on may rename its own crumb.
    crumb.isCurrent && pageTitle && index === all.length - 1
      ? { ...crumb, label: pageTitle }
      : crumb,
  );

  return (
    <MuiBreadcrumbs
      aria-label="Breadcrumb"
      separator="›"
      data-testid="breadcrumbs"
      sx={{
        position: 'fixed',
        top: 76,
        left: 16,
        zIndex: (theme) => theme.zIndex.appBar,
        maxWidth: 'calc(100vw - 32px)',
        // A backdrop, matching the status chips, so the trail stays legible
        // where it floats over a page's own content on a short viewport.
        backgroundColor: 'background.default',
        borderRadius: 1,
        px: 0.5,
        color: 'text.secondary',
        fontSize: 13,
        '& .MuiBreadcrumbs-separator': { mx: 0.75 },
      }}
    >
      {crumbs.map((crumb) =>
        // A crumb is a link only when a route really serves it. For a declared
        // route that is always — `findMissingAncestors` guarantees it — so the
        // inert case can only ever be a URL nobody declared, where linking
        // would just be an invitation into a 404.
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
  );
};

export { Breadcrumbs };
