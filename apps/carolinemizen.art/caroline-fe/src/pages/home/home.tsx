import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import styled, { css } from 'styled-components';
import { FullScreenComponent, Nav } from '@/components';
import { GalleryGrid } from '@/components/gallery-grid';
import { useArtworkCache } from '@/contexts/artwork-cache-context';
import type { Artwork } from '@/types';

const API_URL = import.meta.env.API_URL;

const groupHalo = css`
  position: relative;
  isolation: isolate;

  &::before {
    content: "";
    position: absolute;
    inset: -18px -28px;
    z-index: -1;
    pointer-events: none;

    background: radial-gradient(
      ellipse 140% 130% at 50% 50%,
      rgba(255, 255, 255, 0.5) 0%,
      rgba(255, 255, 255, 0.9) 45%,
      transparent 75%
    );

    filter: blur(22px);
  }
`;

const readableText = css`
  position: relative;
  z-index: 0;

  &::before {
    content: "";
    position: absolute;
    inset: -28px -120px; /* wider left/right */
    z-index: -1;
    pointer-events: none;

    background: radial-gradient(
      ellipse 160% 120% at 50% 55%,
      rgba(255, 255, 255, 0.55) 0%,
      rgba(255, 255, 255, 0.28) 38%,
      rgba(255, 255, 255, 0.12) 60%,
      transparent 78%
    );

    filter: blur(28px);
  }
`;

const TextPanel = styled.div`
  /* outline: 2px solid red; */
  ${groupHalo}
`;

export const insetScrim = css`
  position: relative;
  border-radius: 18px;
  overflow: hidden;

  background: color-mix(in srgb, white 50%, transparent);
  backdrop-filter: blur(10px) saturate(0.9);
  -webkit-backdrop-filter: blur(10px) saturate(0.9);

  border: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  box-shadow: var(--glass-shadow);

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      120% 120% at 50% 20%,
      color-mix(in srgb, white 55%, transparent) 0%,
      transparent 60%
    );
  }

  > * {
    position: relative;
    z-index: 1;
  }
`;

export const frostedDesat = css`
  background: color-mix(in srgb, white 62%, transparent);
  backdrop-filter: blur(12px) saturate(0.85) contrast(1.05);
  -webkit-backdrop-filter: blur(12px) saturate(0.85) contrast(1.05);

  border: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  box-shadow: var(--glass-shadow);
  border-radius: 18px;
`;

export const milkGlass = css`
  background: color-mix(in srgb, white 72%, transparent);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);

  border: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  box-shadow: var(--glass-shadow);
  border-radius: 18px;
`;

const glassmorphismStyle = css`
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(5px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
`;

const Arrow = styled.button<{ $isVisible: boolean }>`
  ${glassmorphismStyle}
  border: none;
  background: rgba(255, 255, 255, 0.18);
  position: absolute;
  bottom: 40px;
  right: 22vw;
  padding: 0.75rem 1.1rem;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0.02em;
  overflow: hidden;

  transition: transform 220ms ease, opacity 220ms ease, background 120ms ease;
  transform: ${(p) => (p.$isVisible ? 'translateY(0)' : 'translateY(80px)')};
  opacity: ${(p) => (p.$isVisible ? 1 : 0)};

  &:hover {
    background: rgba(255, 255, 255, 0.26);
  }

  &:active {
    transform: ${(p) =>
      p.$isVisible ? 'translateY(2px)' : 'translateY(80px)'};
  }

  &:focus-visible {
    position: absolute;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: opacity 200ms ease;
    transform: none;
  }
`;

const HeaderTextContainer = styled.div`
  ${glassmorphismStyle}
  padding: 1rem 2rem;
  width: 100%;
  display: flex;
  justify-content: center;
  overflow: hidden;
`;

const HeroWrapper = styled.div`
  position: relative;
  overflow: hidden;
  height: 100vh;
  width: 100vw;
`;

const BackgroundCarousel = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.35;
  overflow: hidden;
  pointer-events: none;

  -webkit-mask-image: linear-gradient(
    to right,
    transparent,
    black 10%,
    black 90%,
    transparent
  );
  mask-image: linear-gradient(
    to right,
    transparent,
    black 10%,
    black 90%,
    transparent
  );

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.25),
      rgba(0, 0, 0, 0.05) 40%,
      rgba(0, 0, 0, 0.25)
    );
  }
`;

const CarouselTrack = styled.div<{ $duration: number; $ready: boolean }>`
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  gap: 0;
  will-change: transform;
  transform: translate3d(0, 0, 0);

  animation: scroll ${(p) => p.$duration}s linear infinite;
  animation-play-state: ${(p) => (p.$ready ? 'running' : 'paused')};

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transform: none;
  }

  @keyframes scroll {
    to {
      transform: translate3d(-50%, 0, 0);
    }
  }
`;

const CarouselMedia = css`
  height: 100%;
  width: min(40vw, 900px);
  object-fit: cover;
  flex: 0 0 auto;
  filter: grayscale(0.2) contrast(1.05);
`;

const CarouselImage = styled.img`
  ${CarouselMedia}
`;

const CarouselVideo = styled.video`
  ${CarouselMedia}
`;

const CarouselGradient = styled.div<{ $variant: 'purple' | 'blue' | 'green' }>`
  height: 100%;
  width: min(40vw, 900px);
  flex: 0 0 auto;
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

const HeroContent = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
`;

const GalleriesSection = styled.section`
  min-height: 80vh;
  border-top: 1px solid var(--border-color-secondary);
  border-bottom: 1px solid var(--border-color-secondary);
  padding: 4rem 2rem;

  display: grid;
  place-items: center;
