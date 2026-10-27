import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import styled, { css } from 'styled-components';
import {
  FullScreenComponent,
  GalleryPreview,
  joinedMedia,
  Media,
  Nav,
} from '@/components';
import type { Gallery } from '@/components/gallery-grid';
import { useArtworkCache } from '@/contexts/artwork-cache-context';
import type { Artwork, ImageMedia } from '@/types';

const API_URL = import.meta.env.API_URL;

interface CarouselImageResponse extends ImageMedia {
  id: number;
  original_name: string;
}

// The request starts when the bundle loads, before React mounts. The browser
// gives it the response of the preload in public/index.html. A body can be
// read one time only, so every mount shares the parsed result. It is null
// when the request fails.
const carouselRequest: Promise<CarouselImageResponse[] | null> = fetch(
  `${API_URL}/carousel`,
)
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => (data ? (data.images as CarouselImageResponse[]) : null))
  .catch((error) => {
    console.error('Failed to fetch carousel:', error);
    return null;
  });

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
  /* Off to the right of the middle, on purpose. */
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
  /* The padding stays inside the screen width. */
  box-sizing: border-box;
  /* A heading that wraps on a narrow screen stays centred. */
  text-align: center;
  display: flex;
  justify-content: center;
  overflow: hidden;
`;

const HeroWrapper = styled.div`
  position: relative;
  overflow: hidden;
  height: 100vh;
  /* Not 100vw: that includes the vertical scrollbar, and the page then
     scrolls sideways on a system with a scrollbar that takes space. */
  width: 100%;
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

const CarouselImage = styled(Media)`
  ${CarouselMedia}
`;

/**
 * Each slide is min(40vw, 900px) wide and as tall as the screen, and the
 * media covers it. A wide picture must be wider than the slide to fill the
 * height.
 */
const carouselSizes = (media: ImageMedia) => {
  const slide = 'min(40vw, 900px)';
  if (!media.width || !media.height) return slide;
  return `max(${slide}, ${(media.width / media.height).toFixed(3)} * 100vh)`;
};

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
  const { artworks } = useArtworkCache();
  // null until the carousel request completes
  const [carouselImages, setCarouselImages] = useState<Artwork[] | null>(null);
  const [featuredGalleries, setFeaturedGalleries] = useState<Gallery[]>([]);

  const displayGalleries =
    featuredGalleries.length > 0 ? featuredGalleries : placeholderGalleries;

  const trackRef = useRef<HTMLDivElement>(null);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(90);

  // Read the carousel images and fetch the featured galleries on mount
  useEffect(() => {
    // StrictMode runs this effect two times in dev. Only the last run may
    // set the carousel, or the slides change after the first render.
    let cancelled = false;

    const fetchCarousel = async () => {
      const images = await carouselRequest;
      if (cancelled) return;
      if (!images) {
        setCarouselImages([]);
        return;
      }
      // Transform carousel images to artwork-like objects for compatibility
      const carouselArtworks: Artwork[] = images.map((img) => ({
        id: img.id,
        title: img.original_name,
        description: null,
        price_cents: 0,
        currency: 'USD',
        status: 'available' as const,
        primary_image_id: null,
        primary_image_path: img.storage_path,
        primary_image_mime_type: img.mime_type,
        primary_image_width: img.width,
        primary_image_height: img.height,
        primary_image_thumbhash: img.thumbhash,
        primary_image_variants: img.variants,
        primary_image_poster_path: img.poster_path,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      setCarouselImages(carouselArtworks);
    };

    const fetchFeaturedGalleries = async () => {
      try {
        const response = await fetch(`${API_URL}/galleries?featured=true`);
        if (response.ok) {
          const data = await response.json();
          setFeaturedGalleries(data.galleries);
        }
      } catch (error) {
        console.error('Failed to fetch featured galleries:', error);
      }
    };

    fetchCarousel();
    fetchFeaturedGalleries();
    return () => {
      cancelled = true;
    };
  }, []);

  // Use the carousel images if there are any, otherwise the artworks. Wait
  // for the carousel request, so the slides do not change after they show.
  const sourceArtworks =
    carouselImages === null
      ? null
      : carouselImages.length > 0
        ? carouselImages
        : artworks;

  // Shuffle only when the source changes. A late artworks response must not
  // reorder a carousel that shows carousel images.
  const baseArtworks = useMemo(() => {
    if (!sourceArtworks || sourceArtworks.length === 0) return [];
    if (sourceArtworks.length === 1) {
      // Pad single artwork with gradients
      return [sourceArtworks[0], ...placeholderCarouselItems.slice(0, 5)];
    }
    return pickForCarousel(sourceArtworks, 12);
  }, [sourceArtworks]);

  const carouselArtworks = useMemo(() => {
    if (sourceArtworks === null) return [];
    if (sourceArtworks.length === 0) {
      // Show only gradients when no carousel images or artworks
      return [...placeholderCarouselItems, ...placeholderCarouselItems];
    }
    if (baseArtworks.length === 0) return [];
    return [...baseArtworks, ...baseArtworks];
  }, [baseArtworks, sourceArtworks]);

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

                const media = joinedMedia(item, 'primary_image');
                if (!media) return null;

                return (
                  <CarouselImage
                    key={`${item.id}-${index}`}
                    media={media}
                    alt=""
                    sizes={carouselSizes(media)}
                    eager={eager}
                    onReady={onResolved}
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

      <GalleryPreview galleries={displayGalleries} featured />

      <Nav />
    </>
  );
};

export { Home };
