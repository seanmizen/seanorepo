import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import {
  ApiError,
  useMyPortfolio,
  useSaveProject,
} from '@/features/designer-onboarding/use-my-studio';

/**
 * The designer's own portfolio list — drafts included.
 *
 * The public list shows only published work (REQ-DISCOVERY-002); this one is
 * the opposite by design. A designer needs to see what is unfinished, and the
 * status chip is what keeps the two readings apart.
 */
const MyPortfolio: FC = () => {
  useBreadcrumbTitle('portfolio');
  const navigate = useNavigate();
  const query = useMyPortfolio();
  const create = useSaveProject();
  const [error, setError] = useState<string | null>(null);

  const addPiece = async () => {
    setError(null);
    try {
      const created = await create.mutateAsync({
        id: null,
        fields: { title: 'Untitled piece' },
      });
      navigate(`/me/portfolio/${created.project.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That could not be created. Try again.',
      );
    }
  };

  if (query.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
          Your work
        </Typography>
        <Skeleton variant="rectangular" height={200} sx={{ mt: 3 }} />
      </Container>
    );
  }

  if (query.isError) {
    // A designer with no profile yet is not an error, it is the step before
    // this one — so it gets a way forward rather than a red box.
    const noProfileYet =
      query.error instanceof ApiError && query.error.status === 404;

    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Stack spacing={3} alignItems="flex-start">
          <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
            Your work
          </Typography>
          {noProfileYet ? (
            <>
              <Typography color="text.secondary" data-testid="portfolio-empty">
                Set up your profile first — your work hangs off it.
              </Typography>
              <Button component={Link} to="/me/profile" variant="contained">
                Start your profile
              </Button>
            </>
          ) : (
            <Alert severity="error" data-testid="portfolio-error">
              Your portfolio could not be loaded.
            </Alert>
          )}
        </Stack>
      </Container>
    );
  }

  const pieces = query.data?.portfolioProjects ?? [];

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
            Your work
          </Typography>
          <Button
            onClick={addPiece}
            variant="contained"
            startIcon={<AddIcon />}
            disabled={create.isPending}
            data-testid="add-piece"
          >
            {create.isPending ? 'Adding…' : 'Add a piece'}
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" data-testid="portfolio-error">
            {error}
          </Alert>
        )}

        {pieces.length === 0 ? (
          <Typography color="text.secondary" data-testid="portfolio-empty">
            Nothing here yet. Add a completed project — buyers browse by the
            work first and the words second.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {pieces.map((piece) => (
              <Card key={piece.id} variant="outlined">
                <CardContent>
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    justifyContent="space-between"
                    flexWrap="wrap"
                    useFlexGap={true}
                  >
                    <Stack spacing={0.5}>
                      <Typography variant="h2" sx={{ fontSize: 20 }}>
                        {piece.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {piece.summary || 'No summary yet.'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        size="small"
                        label={
                          piece.status === 'published' ? 'published' : 'draft'
                        }
                        color={
                          piece.status === 'published' ? 'success' : 'default'
                        }
                      />
                      <Button
                        component={Link}
                        to={`/me/portfolio/${piece.id}`}
                        variant="outlined"
                        size="small"
                      >
                        Edit
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  );
};

export { MyPortfolio };
