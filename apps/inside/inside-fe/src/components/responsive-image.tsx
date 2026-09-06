import { Box, type SxProps, type Theme } from '@mui/material';
import type { StoredImage } from '@shared/types';
import type { FC } from 'react';

/**
 * An uploaded image, served at the size the viewport actually needs.
 *
 * Every image carries thumb/grid/full variants, so this builds a real srcset
 * rather than shipping the 2000px original to a phone — on an image-heavy
 * portfolio site that is the difference between fast and unusable on mobile.
 *
 * `sizes` is required, not optional with a default. The browser picks a
 * variant from `sizes` BEFORE layout, so a wrong or missing value silently
 * downloads the largest file and the srcset achieves nothing. Making callers
 * state it keeps that decision visible.
 */
export const ResponsiveImage: FC<{
  image: StoredImage;
  /** CSS `sizes`: how wide this image renders at each breakpoint. */
  sizes: string;
  alt?: string | null;
  /** Above the fold: skip lazy loading so it is not deferred. */
  priority?: boolean;
  /** Aspect ratio reserved before load, so nothing shifts as images arrive. */
  ratio?: string;
  sx?: SxProps<Theme>;
}> = ({ image, sizes, alt, priority = false, ratio = '3 / 2', sx }) => {
  const srcSet = (
    Object.values(image.variants) as Array<{
      url: string;
      width: number;
    }>
  )
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(', ');

  return (
    <Box
      sx={{
        // Space is reserved from the ratio, so the page does not jump as
        // images load — the layout shift that makes a gallery feel cheap.
        aspectRatio: ratio,
        overflow: 'hidden',
        backgroundColor: 'action.hover',
        ...sx,
      }}
    >
      <Box
        component="img"
        src={image.variants.grid?.url ?? image.variants.full?.url}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt ?? image.alt ?? ''}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </Box>
  );
};
