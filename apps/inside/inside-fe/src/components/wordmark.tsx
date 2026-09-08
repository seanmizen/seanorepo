import { Box, Typography, type TypographyProps } from '@mui/material';
import type { ElementType, FC } from 'react';

/**
 * The site's name, typeset rather than written.
 *
 * `inside` carries the weight and `.space` recedes: smaller, and in
 * `text.secondary` rather than the body colour. The suffix is a quiet
 * qualifier on the name, not a second word of equal standing.
 *
 * One component, because there are two places that render the name and a
 * third will appear. Three hand-rolled copies drift, and a wordmark that
 * differs between the header and the homepage reads as a bug in the brand.
 *
 * **The accessible name is the single string "inside.space".** The two halves
 * are adjacent inline spans with no whitespace between them, so the accessible
 * name computation concatenates them into one word. A screen reader must not
 * announce "inside" and "space" as two fragments, and the header link's name
 * is asserted in several specs.
 *
 * Size comes from the caller's `variant` and the suffix takes a fixed fraction
 * of it in `em`, so one component serves a 20px header and a 120px masthead
 * without either carrying a hardcoded pixel size. Colour comes from the
 * palette, so it is correct in both themes without a second definition.
 */
const SUFFIX_SCALE = 0.81;

/**
 * `component` is widened to any element type, which is what lets the header
 * render the wordmark as a router `Link` while the masthead renders a heading.
 * MUI's own `TypographyProps` pins it to the default `span`.
 */
export type WordmarkProps = TypographyProps<
  'span',
  { component?: ElementType }
> & {
  /** Present when `component` is a router `Link`. */
  to?: string;
};

export const Wordmark: FC<WordmarkProps> = ({ sx, ...rest }) => (
  <Typography data-testid="wordmark" sx={sx} {...rest}>
    <Box component="span" data-testid="wordmark-name">
      inside
    </Box>
    <Box
      component="span"
      data-testid="wordmark-suffix"
      sx={{
        fontSize: `${SUFFIX_SCALE}em`,
        color: 'text.secondary',
        // The display face is tracked tight for the name. At this size the
        // suffix needs that tracking relaxed or the dot closes up on the s.
        letterSpacing: 'normal',
      }}
    >
      .space
    </Box>
  </Typography>
);
