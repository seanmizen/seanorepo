import { type FC, useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { type Gallery, GalleryGrid } from '@/components/gallery-grid';
import { Nav } from '@/components/nav';
import { pageWidth } from '@/components/page-width';

const Container = styled.div`
  ${pageWidth}
  padding-block: 2rem;
`;

/* Left-aligned, as on a collection and an artwork page. */
const Header = styled.header`
  margin-bottom: 3rem;
`;

const Title = styled.h1`
  font-size: 3rem;
  color: #2c3e50;
  margin: 0 0 1rem;
`;

const Subtitle = styled.p`
  font-size: 1.125rem;
  color: #666;
  line-height: 1.6;
  margin: 0;
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 4rem 2rem;
  color: #666;
  font-size: 1.25rem;
`;

const ErrorMessage = styled.div`
  text-align: center;
  padding: 2rem;
  background: #f8d7da;
  color: #721c24;
  border-radius: 8px;
  margin: 2rem 0;
`;

const EmptyMessage = styled.div`
  text-align: center;
  padding: 4rem 2rem;
  color: #999;
  font-size: 1.125rem;
`;

const Collections: FC = () => {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGalleries = useCallback(async () => {
    try {
      const response = await fetch(`${import.meta.env.API_URL}/galleries`);

      if (!response.ok) {
        throw new Error('Failed to fetch galleries');
      }

      const data = await response.json();
      setGalleries(data.galleries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load galleries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGalleries();
  }, [fetchGalleries]);

  return (
    <>
      <Nav />
      <Container>
        <Header>
          <Title>Collections</Title>
          <Subtitle>Explore curated galleries of original artwork</Subtitle>
        </Header>

        {loading && <LoadingMessage>Loading collections...</LoadingMessage>}

        {error && <ErrorMessage>{error}</ErrorMessage>}

        {!loading && !error && galleries.length === 0 && (
          <EmptyMessage>No collections available yet</EmptyMessage>
        )}

        {!loading && !error && galleries.length > 0 && (
          <GalleryGrid galleries={galleries} />
        )}
      </Container>
    </>
  );
};

export { Collections };
