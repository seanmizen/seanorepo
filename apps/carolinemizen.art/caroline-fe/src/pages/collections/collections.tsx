import { type FC, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Nav } from '../../components/nav';

const Container = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
`;

const Header = styled.header`
  text-align: center;
  margin-bottom: 4rem;
`;

const Title = styled.h1`
  font-size: 3rem;
  color: #2c3e50;
  margin: 0 0 1rem;
`;

const Subtitle = styled.p`
  font-size: 1.25rem;
  color: #666;
  margin: 0;
`;

const GalleryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 2rem;
  margin-top: 3rem;
`;

const GalleryCard = styled(Link)`
  text-decoration: none;
  color: inherit;
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
  }
`;

const CoverImage = styled.img`
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: #f5f5f5;
`;

const CoverVideo = styled.video`
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: #f5f5f5;
`;

const GalleryInfo = styled.div`
  padding: 1.5rem;
`;

const GalleryName = styled.h2`
  font-size: 1.5rem;
  color: #333;
  margin: 0 0 0.5rem;
`;

const GalleryDescription = styled.p`
  color: #666;
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
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

const API_URL = import.meta.env.API_URL;

interface Gallery {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_path: string | null;
  cover_image_mime_type: string | null;
  is_featured: boolean;
}

const Collections: FC = () => {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGalleries = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/galleries`);

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
          <GalleryGrid>
            {galleries.map((gallery) => (
              <GalleryCard key={gallery.id} to={`/collections/${gallery.slug}`}>
                {gallery.cover_image_path ? (
                  gallery.cover_image_mime_type?.startsWith('video/') ? (
                    <CoverVideo
                      src={`${API_URL}/uploads/${gallery.cover_image_path}`}
                      loop
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : (
                    <CoverImage
                      src={`${API_URL}/uploads/${gallery.cover_image_path}`}
                      alt={gallery.name}
                    />
                  )
                ) : (
                  <CoverImage as="div" />
                )}
                <GalleryInfo>
                  <GalleryName>{gallery.name}</GalleryName>
                  {gallery.description && (
                    <GalleryDescription>
                      {gallery.description}
                    </GalleryDescription>
                  )}
                </GalleryInfo>
              </GalleryCard>
            ))}
          </GalleryGrid>
        )}
      </Container>
    </>
  );
};

export { Collections };
