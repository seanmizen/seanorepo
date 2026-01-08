import { type FC, useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Pagination } from '@/components';

const Container = styled.div`
  max-width: 1400px;
`;

const Header = styled.div`
  margin-bottom: 2rem;
`;

const Title = styled.h1`
  margin: 0 0 0.5rem;
  color: #333;
`;

const Subtitle = styled.p`
  margin: 0;
  color: #666;
  font-size: 1rem;
`;

const Section = styled.section`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 2rem;
`;

const SectionTitle = styled.h2`
  margin: 0 0 1rem;
  color: #2c3e50;
  font-size: 1.5rem;
`;

const HelpText = styled.p`
  margin: 0 0 1.5rem;
  font-size: 0.875rem;
  color: #666;
  line-height: 1.5;
`;

const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
`;

const ImageCard = styled.div<{ selected: boolean }>`
  position: relative;
  border: 3px solid ${(props) => (props.selected ? '#3498db' : '#e0e0e0')};
  border-radius: 8px;
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
  transition: all 0.2s;

  &:hover {
    border-color: ${(props) => (props.selected ? '#2980b9' : '#bdc3c7')};
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  }
`;

const ImagePreview = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const VideoPreview = styled.video`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const SelectedBadge = styled.div`
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: #3498db;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-start;
`;

const Button = styled.button<{ variant?: 'primary' | 'secondary' }>`
  padding: 0.75rem 2rem;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;

  ${(props) =>
    props.variant === 'secondary'
      ? `
    background: white;
    color: #3498db;
    border-color: #3498db;

    &:hover {
      background: #f8f9fa;
    }
  `
      : `
    background: #3498db;
    color: white;

    &:hover {
      background: #2980b9;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
  `}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LoadingMessage = styled.div`
  padding: 2rem;
  text-align: center;
  color: #999;
`;

const ErrorMessage = styled.div`
  background: #fee;
  color: #c33;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
`;

const SuccessMessage = styled.div`
  background: #efe;
  color: #3c3;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
`;

const API_URL = import.meta.env.API_URL;

const getImageUrl = (storagePath: string) =>
  `${API_URL}/uploads/${storagePath}`;

interface Image {
  id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  storage_path: string;
}

export const AdminContent: FC = () => {
  const [images, setImages] = useState<Image[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchImages = useCallback(async (pageNum: number) => {
    try {
      const response = await fetch(
        `${API_URL}/admin/images?page=${pageNum}&limit=10`,
        {
          credentials: 'include',
        },
      );

      if (response.ok) {
        const data = await response.json();
        setImages(data.images);
        setTotalPages(data.pagination.totalPages);
      }
    } catch (err) {
      console.error('Failed to load images:', err);
      setError('Failed to load images');
    }
  }, []);

  const fetchCarousel = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/carousel`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedImageIds(data.images.map((img: Image) => img.id));
      }
    } catch (err) {
      console.error('Failed to load carousel:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages(page);
  }, [fetchImages, page]);

  useEffect(() => {
    fetchCarousel();
  }, [fetchCarousel]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleImageToggle = (imageId: number) => {
    setSelectedImageIds((prev) => {
      if (prev.includes(imageId)) {
        return prev.filter((id) => id !== imageId);
      }
      return [...prev, imageId];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_URL}/admin/carousel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          image_ids: selectedImageIds,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save carousel');
      }

      setSuccess('Carousel updated successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save carousel');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingMessage>Loading...</LoadingMessage>;
  }

  return (
    <Container>
      <Header>
        <Title>Site Content</Title>
        <Subtitle>
          Manage your homepage carousel and other site content
        </Subtitle>
      </Header>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {success && <SuccessMessage>{success}</SuccessMessage>}

      <Section>
        <SectionTitle>Homepage Carousel</SectionTitle>
        <HelpText>
          Select images to display in the homepage carousel. Click images to add
          or remove them. Images will appear in the order you click them. If no
          images are selected, the carousel will fall back to showing artwork
          images.
        </HelpText>

        {images.length === 0 ? (
          <p style={{ color: '#999' }}>
            No images available. Upload images in the Images section first.
          </p>
        ) : (
          <>
            <ImageGrid>
              {images.map((image) => {
                const isSelected = selectedImageIds.includes(image.id);
                const orderIndex = selectedImageIds.indexOf(image.id);

                return (
                  <ImageCard
                    key={image.id}
                    selected={isSelected}
                    onClick={() => handleImageToggle(image.id)}
                  >
                    {image.mime_type.startsWith('video/') ? (
                      <VideoPreview
                        src={getImageUrl(image.storage_path)}
                        loop
                        autoPlay
                        muted
                        playsInline
                      />
                    ) : (
                      <ImagePreview
                        src={getImageUrl(image.storage_path)}
                        alt={image.original_name}
                      />
                    )}
                    {isSelected && (
                      <SelectedBadge>{orderIndex + 1}</SelectedBadge>
                    )}
                  </ImageCard>
                );
              })}
            </ImageGrid>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />

            <ButtonRow style={{ marginTop: '2rem' }}>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Carousel'}
              </Button>
              {selectedImageIds.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => setSelectedImageIds([])}
                  disabled={saving}
                >
                  Clear All
                </Button>
              )}
            </ButtonRow>
          </>
        )}
      </Section>
    </Container>
  );
};
