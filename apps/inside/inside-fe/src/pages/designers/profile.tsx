import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Grid,
  Link as MuiLink,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { PublicProject } from '@shared/types';
import type { FC } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ResponsiveImage } from '@/components';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import { humanise, useDesigner } from '@/features/discovery/use-designers';

const HERO_SIZES = '(max-width: 900px) 100vw, 900px';
const TILE_SIZES = '(max-width: 600px) 100vw, (max-width: 900px) 50vw, 450px';

const PieceTile: FC<{
  slug: string;
  project: PublicProject;
  first: boolean;
}> = ({ slug, project, first }) => (
  <MuiLink
    component={Link}
    to={`/designers/${slug}/portfolio/${project.slug}`}
    underline="none"
    color="inherit"
    sx={{ display: 'block' }}
  >
    {project.coverImage ? (
      <ResponsiveImage
        image={project.coverImage}
        sizes={TILE_SIZES}
        alt={project.title}
        // Only the first tile is likely above the fold; the rest wait.
        priority={first}
      />
    ) : (
      <Box sx={{ aspectRatio: '3 / 2', backgroundColor: 'action.hover' }} />
    )}
    <Typography variant="h6" component="h3" sx={{ mt: 1.5 }}>
      {project.title}
    </Typography>
    {project.summary && (
      <Typography variant="body2" color="text.secondary">
        {project.summary}
      </Typography>
    )}
  </MuiLink>
);

const DesignerProfilePage: FC = () => {
  const slug = useParams().slug as string;
  const query = useDesigner(slug);

  // The route table can only know the slug; the studio's real name is a
  // runtime fact, so the crumb is corrected once it is known.
  useBreadcrumbTitle(query.data?.profile.studioName);

  if (query.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Stack spacing={3}>
          {/* Visually a skeleton, but still a real heading: the page must
              identify itself in every state. */}
          <Typography variant="h1" sx={{ fontSize: { xs: 40, md: 64 } }}>
            <Skeleton width={320} />
          </Typography>
          <Skeleton variant="rectangular" sx={{ aspectRatio: '3 / 2' }} />
        </Stack>
      </Container>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Stack spacing={3}>
          <Typography variant="h3" component="h1">
            Designer not found
          </Typography>
          <Alert severity="info" data-testid="designer-missing">
            That studio is not listed. It may have been removed, or the link may
            be wrong.
          </Alert>
          <Button
            component={Link}
            to="/designers"
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
          >
            Browse designers
          </Button>
        </Stack>
      </Container>
    );
  }

  const { profile, portfolioProjects } = query.data;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack spacing={5}>
        <Stack spacing={2}>
          <Typography
            variant="h1"
            sx={{ fontSize: { xs: 40, md: 64 } }}
            data-testid="studio-name"
          >
            {profile.studioName}
          </Typography>
          {profile.headline && (
            <Typography
              variant="h5"
              color="text.secondary"
              sx={{ maxWidth: 720 }}
            >
              {profile.headline}
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {profile.location && (
              <Chip variant="outlined" label={profile.location} />
            )}
            {profile.budgetBand && (
              <Chip variant="outlined" label={humanise(profile.budgetBand)} />
            )}
            {profile.availability && (
              <Chip variant="outlined" label={humanise(profile.availability)} />
            )}
          </Stack>
        </Stack>

        {portfolioProjects[0]?.coverImage && (
          <ResponsiveImage
            image={portfolioProjects[0].coverImage}
            sizes={HERO_SIZES}
            alt={`Work by ${profile.studioName}`}
            priority
            ratio="16 / 9"
          />
        )}

        {profile.bio && (
          <Typography sx={{ maxWidth: 720, fontSize: 18, lineHeight: 1.7 }}>
            {profile.bio}
          </Typography>
        )}

        <Stack direction="row" spacing={2}>
          <Button variant="contained" size="large" component={Link} to="/login">
            Get in touch
          </Button>
          {profile.websiteUrl && (
            <Button
              variant="text"
              size="large"
              href={profile.websiteUrl}
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              Studio website
            </Button>
          )}
        </Stack>

        <Divider />

        <Box>
          <Typography variant="h4" component="h2" sx={{ mb: 3 }}>
            Selected work
          </Typography>
          {portfolioProjects.length === 0 ? (
            <Typography color="text.secondary">
              This studio has not published any work yet.
            </Typography>
          ) : (
            <Grid container spacing={4} data-testid="portfolio-grid">
              {portfolioProjects.map((project, index) => (
                <Grid key={project.id} size={{ xs: 12, sm: 6 }}>
                  <PieceTile
                    slug={slug}
                    project={project}
                    first={index === 0}
                  />
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      </Stack>
    </Container>
  );
};

export { DesignerProfilePage };
