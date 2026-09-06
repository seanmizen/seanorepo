import {
  Alert,
  Chip,
  CircularProgress,
  Container,
  Link as MuiLink,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { adminDesignerFilters } from '@shared/filters';
import type { DesignerProfileStatus } from '@shared/types';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { useReviewQueue } from '@/features/admin/use-admin-designers';
import { useFilters } from '@/features/filters/use-filters';

type Filter = DesignerProfileStatus | 'all';

const FILTERS: Filter[] = ['pending', 'approved', 'rejected', 'draft', 'all'];

/** `all` is the absence of a status filter, not a status. */
const toStatuses = (filter: Filter): DesignerProfileStatus[] =>
  filter === 'all' ? [] : [filter];

const STATUS_COLOUR: Record<
  DesignerProfileStatus,
  'default' | 'warning' | 'success' | 'error'
> = {
  draft: 'default',
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

const AdminDesigners: FC = () => {
  // Filter state lives in the URL, so a reviewer can bookmark or share
  // "everything still pending" and the back button behaves.
  const { values, setFilters } = useFilters(adminDesignerFilters);
  // Pending first: it is the only list with work waiting in it.
  const filter: Filter = (values.statuses?.[0] as Filter) ?? 'pending';
  const queue = useReviewQueue(toStatuses(filter));

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Typography variant="h3" component="h1">
          Designer review queue
        </Typography>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, next: Filter | null) =>
            next && setFilters({ statuses: toStatuses(next) })
          }
          aria-label="Filter by status"
        >
          {FILTERS.map((value) => (
            <ToggleButton key={value} value={value}>
              {value}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {queue.isPending && <CircularProgress />}
        {queue.isError && (
          <Alert severity="error">Could not load the review queue.</Alert>
        )}

        {queue.data &&
          (queue.data.designers.length === 0 ? (
            <Typography color="text.secondary" data-testid="queue-empty">
              Nothing waiting here.
            </Typography>
          ) : (
            <Table size="small" data-testid="review-queue">
              <TableHead>
                <TableRow>
                  <TableCell>Studio</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Portfolio</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {queue.data.designers.map((designer) => (
                  <TableRow key={designer.id} hover>
                    <TableCell>
                      <MuiLink
                        component={Link}
                        to={`/admin/designers/${designer.id}`}
                      >
                        {designer.studioName}
                      </MuiLink>
                    </TableCell>
                    <TableCell>{designer.location ?? '—'}</TableCell>
                    <TableCell>{designer.projectCount}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={designer.status}
                        color={STATUS_COLOUR[designer.status]}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ))}
      </Stack>
    </Container>
  );
};

export { AdminDesigners };
