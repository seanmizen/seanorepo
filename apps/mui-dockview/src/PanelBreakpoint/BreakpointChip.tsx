import { Chip } from '@mui/material';

export interface BreakpointChipProps {
  width: number;
  breakpoint: string;
  visible: boolean;
}

/**
 * A visual indicator chip that displays the current panel width and breakpoint.
 *
 * Appears in the top-right corner of a panel and shows information like "320px / sm".
 * Designed to appear instantly when panel size changes, then fade out smoothly after a delay.
 *
 * @param width - The current width of the panel in pixels
 * @param breakpoint - The current breakpoint name (xs, sm, md, lg, xl)
 * @param visible - Whether the chip should be visible or faded out
 *
 * @example
 * ```tsx
 * <BreakpointChip
 *   width={320}
 *   breakpoint="sm"
 *   visible={true}
 * />
 * ```
 */
export const BreakpointChip = ({
  width,
  breakpoint,
  visible,
}: BreakpointChipProps) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1000,
        pointerEvents: 'none',
        opacity: visible ? 0.9 : 0,
        transition: visible ? 'none' : 'opacity 1s ease-out',
      }}
    >
      <Chip
        sx={{ borderRadius: '4px' }}
        label={`${width}px / ${breakpoint}`}
        color="secondary"
        size="small"
      />
    </div>
  );
};
