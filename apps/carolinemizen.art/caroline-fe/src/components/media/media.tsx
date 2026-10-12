// Shows an uploaded photo or video in three stages:
// 1. The average colour and the thumbhash blur, at once, from the API data.
// 2. The variant that srcset selects for the screen, over the blur.
// 3. The original file, only when the backend has no variants yet.

import { type CSSProperties, type FC, useMemo, useState } from 'react';
import { thumbHashToAverageRGBA, thumbHashToDataURL } from 'thumbhash';
import type { ImageMedia, JoinedMedia } from '@/types';

const API_URL = import.meta.env.API_URL;

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

  const placeholder = useMemo<CSSProperties>(() => {
    if (!media.thumbhash) return {};
    const hash = decodeThumbhash(media.thumbhash);
    const { r, g, b, a } = thumbHashToAverageRGBA(hash);
    return {
      backgroundColor: `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`,
      backgroundImage: `url(${thumbHashToDataURL(hash)})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }, [media.thumbhash]);

  const variants = useMemo(
    () => parseVariants(media.variants),
    [media.variants],
  );

  // A transparent photo must not show the blur behind it after it loads.
  const style = loaded ? undefined : placeholder;
  const handleReady = () => {
    setLoaded(true);
    onReady?.();
  };

  const isVideo = media.mime_type.startsWith('video/');
  const posterUrl = media.poster_path ? uploadUrl(media.poster_path) : null;

  if (isVideo && !(video === 'poster' && posterUrl)) {
    const largest = variants[variants.length - 1];
    return (
      <video
        className={className}
        style={style}
        src={uploadUrl(largest ? largest.path : media.storage_path)}
        poster={posterUrl ?? undefined}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        autoPlay={video === 'autoplay'}
        controls={video === 'controls'}
        preload={video === 'autoplay' ? 'auto' : 'metadata'}
        loop
        muted
        playsInline
        onLoadedData={handleReady}
        onError={handleReady}
      />
    );
  }

  const largest = variants[variants.length - 1];
  const src = isVideo
    ? (posterUrl as string)
    : uploadUrl(largest ? largest.path : media.storage_path);
  const srcSet = isVideo
    ? undefined
    : variants.map((v) => `${uploadUrl(v.path)} ${v.width}w`).join(', ') ||
      undefined;

  return (
    <img
      className={className}
      style={style}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={handleReady}
      onError={handleReady}
    />
  );
};
