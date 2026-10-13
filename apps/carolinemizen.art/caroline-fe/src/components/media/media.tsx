// Shows an uploaded photo or video in two stages:
// 1. The average colour and the thumbhash blur, at once, from the API data.
// 2. The variant that srcset selects for the screen. It fades in over the
//    blur after it loads. When the backend has no variants yet, this is the
//    original file.

import { type CSSProperties, type FC, useMemo, useState } from 'react';
import styled, { css } from 'styled-components';
import { thumbHashToAverageRGBA, thumbHashToDataURL } from 'thumbhash';
import type { ImageMedia, JoinedMedia } from '@/types';

const API_URL = import.meta.env.API_URL;

// The frame holds the placeholder. The caller's className sets its size.
// The photo or video is in an absolute layer, so the frame takes the aspect
// ratio of the media, as an <img> does. A caller's aspect-ratio overrides it.
const Frame = styled.span`
  display: block;
  position: relative;
  aspect-ratio: var(--media-ratio, auto);
  overflow: hidden;
  background-size: cover;
  background-position: center;
`;

// The photo or video stays invisible until it is ready, then fades in.
const fill = css<{ $loaded: boolean }>`
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: ${(p) => (p.$loaded ? 1 : 0)};
  transition: opacity 400ms ease;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const FillImage = styled.img<{ $loaded: boolean }>`
  ${fill}
`;

const FillVideo = styled.video<{ $loaded: boolean }>`
  ${fill}
`;

interface Variant {
  width: number;
  path: string;
}

const uploadUrl = (storagePath: string) => `${API_URL}/uploads/${storagePath}`;

const parseVariants = (variants: string | null): Variant[] =>
  variants
    ? (JSON.parse(variants) as Variant[]).sort((a, b) => a.width - b.width)
    : [];

const decodeThumbhash = (thumbhash: string) =>
  Uint8Array.from(atob(thumbhash), (c) => c.charCodeAt(0));

/** The media fields of an image row, without the prefix of a join. */
export const joinedMedia = <P extends string>(
  row: JoinedMedia<P>,
  prefix: P,
): ImageMedia | null => {
  // TypeScript cannot resolve a generic template key, so read the row through
  // the same type with a plain string prefix.
  const fields: JoinedMedia<string> = row;
  const storagePath = fields[`${prefix}_path`];
  if (!storagePath) return null;
  return {
    storage_path: storagePath,
    mime_type: fields[`${prefix}_mime_type`] ?? '',
    width: fields[`${prefix}_width`],
    height: fields[`${prefix}_height`],
    thumbhash: fields[`${prefix}_thumbhash`],
    variants: fields[`${prefix}_variants`],
    poster_path: fields[`${prefix}_poster_path`],
  };
};

/**
 * What a video shows:
 * - autoplay: plays muted in a loop.
 * - controls: shows the player controls, and loads only metadata first.
 * - poster: shows only the poster frame. Use it for small previews.
 */
export type VideoMode = 'autoplay' | 'controls' | 'poster';

export interface MediaProps {
  media: ImageMedia;
  alt: string;
  /** The rendered width, as the HTML sizes attribute. */
  sizes: string;
  eager?: boolean;
  video?: VideoMode;
  className?: string;
  /** Fires when the media loads or fails to load. */
  onReady?: () => void;
}

export const Media: FC<MediaProps> = ({
  media,
  alt,
  sizes,
  eager = false,
  video = 'autoplay',
  className,
  onReady,
}) => {
  const [loaded, setLoaded] = useState(false);

  const frameStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties & Record<'--media-ratio', string> = {
      '--media-ratio':
        media.width && media.height
          ? `${media.width} / ${media.height}`
          : 'auto',
    };
    if (media.thumbhash) {
      const hash = decodeThumbhash(media.thumbhash);
      const { r, g, b, a } = thumbHashToAverageRGBA(hash);
      style.backgroundColor = `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
      style.backgroundImage = `url(${thumbHashToDataURL(hash)})`;
    }
    return style;
  }, [media.width, media.height, media.thumbhash]);

  const variants = useMemo(
    () => parseVariants(media.variants),
    [media.variants],
  );

  const reveal = () => {
    setLoaded(true);
    onReady?.();
  };

  const isVideo = media.mime_type.startsWith('video/');
  const posterUrl = media.poster_path ? uploadUrl(media.poster_path) : null;
  const largest = variants[variants.length - 1];

  if (isVideo && !(video === 'poster' && posterUrl)) {
    return (
      <Frame className={className} style={frameStyle}>
        <FillVideo
          $loaded={loaded}
          src={uploadUrl(largest ? largest.path : media.storage_path)}
          poster={posterUrl ?? undefined}
          autoPlay={video === 'autoplay'}
          controls={video === 'controls'}
          preload={video === 'autoplay' ? 'auto' : 'metadata'}
          loop
          muted
          playsInline
          onLoadedData={reveal}
          // With preload="metadata", some browsers never fire loadeddata.
          onLoadedMetadata={video === 'controls' ? reveal : undefined}
          onError={reveal}
        />
      </Frame>
    );
  }

  const src = isVideo
    ? (posterUrl as string)
    : uploadUrl(largest ? largest.path : media.storage_path);
  const srcSet = isVideo
    ? undefined
    : variants.map((v) => `${uploadUrl(v.path)} ${v.width}w`).join(', ') ||
      undefined;

  return (
    <Frame className={className} style={frameStyle}>
      <FillImage
        $loaded={loaded}
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        // Decode before the fade, so the photo never paints in strips.
        onLoad={(event) => {
          event.currentTarget
            .decode()
            .catch(() => {})
            .finally(reveal);
        }}
        onError={reveal}
      />
    </Frame>
  );
};
