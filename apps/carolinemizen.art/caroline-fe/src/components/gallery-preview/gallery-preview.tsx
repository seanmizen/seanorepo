import type { FC } from 'react';
import styled from 'styled-components';
import { type Gallery, GalleryGrid } from '../gallery-grid';

interface GalleryPreviewProps {
  galleries: Gallery[];
  featured?: boolean;
  isGhost?: boolean;
}

const GalleriesSection = styled.section<{ $isGhost?: boolean }>`
  min-height: ${(p) => (p.$isGhost ? 'auto' : '80vh')};
  border: 1px solid
    ${(p) => (p.$isGhost ? '#ddd' : 'var(--border-color-secondary)')};
  border-radius: 8px;
  padding: ${(p) => (p.$isGhost ? '2rem 1rem' : '4rem 2rem')};
  background: ${(p) => (p.$isGhost ? '#f9f9f9' : 'white')};

  display: grid;
  place-items: center;
`;

const GalleriesInner = styled.div`
  width: 100%;
  max-width: 1200px;
  display: flex;
  align-items: stretch;
`;

export const GalleryPreview: FC<GalleryPreviewProps> = ({
  galleries,
  featured = false,
  isGhost = false,
}) => {
  return (
    <GalleriesSection $isGhost={isGhost}>
      <GalleriesInner>
        <GalleryGrid galleries={galleries} featured={featured} />
      </GalleriesInner>
    </GalleriesSection>
  );
};
