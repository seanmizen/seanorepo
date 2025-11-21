export type PanelBreakpointConfig = {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
};

export const defaultBreakpoints: PanelBreakpointConfig = {
  xs: 0,
  sm: 200,
  md: 400,
  lg: 600,
  xl: 1280,
};

export const PanelBreakpoints = defaultBreakpoints;

export type PanelBreakpoint = keyof PanelBreakpointConfig;

export const getCurrentPanelBreakpoint = (
  width: number,
  breakpoints: PanelBreakpointConfig = defaultBreakpoints
): PanelBreakpoint => {
  if (width < breakpoints.sm) return "xs";
  if (width < breakpoints.md) return "sm";
  if (width < breakpoints.lg) return "md";
  if (width < breakpoints.xl) return "lg";
  return "xl";
};
