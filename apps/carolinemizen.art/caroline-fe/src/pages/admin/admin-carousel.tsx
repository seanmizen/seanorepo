import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
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

const SelectionBadge = styled.div`
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 2rem;
  height: 2rem;
  background: #3498db;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
`;

const GhostBadge = styled.div`
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  width: 2rem;
  height: 2rem;
  background: #95a5a6;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-start;
`;

const SaveButton = styled.button`
  padding: 0.75rem 2rem;
  background: #2ecc71;
  color: white;
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  position: relative;

  transition: box-shadow 120ms ease, transform 120ms ease,
    border-color 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }

  &:focus-visible::before,
  &:focus-visible::after {
    display: none;
  }

  &:focus-visible {
    border-color: var(--focus-flash);
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--focus-flash) 40%, transparent);
  }

  &:disabled {
    background: #95a5a6;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }
`;

const ClearButton = styled.button`
  padding: 0.75rem 2rem;
  background: #95a5a6;
  color: white;
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  position: relative;

  transition: box-shadow 120ms ease, transform 120ms ease,
    border-color 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }

  &:focus-visible::before,
  &:focus-visible::after {
    display: none;
  }

  &:focus-visible {
    border-color: var(--focus-flash);
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--focus-flash) 40%, transparent);
  }
`;

const ResetButton = styled.button`
  padding: 0.75rem 2rem;
  background: #3498db;
  color: white;
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  position: relative;

  transition: box-shadow 120ms ease, transform 120ms ease,
    border-color 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }

  &:focus-visible::before,
  &:focus-visible::after {
    display: none;
  }

  &:focus-visible {
    border-color: var(--focus-flash);
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--focus-flash) 40%, transparent);
  }

  &:disabled {
    background: #95a5a6;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
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

export const AdminCarousel: FC = () => {
  const [images, setImages] = useState<Image[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<number[]>([]);
  const [savedImageIds, setSavedImageIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchImages = useCallback(async (pageNum: number) => {
    try {
      const response = await fetch(
        `${API_URL}/admin/images?page=${pageNum}&limit=50`,
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
        // Load current carousel from DB (saved state only, don't select)
        const imageIds = data.images.map((img: Image) => img.id);
        setSavedImageIds(imageIds);
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

  const hasChanges = useMemo(() => {
    if (selectedImageIds.length !== savedImageIds.length) return true;
    return !selectedImageIds.every((id, index) => id === savedImageIds[index]);
  }, [selectedImageIds, savedImageIds]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleResetToSaved = useCallback(() => {
    setSelectedImageIds(savedImageIds);
  }, [savedImageIds]);

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

      setSavedImageIds(selectedImageIds);
      setSelectedImageIds([]);
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
        <Title>The Carousel</Title>
      </Header>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {success && <SuccessMessage>{success}</SuccessMessage>}

      <Section>
        <SectionTitle>Homepage Carousel</SectionTitle>
        <HelpText>
          Select images to display in the homepage carousel. Click images in the
          order you want them to appear. Grey badges show the current homepage
          carousel (saved), blue badges show your working selection. If no
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
                const selectionIndex = selectedImageIds.indexOf(image.id);
                const isSaved = savedImageIds.includes(image.id);
                const savedIndex = savedImageIds.indexOf(image.id);

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
                    {isSaved && <GhostBadge>{savedIndex + 1}</GhostBadge>}
                    {isSelected && (
                      <SelectionBadge>{selectionIndex + 1}</SelectionBadge>
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
              <SaveButton
                type="button"
                onClick={handleSave}
                disabled={
                  saving || selectedImageIds.length === 0 || !hasChanges
                }
              >
                {saving ? 'Saving...' : 'Apply current selection'}
              </SaveButton>
              <ClearButton
                type="button"
                onClick={() => setSelectedImageIds([])}
                disabled={selectedImageIds.length === 0}
              >
                Clear Selection
              </ClearButton>
              <ResetButton
                type="button"
                onClick={handleResetToSaved}
                disabled={!hasChanges}
              >
                Reset to current homepage carousel
              </ResetButton>
            </ButtonRow>
          </>
        )}
      </Section>
    </Container>
  );
};
