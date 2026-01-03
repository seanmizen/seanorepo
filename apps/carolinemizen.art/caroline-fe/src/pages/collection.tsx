import { type FC, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { Nav } from '../components/nav';

const Container = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
`;

const Header = styled.header`
  margin-bottom: 3rem;
`;

const Breadcrumbs = styled.nav`
  margin-bottom: 1rem;
  font-size: 0.875rem;
`;

const BreadcrumbLink = styled(Link)`
  color: #3498db;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const BreadcrumbSeparator = styled.span`
  margin: 0 0.5rem;
  color: #999;
`;

const Title = styled.h1`
  font-size: 3rem;
  color: #2c3e50;
  margin: 0 0 1rem;
`;

const Description = styled.p`
  font-size: 1.125rem;
  color: #666;
  line-height: 1.6;
  max-width: 800px;
`;

const ArtworkGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 2rem;
`;

const ArtworkCard = styled(Link)`
  text-decoration: none;
  color: inherit;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
  }
`;

const ArtworkImage = styled.img`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: #f5f5f5;
`;

const ArtworkVideo = styled.video`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: #f5f5f5;
`;

const ArtworkInfo = styled.div`
  padding: 1.25rem;
`;

const ArtworkTitle = styled.h3`
  font-size: 1.125rem;
  color: #333;
  margin: 0 0 0.5rem;
`;

const ArtworkPrice = styled.p`
  font-size: 1rem;
  color: #3498db;
  margin: 0;
  font-weight: 600;
`;

const ArtworkStatus = styled.span<{ status: string }>`
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  margin-top: 0.5rem;
  background: ${(props) =>
    props.status === 'sold'
      ? '#e74c3c'
      : props.status === 'available'
        ? '#27ae60'
        : '#95a5a6'};
  color: white;
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
}

interface Artwork {
  id: number;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  status: string;
  primary_image_id: number | null;
  primary_image_path: string | null;
  primary_image_mime_type: string | null;
}

const formatPrice = (cents: number, currency: string): string => {
  const amount = cents / 100;
  const formatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  });
  return formatter.format(amount);
};

const Collection: FC = () => {
  const { id } = useParams<{ id: string }>();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGallery = useCallback(async () => {
    if (!id) return;

    try {
      const response = await fetch(`${API_URL}/galleries/${id}`);

      if (!response.ok) {
        throw new Error('Gallery not found');
      }

      const data = await response.json();
      setGallery(data.gallery);
      setArtworks(data.artworks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gallery');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  if (loading) {
    return (
      <>
        <Nav />
        <Container>
          <LoadingMessage>Loading collection...</LoadingMessage>
        </Container>
      </>
    );
  }

  if (error || !gallery) {
    return (
      <>
        <Nav />
        <Container>
          <ErrorMessage>{error || 'Gallery not found'}</ErrorMessage>
        </Container>
      </>
    );
  }

  return (
    <>
      <Nav />
      <Container>
        <Header>
          <Breadcrumbs>
            <BreadcrumbLink to="/collections">Collections</BreadcrumbLink>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            <span>{gallery.name}</span>
          </Breadcrumbs>
          <Title>Collection: {gallery.name}</Title>
          {gallery.description && (
            <Description>{gallery.description}</Description>
          )}
        </Header>

        {artworks.length === 0 ? (
          <EmptyMessage>No artworks in this collection yet</EmptyMessage>
        ) : (
          <ArtworkGrid>
            {artworks.map((artwork) => (
              <ArtworkCard
                key={artwork.id}
                to={`/collections/${id}/${artwork.id}`}
              >
                {artwork.primary_image_path ? (
                  artwork.primary_image_mime_type?.startsWith('video/') ? (
                    <ArtworkVideo
                      src={`${API_URL}/uploads/${artwork.primary_image_path}`}
                      loop
                      autoPlay
                      muted
                      playsInline
                    />
                  ) : (
                    <ArtworkImage
                      src={`${API_URL}/uploads/${artwork.primary_image_path}`}
                      alt={artwork.title}
                    />
                  )
                ) : (
                  <ArtworkImage as="div" />
                )}
                <ArtworkInfo>
                  <ArtworkTitle>{artwork.title}</ArtworkTitle>
                  <ArtworkPrice>
                    {formatPrice(artwork.price_cents, artwork.currency)}
                  </ArtworkPrice>
                  <ArtworkStatus status={artwork.status}>
                    {artwork.status}
                  </ArtworkStatus>
                </ArtworkInfo>
              </ArtworkCard>
            ))}
          </ArtworkGrid>
        )}
      </Container>
    </>
  );
};

export { Collection };
