import { DEMO_TEXT, demoLoginOn } from '../demo';

/**
 * The line at the top of every page while the demo switch is on
 * (`demo.ts`): plain text, before the nav. With the switch off, nothing.
 */
export const DemoBanner = () =>
  demoLoginOn() ? <p className="demo">{DEMO_TEXT}</p> : null;
