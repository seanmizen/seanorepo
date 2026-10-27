import { css } from 'styled-components';

/* One content box for the nav and every public page: at most
   --page-max-width wide, in the middle, with --page-gutter at each side.
   Everything inside starts at the same left edge and ends at the same right
   edge. */
export const pageWidth = css`
  width: 100%;
  max-width: var(--page-max-width);
  margin-inline: auto;
  padding-inline: var(--page-gutter);
  box-sizing: border-box;
`;
