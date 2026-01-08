import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { GalleryPreview } from '@/components';
import { API_URL } from '@/config/api';
import type { Gallery } from '@/types';

const Container = styled.div`
  max-width: 1400px;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
`;

const Title = styled.h1`
  margin: 0;
  color: #333;
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 3rem;
  color: #666;
`;

const ErrorMessage = styled.div`
  background: #f8d7da;
  color: #721c24;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
`;

const Section = styled.section`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  margin-bottom: 2rem;
`;

const PreviewSection = styled.div`
  margin-bottom: 2rem;
`;

const PreviewTitle = styled.h3`
  margin: 0 0 1rem;
  color: #2c3e50;
  font-size: 1.1rem;
`;

const PreviewLabel = styled.div`
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 0.5rem;
  font-weight: 500;
`;

const PreviewWrapper = styled.div`
  margin-bottom: 1rem;
  pointer-events: none;
`;

const SectionTitle = styled.h2`
  margin: 0 0 0.5rem;
  color: #2c3e50;
  font-size: 1.25rem;
`;

const SectionDescription = styled.p`
  margin: 0 0 1.5rem;
  color: #666;
  font-size: 0.9rem;
`;

const GalleryDisplayGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
`;

const GalleryCard = styled.div<{ $selected: boolean }>`
  position: relative;
  background: #fafafa;
  border: 2px solid ${(p) => (p.$selected ? '#3498db' : '#e0e0e0')};
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
`;

const GalleryCardMedia = styled.div`
  width: 100%;
  aspect-ratio: 1;
  background: #f5f5f5;
  position: relative;
`;

const GalleryCardImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const GalleryCardVideo = styled.video`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const GalleryCardInfo = styled.div`
  padding: 0.75rem;
`;

