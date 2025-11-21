import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  getCurrentPanelBreakpoint,
  PanelBreakpointConfig,
} from "./breakpoints";

export interface UsePanelBreakpointOptions {
  breakpoints?: PanelBreakpointConfig;
  hideDelay?: number;
}

/**
 * Hook to track panel width and manage breakpoint chip visibility.
 *
 * Automatically observes panel resize events using ResizeObserver and provides
 * the current width, breakpoint, and visibility state for the indicator chip.
 * The chip appears instantly on resize and fades out after a configurable delay.
 *
 * Performance optimized with useCallback and useMemo to prevent unnecessary re-renders.
 *
 * @param options - Configuration options
 * @param options.breakpoints - Custom breakpoint values (defaults to 100, 200, 300, 400, 500)
 * @param options.hideDelay - Delay in ms before chip fades out (defaults to 2000)
 *
 * @returns An object containing:
 *   - `panelRef` - React ref to attach to your panel container div
 *   - `panelWidth` - Current width of the panel in pixels
 *   - `currentBreakpoint` - Current breakpoint name based on panel width (xs, sm, md, lg, xl)
 *   - `chipVisible` - Boolean indicating whether the chip should be visible
 *
 * @example
 * Basic usage:
 * ```tsx
 * const MyPanel = () => {
 *   const { panelRef, panelWidth, currentBreakpoint, chipVisible } = usePanelBreakpoint();
 *
 *   return (
 *     <div ref={panelRef} style={{ position: 'relative' }}>
 *       <BreakpointChip
 *         width={panelWidth}
 *         breakpoint={currentBreakpoint}
 *         visible={chipVisible}
 *       />
 *       Content here...
 *     </div>
 *   );
 * };
 * ```
 *
 * @example
 * With custom configuration:
 * ```tsx
 * const MyPanel = () => {
 *   const { panelRef, panelWidth, currentBreakpoint, chipVisible } = usePanelBreakpoint({
 *     breakpoints: { xs: 0, sm: 400, md: 800, lg: 1200, xl: 1600 },
 *     hideDelay: 3000
 *   });
 *
 *   return (
 *     <div ref={panelRef}>
 *       <BreakpointChip width={panelWidth} breakpoint={currentBreakpoint} visible={chipVisible} />
 *     </div>
 *   );
 * };
 * ```
 */
export const usePanelBreakpoint = (options: UsePanelBreakpointOptions = {}) => {
  const { breakpoints, hideDelay = 2000 } = options;

  const panelRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [chipVisible, setChipVisible] = useState(true);

  const currentBreakpoint = useMemo(
    () => getCurrentPanelBreakpoint(panelWidth, breakpoints),
    [panelWidth, breakpoints]
  );

  const handleResize = useCallback(
    (entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        setPanelWidth(width);
        setChipVisible(true);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        timeoutRef.current = setTimeout(() => {
          setChipVisible(false);
        }, hideDelay);
      }
    },
    [hideDelay]
  );

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    timeoutRef.current = setTimeout(() => setChipVisible(false), hideDelay);

    const obs = new ResizeObserver(handleResize);
    obs.observe(el);
    setPanelWidth(Math.round(el.offsetWidth));

    return () => {
      obs.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [handleResize, hideDelay]);

  return {
    panelRef,
    panelWidth,
    currentBreakpoint,
    chipVisible,
  };
};
