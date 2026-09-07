import {
  Alert,
  Box,
  Card,
  CardActionArea,
  Chip,
  Container,
  Grid,
  MenuItem,
  Pagination,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { BUDGET_BANDS, WORK_TYPES } from '@shared/enums';
import { designerFilters } from '@shared/filters';
import type { DesignerListItem } from '@shared/types';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveImage } from '@/components';
import { humanise, useDesigners } from '@/features/discovery/use-designers';
import { useFilters } from '@/features/filters/use-filters';

/**
 * Each card is roughly a third of the container on desktop, half on tablet and
 * the full width on a phone. Stated explicitly because the browser chooses an
 * image variant from this before layout — get it wrong and every phone
 * downloads the 2000px file.
 */
const CARD_SIZES = '(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw';

const DesignerCard: FC<{ designer: DesignerListItem }> = ({ designer }) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
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

const Designers: FC = () => {
  // All filter state lives in the URL, so a filtered list is shareable and
  // survives a reload and the back button.
  const { values, setFilters } = useFilters(designerFilters);
  const query = useDesigners(values as Record<string, unknown>);

  const pageCount = query.data
    ? Math.max(1, Math.ceil(query.data.total / query.data.limit))
    : 1;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack spacing={4}>
        <Box>
          <Typography
            variant="h2"
            component="h1"
            sx={{ fontSize: { xs: 40, md: 56 } }}
          >
            Designers
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Architects and interior designers, reviewed before they are listed.
          </Typography>
        </Box>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          component="search"
        >
          <TextField
            label="Search"
            size="small"
            fullWidth
            value={values.q ?? ''}
            onChange={(event) => setFilters({ q: event.target.value })}
          />
          <TextField
            select
            label="Work type"
            size="small"
            sx={{ minWidth: 180 }}
            value={values.workTypes?.[0] ?? ''}
            onChange={(event) =>
              setFilters({
                workTypes: event.target.value ? [event.target.value] : [],
              })
            }
          >
            <MenuItem value="">Any</MenuItem>
            {WORK_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {humanise(type)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Budget"
            size="small"
            sx={{ minWidth: 180 }}
            value={values.budgetBands?.[0] ?? ''}
            onChange={(event) =>
              setFilters({
                budgetBands: event.target.value ? [event.target.value] : [],
              })
            }
          >
            <MenuItem value="">Any</MenuItem>
            {BUDGET_BANDS.map((band) => (
              <MenuItem key={band} value={band}>
                {humanise(band)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Location"
            size="small"
            sx={{ minWidth: 180 }}
            value={values.location ?? ''}
            onChange={(event) => setFilters({ location: event.target.value })}
          />
        </Stack>

        {query.isError && (
          <Alert severity="error" data-testid="designers-failure">
            The designer list could not be loaded.
          </Alert>
        )}

        {query.isPending ? (
          <Grid container spacing={3} data-testid="designers-loading">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <Grid key={n} size={{ xs: 12, sm: 6, md: 4 }}>
                <Skeleton variant="rectangular" sx={{ aspectRatio: '3 / 2' }} />
                <Skeleton sx={{ mt: 1 }} />
                <Skeleton width="60%" />
              </Grid>
            ))}
          </Grid>
        ) : query.data && query.data.designers.length === 0 ? (
          // A filter that matches nothing is a valid answer, not an error —
          // so it gets a real empty state rather than a blank page.
          <Stack spacing={1} sx={{ py: 8 }} data-testid="designers-empty">
            <Typography variant="h6" component="p">
              No designers match those filters yet.
            </Typography>
            <Typography color="text.secondary">
              Try widening the budget or clearing the location.
            </Typography>
          </Stack>
        ) : (
          <Grid container spacing={3} data-testid="designers-grid">
            {query.data?.designers.map((designer) => (
              <Grid key={designer.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <DesignerCard designer={designer} />
              </Grid>
            ))}
          </Grid>
        )}

        {pageCount > 1 && (
          <Pagination
            page={values.page}
            count={pageCount}
            onChange={(_, page) => setFilters({ page })}
            sx={{ alignSelf: 'center' }}
          />
        )}
      </Stack>
    </Container>
  );
};

export { Designers };
