import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import styled, { css } from 'styled-components';
import { FullScreenComponent, Nav } from '../../components';
import type { Artwork } from '../../types';

const API_URL = import.meta.env.API_URL;

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

const CarouselImage = styled.img`
  height: 100%;
  width: min(40vw, 900px);
  object-fit: cover;
  flex: 0 0 auto;
  filter: grayscale(0.2) contrast(1.05);
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

const GalleryGrid = styled.div`
  display: grid;
  gap: 1.25rem;

  grid-template-columns: repeat(12, 1fr);

  @media (max-width: 1100px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const GalleryCard = styled(Link)`
  text-decoration: none;
  color: inherit;
  border-radius: 16px;
  overflow: hidden;

  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);

  transform: translate3d(0, 0, 0);
  transition: transform 50ms ease, box-shadow 50ms ease, filter 50ms ease;

  &:hover {
    transform: translate3d(0, -2px, 0);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12);
  }

  &:active {
    transform: translate3d(0, 0px, 0);
  }
`;

const FeaturedCard = styled(GalleryCard)`
  grid-column: span 6;

  @media (max-width: 1100px) {
    grid-column: auto;
  }
`;

const StandardCard = styled(GalleryCard)`
  grid-column: span 3;

  @media (max-width: 1100px) {
    grid-column: auto;
  }
`;

const CardMedia = css`
  width: 100%;
  aspect-ratio: 4 / 3;
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

const GalleryInfo = styled.div`
  padding: 1.1rem 1.2rem 1.25rem;
`;

const GalleryName = styled.h2`
  font-size: 1.25rem;
  color: #222;
  margin: 0 0 0.4rem;
  line-height: 1.2;
`;

const GalleryDescription = styled.p`
  color: #555;
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
`;

interface Gallery {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_path: string | null;
  cover_image_mime_type: string | null;
}

const pickForCarousel = (items: Artwork[], count: number) => {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
};

const Home: FC = () => {
  const [showArrow, setShowArrow] = useState(false);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(90);

  const fetchGalleries = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/galleries`);
      if (!response.ok) return;
      const data = await response.json();
      setGalleries(data.galleries.slice(0, 3));
    } catch (err) {
      console.error('Failed to load galleries:', err);
    }
  }, []);

  const fetchArtworks = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/artworks`);
      if (!response.ok) return;

      const data = await response.json();
      const nonDraftArtworks = data.artworks.filter(
        (artwork: Artwork) =>
          artwork.status !== 'draft' && artwork.primary_image_path,
      );
      setArtworks(nonDraftArtworks);
    } catch (err) {
      console.error('Failed to load artworks:', err);
    }
  }, []);

  const baseArtworks = useMemo(() => {
    if (artworks.length === 0) return [];
    return pickForCarousel(artworks, 12);
  }, [artworks]);

  const carouselArtworks = useMemo(() => {
    if (baseArtworks.length === 0) return [];
    return [...baseArtworks, ...baseArtworks];
  }, [baseArtworks]);

  const readyTarget = useMemo(
    () => Math.min(3, baseArtworks.length),
    [baseArtworks.length],
  );

  useEffect(() => {
    fetchGalleries();
    fetchArtworks();

    const arrowTimer = window.setTimeout(() => setShowArrow(true), 2500);
    return () => window.clearTimeout(arrowTimer);
  }, [fetchGalleries, fetchArtworks]);

  useEffect(() => {
    if (readyTarget > 0 && resolvedCount >= readyTarget) setReady(true);
  }, [resolvedCount, readyTarget]);

  useEffect(() => {
    if (baseArtworks.length === 0) return;
    const id = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(id);
  }, [baseArtworks.length]);

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
              {carouselArtworks.map((artwork, index) => {
                const eager = index < 2;
                const isFirstHalf = index < baseArtworks.length;

                const onResolved = () => {
                  if (isFirstHalf) setResolvedCount((c) => c + 1);
                };

                return (
                  <CarouselImage
                    key={`${artwork.id}-${index}`}
                    src={`${API_URL}/uploads/${artwork.primary_image_path}`}
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
            <h1>Art by Caroline</h1>
          </HeaderTextContainer>

          <Arrow type="button" onClick={scrollDown} $isVisible={showArrow}>
            ↓ more below ↓
          </Arrow>
        </FullScreenComponent>
      </HeroWrapper>

      <GalleriesSection>
        <GalleriesInner>
          <GalleryGrid>
            {galleries.map((gallery, idx) => {
              const Card = idx === 0 ? FeaturedCard : StandardCard;

              return (
                <Card key={gallery.id} to={`/collections/${gallery.slug}`}>
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
                        loading="lazy"
                        decoding="async"
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
                </Card>
              );
            })}
          </GalleryGrid>
        </GalleriesInner>
      </GalleriesSection>

      <Nav />
    </>
  );
};

export { Home };
