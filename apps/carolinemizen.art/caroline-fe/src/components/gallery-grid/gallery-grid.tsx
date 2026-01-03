import type { FC } from 'react';
import { Link } from 'react-router-dom';
import styled, { css } from 'styled-components';

const API_URL = import.meta.env.API_URL;

export interface Gallery {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_path?: string | null;
  cover_image_mime_type?: string | null;
  is_featured?: boolean;
}

interface PlaceholderGallery {
  id: number;
  name: string;
  slug: string;
  description: string;
  gradient: 'purple' | 'blue' | 'green';
}

interface GalleryGridProps {
  galleries: Gallery[] | PlaceholderGallery[];
  featured?: boolean;
  className?: string;
}

const Grid = styled.div<{ $featured: boolean }>`
  /* tighter content column = more dead space on wide screens */
  width: 100%;
  max-width: ${(p) => (p.$featured ? '1040px' : '980px')};
  margin: 0 auto;
  padding: 0 clamp(18px, 5vw, 72px);
  box-sizing: border-box;

  display: grid;
  gap: 1.25rem;

  ${(p) =>
    p.$featured
      ? css`
          grid-template-columns: repeat(12, 1fr);

          @media (max-width: 1100px) {
            grid-template-columns: repeat(2, 1fr);
          }

          @media (max-width: 720px) {
            grid-template-columns: 1fr;
            padding: 0 16px;
          }
        `
      : css`
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 2rem;

          /* tighter cards on smaller screens → enables 2-up */
          @media (max-width: 720px) {
            gap: 1rem;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            padding: 0 14px;
          }

          /* very small phones still need 1-up */
          @media (max-width: 380px) {
            grid-template-columns: 1fr;
          }
        `}
`;

const Card = styled(Link)<{ $featured: boolean; $isPlaceholder: boolean }>`
  --card-max-h: 25rem;
  /* --card-max-h: 70vh; */

  max-height: var(--card-max-h);
  height: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;

  text-decoration: none;
  color: inherit;
  border-radius: 16px;
  overflow: hidden;

  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);

  ${(p) =>
    !p.$isPlaceholder &&
    css`
      transition: transform 120ms ease;

      &:hover {
        transform: translateY(-2px);
      }

      &:active {
        transform: translateY(0);
      }
    `}

  ${(p) =>
    p.$featured &&
    css`
      grid-column: span 6;

      @media (max-width: 1100px) {
        grid-column: auto;
      }
    `}

  ${(p) =>
    !p.$featured &&
    css`
      grid-column: span 3;

      @media (max-width: 1100px) {
        grid-column: auto;
      }
    `}
`;

const CardMedia = css`
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: cover;
  background: #f5f5f5;
  display: block;
`;

const CoverImage = styled.img`
  ${CardMedia}
`;

const CoverVideo = styled.video`
  ${CardMedia}
`;

const GradientPlaceholder = styled.div<{
  $variant: 'purple' | 'blue' | 'green';
}>`
  ${CardMedia}
  background: ${(p) => {
    const gradients = {
      purple:
        'linear-gradient(135deg, var(--accent-purple) 0%, color-mix(in srgb, var(--accent-purple) 60%, var(--accent-blue)) 100%)',
      blue: 'linear-gradient(135deg, var(--accent-blue) 0%, color-mix(in srgb, var(--accent-blue) 60%, var(--accent-green)) 100%)',
      green:
        'linear-gradient(135deg, var(--accent-green) 0%, color-mix(in srgb, var(--accent-green) 60%, var(--accent-purple)) 100%)',
    };
    return gradients[p.$variant];
  }};
`;

const Info = styled.div`
  padding: 1.05rem 1.2rem 1.2rem;
  display: grid;
  gap: 0.45rem;
`;

const Name = styled.h2`
  font-size: 1.5rem;
  color: var(--text-color);
  margin: 0;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
`;

const Description = styled.p`
  color: var(--text-color-secondary);
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
`;

export const GalleryGrid: FC<GalleryGridProps> = ({
  galleries,
  featured = false,
  className,
}) => {
  return (
    <Grid $featured={featured} className={className}>
      {galleries.map((gallery, idx) => {
        const isFeatured = featured && idx === 0;
        const isPlaceholder = gallery.id < 0;
        const gradient = 'gradient' in gallery ? gallery.gradient : null;

        return (
          <Card
            key={gallery.id}
            to={isPlaceholder ? '#' : `/collections/${gallery.slug}`}
            onClick={isPlaceholder ? (e) => e.preventDefault() : undefined}
            style={
              isPlaceholder ? { cursor: 'default', opacity: 0.7 } : undefined
            }
            $featured={isFeatured}
            $isPlaceholder={isPlaceholder}
          >
            {!isPlaceholder &&
            'cover_image_path' in gallery &&
            gallery.cover_image_path ? (
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
                  loading="lazy"
                  decoding="async"
                />
              )
            ) : gradient ? (
              <GradientPlaceholder $variant={gradient} />
            ) : (
              <GradientPlaceholder $variant="purple" />
            )}

            <Info>
              <Name>{gallery.name}</Name>
              {gallery.description && (
                <Description>{gallery.description}</Description>
              )}
            </Info>
          </Card>
        );
      })}
    </Grid>
  );
};
