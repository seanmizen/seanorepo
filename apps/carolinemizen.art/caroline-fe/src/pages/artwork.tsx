import { type FC, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styled from 'styled-components';
import type { Artwork as ArtworkType } from '@/types';
import { Nav } from '../components/nav';

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
`;

const Breadcrumbs = styled.nav`
  margin-bottom: 2rem;
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

const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const GallerySection = styled.div``;

const MainImage = styled.img`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  background: #f5f5f5;
  margin-bottom: 1rem;
`;

const MainVideo = styled.video`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  background: #f5f5f5;
  margin-bottom: 1rem;
`;

const ThumbnailGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 0.5rem;
`;

const Thumbnail = styled.div<{ selected: boolean }>`
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid ${(props) => (props.selected ? '#3498db' : '#e0e0e0')};
  transition: border-color 0.2s;

  &:hover {
    border-color: #3498db;
  }
`;

const ThumbnailImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const ThumbnailVideo = styled.video`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const InfoSection = styled.div``;

const Title = styled.h1`
  font-size: 2.5rem;
  color: #2c3e50;
  margin: 0 0 1rem;
`;

const Price = styled.div`
  font-size: 2rem;
  color: #3498db;
  font-weight: 600;
  margin-bottom: 1rem;
`;

const Status = styled.div<{ $status: string }>`
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 16px;
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 2rem;
  background: ${(props) =>
    props.$status === 'sold'
      ? '#e74c3c'
      : props.$status === 'available'
        ? '#27ae60'
        : '#95a5a6'};
  color: white;
`;

const Description = styled.div`
  font-size: 1rem;
  color: #555;
  line-height: 1.7;
  margin-bottom: 2rem;
`;

const Section = styled.section`
  margin-top: 2rem;
`;

const SectionTitle = styled.h2`
  font-size: 1.25rem;
  color: #333;
  margin: 0 0 1rem;
`;

const ContactButton = styled.button`
  display: inline-block;
  padding: 1rem 2rem;
  background: #3498db;
  color: white;
  text-decoration: none;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: #2980b9;
  }
`;

const ContactCard = styled.div`
  margin-top: 1rem;
  padding: 1.5rem;
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  color: #333;
  line-height: 1.6;
  animation: slideIn 0.2s ease-out;

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const EmailLink = styled.a`
  color: #3498db;
  text-decoration: none;
  font-weight: 500;

  &:hover {
    text-decoration: underline;
  }
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

const API_URL = import.meta.env.API_URL;

const getImageUrl = (storagePath: string) =>
  `${API_URL}/uploads/${storagePath}`;

interface Image {
  id: number;
  filename: string;
  mime_type: string;
  storage_path: string;
}

const formatPrice = (cents: number, currency: string): string => {
  const amount = cents / 100;
  const formatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  });
  return formatter.format(amount);
};

const Artwork: FC = () => {
  const { id, artworkId } = useParams<{ id: string; artworkId: string }>();
  const [artwork, setArtwork] = useState<ArtworkType | null>(null);
  const [images, setImages] = useState<Image[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContactCard, setShowContactCard] = useState(false);

  const fetchArtwork = useCallback(async () => {
    if (!artworkId) return;

    try {
      const response = await fetch(`${API_URL}/artworks/${artworkId}`);

      if (!response.ok) {
        throw new Error('Artwork not found');
      }

      const data = await response.json();
      setArtwork(data.artwork);
      setImages(data.images);

      // Set primary image as selected if it exists
      if (data.artwork.primary_image_id && data.images.length > 0) {
        const primaryIndex = data.images.findIndex(
          (img: Image) => img.id === data.artwork.primary_image_id,
        );
        if (primaryIndex !== -1) {
          setSelectedImageIndex(primaryIndex);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artwork');
    } finally {
      setLoading(false);
    }
  }, [artworkId]);

  useEffect(() => {
    fetchArtwork();
  }, [fetchArtwork]);

  if (loading) {
    return (
      <>
        <Nav />
        <Container>
          <LoadingMessage>Loading artwork...</LoadingMessage>
        </Container>
      </>
    );
  }

  if (error || !artwork) {
    return (
      <>
        <Nav />
        <Container>
          <ErrorMessage>{error || 'Artwork not found'}</ErrorMessage>
        </Container>
      </>
    );
  }

  const selectedImage = images[selectedImageIndex];

  return (
    <>
      <Nav />
      <Container>
        <Breadcrumbs>
          <BreadcrumbLink to="/collections">Collections</BreadcrumbLink>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          <BreadcrumbLink to={`/collections/${id}`}>Collection</BreadcrumbLink>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          <span>{artwork.title}</span>
        </Breadcrumbs>

        <ContentGrid>
          <GallerySection>
            {selectedImage ? (
              selectedImage.mime_type.startsWith('video/') ? (
                <MainVideo
                  key={selectedImage.id}
                  src={getImageUrl(selectedImage.storage_path)}
                  controls
                  loop
                  muted
                  playsInline
                />
              ) : (
                <MainImage
                  src={getImageUrl(selectedImage.storage_path)}
                  alt={artwork.title}
                />
              )
            ) : (
              <MainImage as="div" />
            )}

            {images.length > 1 && (
              <ThumbnailGrid>
                {images.map((image, index) => (
                  <Thumbnail
                    key={image.id}
                    selected={index === selectedImageIndex}
                    onClick={() => setSelectedImageIndex(index)}
                  >
                    {image.mime_type.startsWith('video/') ? (
                      <ThumbnailVideo
                        src={getImageUrl(image.storage_path)}
                        muted
                        playsInline
                      />
                    ) : (
                      <ThumbnailImage
                        src={getImageUrl(image.storage_path)}
                        alt={`${artwork.title} - view ${index + 1}`}
                      />
                    )}
                  </Thumbnail>
                ))}
              </ThumbnailGrid>
            )}
          </GallerySection>

          <InfoSection>
            <Title>{artwork.title}</Title>

            {artwork.status !== 'sold' && (
              <Price>
                {formatPrice(artwork.price_cents, artwork.currency)}
              </Price>
            )}

            <Status $status={artwork.status}>
              {artwork.status === 'sold'
                ? 'sold - but commissions are available'
                : artwork.status}
            </Status>

            {artwork.description && (
              <Section>
                <SectionTitle>About this artwork</SectionTitle>
                <Description>{artwork.description}</Description>
              </Section>
            )}

            <Section>
              <SectionTitle>
                {artwork.status === 'sold'
                  ? 'Interested in a commission?'
                  : 'Interested in purchasing?'}
              </SectionTitle>
              <ContactButton
                onClick={() => setShowContactCard(!showContactCard)}
              >
                Contact Artist
              </ContactButton>
              {showContactCard && (
                <ContactCard>
                  {artwork.status === 'sold' ? (
                    <>
                      Email me at{' '}
                      <EmailLink href="mailto:caroline.mizen@gmail.com">
                        caroline.mizen@gmail.com
                      </EmailLink>{' '}
                      for commission enquiries
                    </>
                  ) : (
                    <>
                      Email me at{' '}
                      <EmailLink href="mailto:caroline.mizen@gmail.com">
                        caroline.mizen@gmail.com
                      </EmailLink>
                    </>
                  )}
                </ContactCard>
              )}
            </Section>
          </InfoSection>
        </ContentGrid>
      </Container>
    </>
  );
};

export { Artwork };
