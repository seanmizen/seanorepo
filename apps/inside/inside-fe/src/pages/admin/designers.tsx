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
import type { DesignerProfileStatus } from '@shared/types';
import { type FC, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReviewQueue } from '@/features/admin/use-admin-designers';

type Filter = DesignerProfileStatus | 'all';

const FILTERS: Filter[] = ['pending', 'approved', 'rejected', 'draft', 'all'];

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
  // Pending first: it is the only list with work waiting in it.
  const [filter, setFilter] = useState<Filter>('pending');
  const queue = useReviewQueue(filter);

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
          onChange={(_, next: Filter | null) => next && setFilter(next)}
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
                  <TableCell>Projects</TableCell>
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
