import {
  Alert,
  Box,
  Container,
  Grid,
  Link as MuiLink,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ResponsiveImage } from '@/components';
import { useCrumbTitles } from '@/contexts/breadcrumb-context';
import { useDesigner } from '@/features/discovery/use-designers';

const TILE_SIZES = '(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw';

/**
 * A studio's complete portfolio.
 *
 * This page exists partly because it is genuinely useful and partly because
 * `/designers/:slug/portfolio/:projectSlug` implies it: the breadcrumb renders
 * `/designers/:slug/portfolio` as a link, and a link that 404s is a bug.
 */
const DesignerPortfolio: FC = () => {
  const slug = useParams().slug as string;
  const query = useDesigner(slug);
  useCrumbTitles({
    [`/designers/${slug}`]: query.data?.profile.studioName,
  });

  if (query.isPending) {
    return (
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Typography
          variant="h2"
          component="h1"
          sx={{ fontSize: { xs: 36, md: 48 } }}
        >
          <Skeleton width={280} />
        </Typography>
      </Container>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Typography variant="h3" component="h1">
          Portfolio not found
        </Typography>
        <Alert severity="info" sx={{ mt: 3 }} data-testid="portfolio-missing">
          That studio is not listed.
        </Alert>
      </Container>
    );
  }

  const { profile, portfolioProjects } = query.data;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack spacing={4}>
        <Box>
          <Typography
            variant="h2"
            component="h1"
            sx={{ fontSize: { xs: 36, md: 48 } }}
          >
            {profile.studioName}
          </Typography>
          <Typography color="text.secondary">
            {portfolioProjects.length} published{' '}
            {portfolioProjects.length === 1 ? 'project' : 'projects'}
          </Typography>
        </Box>

        <Grid container spacing={4}>
          {portfolioProjects.map((project, index) => (
            <Grid key={project.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <MuiLink
                component={Link}
                to={`/designers/${slug}/portfolio/${project.slug}`}
                underline="none"
                color="inherit"
              >
                {project.coverImage && (
                  <ResponsiveImage
                    image={project.coverImage}
                    sizes={TILE_SIZES}
                    alt={project.title}
                    priority={index < 3}
                  />
                )}
                <Typography variant="h6" component="h2" sx={{ mt: 1.5 }}>
                  {project.title}
                </Typography>
              </MuiLink>
            </Grid>
          ))}
        </Grid>
      </Stack>
    </Container>
  );
};

export { DesignerPortfolio };
