import BookmarkRemoveIcon from '@mui/icons-material/BookmarkRemove';
import {
  Box,
  Card,
  CardActionArea,
  Chip,
  Container,
  Grid,
  IconButton,
  Pagination,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SavedDesignerListItem } from '@shared/types';
import type { FC } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FailureNotice, ResponsiveImage } from '@/components';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import { humanise } from '@/features/discovery/use-designers';
import {
  useSavedDesigners,
  useUnsaveDesigner,
} from '@/features/saved/use-saved-designers';

const CARD_SIZES = '(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw';

/**
 * One shortlist card.
 *
 * Deliberately not `SaveDesignerButton`: this page already knows the
 * designer is saved (it is on the list because it is), so re-deriving that
 * with `useIsSaved` would be a second request per card for a fact this page
 * already has. Removing here always means removing, never toggling.
 */
const SavedDesignerCard: FC<{
  designer: SavedDesignerListItem;
  onRemove: (id: number) => void;
  removing: boolean;
}> = ({ designer, onRemove, removing }) => (
  <Card variant="outlined" sx={{ height: '100%', position: 'relative' }}>
    <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
      <Tooltip title={`Remove ${designer.studioName} from your shortlist`}>
        <IconButton
          onClick={() => onRemove(designer.id)}
          disabled={removing}
          aria-label={`Remove ${designer.studioName} from your shortlist`}
          data-testid="unsave-designer"
          sx={{ backgroundColor: 'background.paper', boxShadow: 1 }}
        >
          <BookmarkRemoveIcon />
        </IconButton>
      </Tooltip>
    </Box>
    <CardActionArea
      component={Link}
      to={`/designers/${designer.slug}`}
      sx={{ height: '100%', display: 'block' }}
    >
      {designer.coverImage ? (
        <ResponsiveImage
          image={designer.coverImage}
          sizes={CARD_SIZES}
          alt={`Work by ${designer.studioName}`}
        />
      ) : (
        <Box sx={{ aspectRatio: '3 / 2', backgroundColor: 'action.hover' }} />
      )}
      <Box sx={{ p: 2.5 }}>
        <Typography variant="h6" component="h2">
          {designer.studioName}
        </Typography>
        {designer.headline && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {designer.headline}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          {designer.location && (
            <Chip size="small" variant="outlined" label={designer.location} />
          )}
          {designer.budgetBand && (
            <Chip
              size="small"
              variant="outlined"
              label={humanise(designer.budgetBand)}
            />
          )}
        </Stack>
      </Box>
    </CardActionArea>
  </Card>
);

/**
 * The buyer's shortlist. REQ-PRODUCT-003 — this is what a signed-out visitor
 * was invited to create an account for.
 *
 * Page state lives in local `page` rather than the URL, unlike `/designers`:
 * a shortlist is personal and never shared by link, so there is nothing here
 * worth making bookmarkable.
 */
const AccountSaved: FC = () => {
  useBreadcrumbTitle('saved designers');
  const [page, setPage] = useState(1);
  const query = useSavedDesigners(page);
  const unsave = useUnsaveDesigner();

  const pageCount = query.data
    ? Math.max(1, Math.ceil(query.data.total / query.data.limit))
    : 1;

  if (query.isPending) {
    return (
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
        <Stack spacing={4}>
          <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
            Saved designers
          </Typography>
          <Grid container spacing={3} data-testid="saved-designers-loading">
            {[0, 1, 2].map((n) => (
              <Grid key={n} size={{ xs: 12, sm: 6, md: 4 }}>
                <Skeleton variant="rectangular" sx={{ aspectRatio: '3 / 2' }} />
                <Skeleton sx={{ mt: 1 }} />
                <Skeleton width="60%" />
              </Grid>
            ))}
          </Grid>
        </Stack>
      </Container>
    );
  }

  if (query.isError) {
    return (
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
        <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 }, mb: 3 }}>
          Saved designers
        </Typography>
        <FailureNotice
          error={query.error}
          notFound={{
            title: 'Saved designers',
            body: 'Your saved designers could not be loaded.',
          }}
          onRetry={() => query.refetch()}
          testId="saved-designers-load-failure"
        />
      </Container>
    );
  }

  const items = query.data.savedDesigners;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack spacing={4}>
        <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
          Saved designers
        </Typography>

        {items.length === 0 ? (
          // Empty is a real, valid answer — a buyer who has not saved anyone
          // yet, not a failure — so it gets a real design, not a blank grid.
          <Stack spacing={2} sx={{ py: 8 }} data-testid="saved-designers-empty">
            <Typography variant="h6" component="p">
              Nothing saved yet.
            </Typography>
            <Typography color="text.secondary">
              Save a studio from its profile or from the designer list to come
              back to it here.
            </Typography>
            <Box>
              <Typography
                component={Link}
                to="/designers"
                color="primary"
                sx={{ textDecoration: 'none', fontWeight: 500 }}
              >
                Browse designers
              </Typography>
            </Box>
          </Stack>
        ) : (
          <Grid container spacing={3} data-testid="saved-designers-grid">
            {items.map((designer) => (
              <Grid key={designer.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <SavedDesignerCard
                  designer={designer}
                  onRemove={(id) => unsave.mutate(id)}
                  removing={
                    unsave.isPending && unsave.variables === designer.id
                  }
                />
              </Grid>
            ))}
          </Grid>
        )}

        {pageCount > 1 && (
          <Pagination
            page={page}
            count={pageCount}
            onChange={(_, next) => setPage(next)}
            sx={{ alignSelf: 'center' }}
          />
        )}
      </Stack>
    </Container>
  );
};

export { AccountSaved };