const GalleryCardName = styled.div`
  font-size: 0.875rem;
  color: #333;
  font-weight: 600;
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

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
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

export const AdminFeaturedGalleries: FC = () => {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedGalleryIds, setSelectedGalleryIds] = useState<number[]>([]);
  const [savedGalleryIds, setSavedGalleryIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchGalleries = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/admin/galleries`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch galleries');
      }

      const data = await response.json();
      setGalleries(data.galleries);

      // Load current featured galleries from DB (saved state only, don't select)
      const featuredResponse = await fetch(
        `${API_URL}/galleries?featured=true`,
      );
      if (featuredResponse.ok) {
        const featuredData = await featuredResponse.json();
        const featuredIds = featuredData.galleries.map((g: Gallery) => g.id);
        setSavedGalleryIds(featuredIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load galleries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGalleries();
  }, [fetchGalleries]);

  const handleGalleryToggle = useCallback((galleryId: number) => {
    setSelectedGalleryIds((prev) => {
      if (prev.includes(galleryId)) {
        return prev.filter((id) => id !== galleryId);
      }
      if (prev.length >= 7) {
        alert('Maximum 7 galleries allowed for homepage');
        return prev;
      }
      return [...prev, galleryId];
    });
  }, []);

  const handleSaveFeatured = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/admin/galleries/featured`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gallery_ids: selectedGalleryIds }),
      });

      if (!response.ok) {
        throw new Error('Failed to save featured galleries');
      }

      setSavedGalleryIds(selectedGalleryIds);
      setSelectedGalleryIds([]);
      alert('Homepage galleries updated successfully');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [selectedGalleryIds]);

  const handleClearFeatured = useCallback(() => {
    setSelectedGalleryIds([]);
  }, []);

  const handleResetToSaved = useCallback(() => {
    setSelectedGalleryIds(savedGalleryIds);
  }, [savedGalleryIds]);

  const hasChanges = useMemo(() => {
    if (selectedGalleryIds.length !== savedGalleryIds.length) return true;
    return !selectedGalleryIds.every(
      (id, index) => id === savedGalleryIds[index],
    );
  }, [selectedGalleryIds, savedGalleryIds]);

  const selectedGalleries = useMemo(() => {
    return selectedGalleryIds
      .map((id) => galleries.find((g) => g.id === id))
      .filter((g): g is Gallery => g !== undefined);
  }, [selectedGalleryIds, galleries]);

  const savedGalleries = useMemo(() => {
    return savedGalleryIds
      .map((id) => galleries.find((g) => g.id === id))
      .filter((g): g is Gallery => g !== undefined);
  }, [savedGalleryIds, galleries]);

  if (loading) {
    return (
      <Container>
        <Header>
          <Title>Collections</Title>
        </Header>
        <LoadingMessage>Loading collections...</LoadingMessage>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Title>Homepage Featured Collections</Title>
      </Header>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <Section>
        <SectionTitle>Homepage Featured Collections</SectionTitle>
        <SectionDescription>
          Select up to 7 collections to display on the homepage. Click
          collections in the order you want them to appear. The first gallery
          will be displayed large, followed by 2 small collections in row 1, and
          4 small collections in row 2. (Mobiles will display responsively)
        </SectionDescription>

        <GalleryDisplayGrid>
          {galleries.map((gallery) => {
            const isSelected = selectedGalleryIds.includes(gallery.id);
            const selectionIndex = selectedGalleryIds.indexOf(gallery.id);
            const isSaved = savedGalleryIds.includes(gallery.id);
            const savedIndex = savedGalleryIds.indexOf(gallery.id);

            return (
              <GalleryCard
                key={gallery.id}
                $selected={isSelected}
                onClick={() => handleGalleryToggle(gallery.id)}
              >
                <GalleryCardMedia>
                  {gallery.cover_image_path ? (
                    gallery.cover_image_mime_type?.startsWith('video/') ? (
                      <GalleryCardVideo
                        src={`${API_URL}/uploads/${gallery.cover_image_path}`}
                        loop
                        autoPlay
                        muted
                        playsInline
                      />
                    ) : (
                      <GalleryCardImage
                        src={`${API_URL}/uploads/${gallery.cover_image_path}`}
                        alt={gallery.name}
                      />
                    )
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        background: '#f0f0f0',
                      }}
                    />
                  )}
                  {isSaved && <GhostBadge>{savedIndex + 1}</GhostBadge>}
                  {isSelected && (
                    <SelectionBadge>{selectionIndex + 1}</SelectionBadge>
                  )}
                </GalleryCardMedia>
                <GalleryCardInfo>
                  <GalleryCardName>{gallery.name}</GalleryCardName>
                </GalleryCardInfo>
              </GalleryCard>
            );
          })}
        </GalleryDisplayGrid>

        <ButtonGroup>
          <SaveButton
            type="button"
            onClick={handleSaveFeatured}
            disabled={saving || selectedGalleryIds.length === 0 || !hasChanges}
          >
            {saving ? 'Saving...' : 'Apply current selection'}
          </SaveButton>
          <ClearButton
            type="button"
            onClick={handleClearFeatured}
            disabled={selectedGalleryIds.length === 0}
          >
            Clear Selection
          </ClearButton>
          <ResetButton
            type="button"
            onClick={handleResetToSaved}
            disabled={!hasChanges}
          >
            Reset to current homepage selection
          </ResetButton>
        </ButtonGroup>
      </Section>

      <PreviewSection>
        <PreviewTitle>Homepage Preview</PreviewTitle>

        {selectedGalleries.length > 0 && (
          <PreviewWrapper>
            <PreviewLabel>
              Current Selection. If you press 'apply', this will become the new
              homepage.
              {/* {hasChanges
                ? 'New Selection (Unsaved)'
                : `Current Selection. If you press 'apply', this will become the new homepage.`} */}
            </PreviewLabel>
            <GalleryPreview galleries={selectedGalleries} featured />
          </PreviewWrapper>
        )}

        {savedGalleries.length > 0 && (
          <PreviewWrapper>
            <PreviewLabel>Current homepage - as we now see it</PreviewLabel>
            <GalleryPreview galleries={savedGalleries} featured isGhost />
          </PreviewWrapper>
        )}

        {selectedGalleries.length === 0 && savedGalleries.length === 0 && (
          <PreviewWrapper>
            <GalleryPreview galleries={[]} featured />
          </PreviewWrapper>
        )}
      </PreviewSection>
    </Container>
  );
};
