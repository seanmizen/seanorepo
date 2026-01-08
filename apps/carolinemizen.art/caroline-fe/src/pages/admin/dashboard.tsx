import { type FC, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useAppConfig } from '@/hooks/use-app-config';

const Container = styled.div`
  max-width: 1200px;
`;

const Title = styled.h1`
  margin: 0 0 2rem;
  color: #333;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
`;

const Card = styled(Link)`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  text-decoration: none;
  color: inherit;
  transition: all 0.2s;
  border: 2px solid transparent;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    border-color: #3498db;
    transform: translateY(-2px);
  }
`;

const CardTitle = styled.h2`
  margin: 0 0 0.5rem;
  color: #2c3e50;
  font-size: 1.25rem;
`;

const CardDescription = styled.p`
  margin: 0;
  color: #7f8c8d;
  font-size: 0.95rem;
  line-height: 1.5;
`;

const CardCount = styled.div`
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  background: #ecf0f1;
  border-radius: 4px;
  font-size: 1.5rem;
  font-weight: 700;
  color: #2c3e50;
  text-align: center;
`;

const Section = styled.section`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const SectionTitle = styled.h2`
  margin: 0 0 1.5rem;
  color: #2c3e50;
  font-size: 1.5rem;
`;

const WelcomeText = styled.p`
  color: #7f8c8d;
  line-height: 1.6;
  margin: 0;
`;

const DangerZone = styled.section`
  background: #fff5f5;
  border: 2px solid #e74c3c;
  padding: 2rem;
  border-radius: 8px;
  margin-top: 3rem;
`;

const DangerTitle = styled.h2`
  margin: 0 0 1rem;
  color: #c0392b;
  font-size: 1.5rem;
`;

const DangerText = styled.p`
  color: #721c24;
  line-height: 1.6;
  margin: 0 0 1.5rem;
`;

const DangerButton = styled.button`
  padding: 0.75rem 2rem;
  background: #e74c3c;
  color: white;
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;

  transition: box-shadow 120ms ease, transform 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }
`;

const API_URL = import.meta.env.API_URL;

interface Counts {
  artworks: number;
  galleries: number;
  images: number;
}

export const AdminDashboard: FC = () => {
  const { config, loading } = useAppConfig();
  const [counts, setCounts] = useState<Counts>({
    artworks: 0,
    galleries: 0,
    images: 0,
  });
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [nuking, setNuking] = useState(false);

  const fetchCounts = useCallback(async () => {
    try {
      const [artworksRes, galleriesRes, imagesRes] = await Promise.all([
        fetch(`${API_URL}/admin/artworks/count`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/galleries/count`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/images/count`, { credentials: 'include' }),
      ]);

      const [artworksData, galleriesData, imagesData] = await Promise.all([
        artworksRes.json(),
        galleriesRes.json(),
        imagesRes.json(),
      ]);

      setCounts({
        artworks: artworksData.count,
        galleries: galleriesData.count,
        images: imagesData.count,
      });
    } catch (error) {
      console.error('Failed to fetch counts:', error);
    } finally {
      setLoadingCounts(false);
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const handleNukeSite = useCallback(async () => {
    const confirmed = window.confirm(
      'WARNING: This will reset the entire database to defaults and create a backup.\n\n' +
        'All galleries, artworks, and images will be deleted!\n\n' +
        'Are you ABSOLUTELY sure you want to continue?',
    );

    if (!confirmed) return;

    const doubleCheck = window.prompt('Type "NUKE" (all caps) to confirm:');

    if (doubleCheck !== 'NUKE') {
      alert('Cancelled.');
      return;
    }

    setNuking(true);
    try {
      const response = await fetch(`${API_URL}/admin/nuke`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to reset database');
      }

      const data = await response.json();
      alert(
        `Database reset successful!\n\nBackup saved to: ${data.backup_path}`,
      );

      // Refresh counts
      await fetchCounts();
    } catch (error) {
      alert(
        error instanceof Error ? error.message : 'Failed to reset database',
      );
    } finally {
      setNuking(false);
    }
  }, [fetchCounts]);

  if (loading || !config) {
    return (
      <Container>
        <Title>Dashboard</Title>
        <Section>Loading...</Section>
      </Container>
    );
  }

  const { dashboard } = config;

  return (
    <Container>
      <Title>Dashboard</Title>
      <Section>
        <SectionTitle>{dashboard.welcome.title}</SectionTitle>
        <WelcomeText>{dashboard.welcome.text}</WelcomeText>
      </Section>
      <Grid style={{ marginTop: '2rem' }}>
        <Card to="/admin/artworks">
          <CardTitle>{dashboard.cards.artworks.title}</CardTitle>
          <CardDescription>
            {dashboard.cards.artworks.description}
          </CardDescription>
          <CardCount>{loadingCounts ? '...' : counts.artworks}</CardCount>
        </Card>

        <Card to="/admin/galleries">
          <CardTitle>{dashboard.cards.galleries.title}</CardTitle>
          <CardDescription>
            {dashboard.cards.galleries.description}
          </CardDescription>
          <CardCount>{loadingCounts ? '...' : counts.galleries}</CardCount>
        </Card>

        <Card to="/admin/images">
          <CardTitle>{dashboard.cards.images.title}</CardTitle>
          <CardDescription>
            {dashboard.cards.images.description}
          </CardDescription>
          <CardCount>{loadingCounts ? '...' : counts.images}</CardCount>
        </Card>

        <Card to="/admin/content">
          <CardTitle>{dashboard.cards.content.title}</CardTitle>
          <CardDescription>
            {dashboard.cards.content.description}
          </CardDescription>
        </Card>
      </Grid>

      <DangerZone>
        <DangerTitle>Danger Zone</DangerTitle>
        <DangerText>
          Reset the entire database to defaults. This will delete all galleries,
          artworks, and images. A timestamped backup will be created before
          resetting.
        </DangerText>
        <DangerButton onClick={handleNukeSite} disabled={nuking}>
          {nuking ? 'Resetting Database...' : 'Nuke Site'}
        </DangerButton>
      </DangerZone>
    </Container>
  );
};
