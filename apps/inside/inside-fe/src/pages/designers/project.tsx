import {
  Alert,
  Button,
  Chip,
  Container,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ResponsiveImage } from '@/components';
import { useCrumbTitles } from '@/contexts/breadcrumb-context';
import {
  humanise,
  usePortfolioProject,
} from '@/features/discovery/use-designers';
import { describeFailure } from '@/lib/http';
import { useCanonicalPath } from '@/lib/use-canonical-path';

/** One column at any width — the images are the point, so they get the room. */
const VIEWER_SIZES = '(max-width: 1200px) 100vw, 1100px';

const PortfolioProjectPage: FC = () => {
  const { slug, projectSlug } = useParams() as {
    slug: string;
    projectSlug: string;
  };
  const query = usePortfolioProject(slug, projectSlug);

  // Names the whole trail this page knows about, not just its own crumb: the
  // studio's real name belongs on the studio's crumb, and this page has it.
  useCrumbTitles({
    [`/designers/${slug}`]: query.data?.profile.studioName,
    [`/designers/${slug}/portfolio/${projectSlug}`]: query.data?.project.title,
  });

  // Both halves of the path can have been renamed independently, so the
  // canonical URL is rebuilt from the response rather than patched.
  useCanonicalPath(
    query.data
      ? `/designers/${query.data.profile.slug}/portfolio/${query.data.project.slug}`
      : undefined,
  );

  if (query.isPending) {
    return (
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Stack spacing={3}>
          <Typography variant="h1" sx={{ fontSize: { xs: 36, md: 56 } }}>
            <Skeleton width={360} />
          </Typography>
          <Skeleton variant="rectangular" sx={{ aspectRatio: '3 / 2' }} />
        </Stack>
      </Container>
    );
  }

  if (query.isError || !query.data) {
    const failure = describeFailure(query.error, {
      title: 'Project not found',
      body: 'That project is not published.',
    });
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Stack spacing={3}>
          <Typography variant="h3" component="h1">
            {failure.title}
          </Typography>
          <Alert severity={failure.severity} data-testid="project-failure">
            {failure.body}
          </Alert>
          <Button
            component={Link}
            to={`/designers/${slug}`}
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
          >
            Back to the studio
          </Button>
        </Stack>
      </Container>
    );
  }

  const { profile, project } = query.data;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack spacing={4}>
        <Stack spacing={1.5}>
          <Typography variant="h1" sx={{ fontSize: { xs: 36, md: 56 } }}>
            {project.title}
          </Typography>
          <Typography color="text.secondary">
            <MuiLinkToStudio slug={slug} name={profile.studioName} />
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {project.workType && (
              <Chip variant="outlined" label={humanise(project.workType)} />
            )}
            {project.budgetBand && (
              <Chip variant="outlined" label={humanise(project.budgetBand)} />
            )}
            {project.location && (
              <Chip variant="outlined" label={project.location} />
            )}
            {project.completedYear && (
              <Chip variant="outlined" label={String(project.completedYear)} />
            )}
          </Stack>
        </Stack>

        {project.summary && (
          <Typography sx={{ maxWidth: 720, fontSize: 18 }}>
            {project.summary}
          </Typography>
        )}

        <Stack spacing={3} data-testid="project-images">
          {project.images.map((entry, index) => (
            <Stack key={entry.image.id} spacing={1}>
              <ResponsiveImage
                image={entry.image}
                sizes={VIEWER_SIZES}
                alt={entry.caption ?? project.title}
                priority={index === 0}
                ratio="3 / 2"
              />
              {entry.caption && (
                <Typography variant="caption" color="text.secondary">
                  {entry.caption}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>

        {project.description && (
          <>
            <Divider />
            <Typography sx={{ maxWidth: 720, lineHeight: 1.7 }}>
              {project.description}
            </Typography>
          </>
        )}
      </Stack>
    </Container>
  );
};

const MuiLinkToStudio: FC<{ slug: string; name: string }> = ({
  slug,
  name,
}) => (
  <Link to={`/designers/${slug}`} style={{ color: 'inherit' }}>
    {name}
  </Link>
);

export { PortfolioProjectPage };