`;

const GalleriesInner = styled.div`
  width: 100%;
  max-width: 1200px;
`;

const pickForCarousel = (items: Artwork[], count: number) => {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
};

const placeholderGalleries = [
  {
    id: -1,
    name: 'There are no collections yet.',
    slug: '',
    description: 'But they will be here, once we add them.',
    gradient: 'purple' as const,
  },
  {
    id: -2,
    name: 'Stay Tuned.',
    slug: '',
    description: 'More will be on the way.',
    gradient: 'blue' as const,
  },
  {
    id: -3,
    name: 'Check Back Soon!',
    slug: '',
    description: '',
    gradient: 'green' as const,
  },
];

const placeholderCarouselItems = [
  { id: -1, gradient: 'purple' as const },
  { id: -2, gradient: 'blue' as const },
  { id: -3, gradient: 'green' as const },
  { id: -4, gradient: 'purple' as const },
  { id: -5, gradient: 'blue' as const },
  { id: -6, gradient: 'green' as const },
];

const Home: FC = () => {
  const [showArrow, setShowArrow] = useState(false);
  const { artworks, galleries } = useArtworkCache();

  const displayGalleries =
    galleries.length > 0 ? galleries : placeholderGalleries;

  const trackRef = useRef<HTMLDivElement>(null);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(90);

  const baseArtworks = useMemo(() => {
    if (artworks.length === 0) return [];
    if (artworks.length === 1) {
      // Pad single artwork with gradients
      return [artworks[0], ...placeholderCarouselItems.slice(0, 5)];
    }
    return pickForCarousel(artworks, 12);
  }, [artworks, placeholderCarouselItems]);

  const carouselArtworks = useMemo(() => {
    if (artworks.length === 0) {
      // Show only gradients when no artworks
      return [...placeholderCarouselItems, ...placeholderCarouselItems];
    }
    if (baseArtworks.length === 0) return [];
    return [...baseArtworks, ...baseArtworks];
  }, [baseArtworks, artworks.length, placeholderCarouselItems]);

  const readyTarget = useMemo(
    () => Math.min(3, baseArtworks.length),
    [baseArtworks.length],
  );

  useEffect(() => {
    const arrowTimer = window.setTimeout(() => setShowArrow(true), 2500);
    return () => window.clearTimeout(arrowTimer);
  }, []);

  useEffect(() => {
    if (readyTarget > 0 && resolvedCount >= readyTarget) setReady(true);
  }, [resolvedCount, readyTarget]);

  useEffect(() => {
    // If we have no artworks (only gradients) or very few, start immediately
    if (artworks.length === 0) {
      setReady(true);
      return;
    }
    if (baseArtworks.length === 0) return;
    const id = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(id);
  }, [baseArtworks.length, artworks.length]);

  useEffect(() => {
    if (!ready || !trackRef.current) return;

    const pxPerSec = 35;

    const recalc = () => {
      const el = trackRef.current;
      if (!el) return;

      const halfWidth = el.scrollWidth / 2;
      if (!Number.isFinite(halfWidth) || halfWidth < 50) return;

      setDuration(Math.max(40, halfWidth / pxPerSec));
    };

    recalc();
    const ro = new ResizeObserver(() => requestAnimationFrame(recalc));
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [ready]);

  const scrollDown = useCallback(() => {
    window.scrollTo({ top: window.innerHeight - 10, behavior: 'smooth' });
  }, []);

  return (
    <>
      <HeroWrapper>
        <BackgroundCarousel>
          {carouselArtworks.length > 0 && (
            <CarouselTrack ref={trackRef} $duration={duration} $ready={ready}>
              {carouselArtworks.map((item, index) => {
                const eager = index < 2;
                const isFirstHalf = index < baseArtworks.length;
                const isGradient = 'gradient' in item;

                const onResolved = () => {
                  if (isFirstHalf) setResolvedCount((c) => c + 1);
                };

                if (isGradient) {
                  return (
                    <CarouselGradient
                      key={`gradient-${item.id}-${index}`}
                      $variant={item.gradient}
                    />
                  );
                }

                const isVideo =
                  item.primary_image_mime_type?.startsWith('video/');

                if (isVideo) {
                  return (
                    <CarouselVideo
                      key={`${item.id}-${index}`}
                      src={`${API_URL}/uploads/${item.primary_image_path}`}
                      loop
                      autoPlay
                      muted
                      playsInline
                      onLoadedData={onResolved}
                      onError={onResolved}
                    />
                  );
                }

                return (
                  <CarouselImage
                    key={`${item.id}-${index}`}
                    src={`${API_URL}/uploads/${item.primary_image_path}`}
                    alt=""
                    aria-hidden="true"
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    onLoad={onResolved}
                    onError={onResolved}
                  />
                );
              })}
            </CarouselTrack>
          )}
        </BackgroundCarousel>

        <FullScreenComponent as={HeroContent}>
          <HeaderTextContainer>
            <TextPanel>
              <h1>Art by Caroline</h1>
            </TextPanel>
          </HeaderTextContainer>

          <Arrow type="button" onClick={scrollDown} $isVisible={showArrow}>
            <TextPanel>↓ more below ↓</TextPanel>
          </Arrow>
        </FullScreenComponent>
      </HeroWrapper>

      <GalleriesSection>
        <GalleriesInner>
          <GalleryGrid galleries={displayGalleries} featured />
        </GalleriesInner>
      </GalleriesSection>

      <Nav />
    </>
  );
};

export { Home };
