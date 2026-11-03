import type { ReactNode } from 'react';

/**
 * The device: the core function of the page, as one instrument, as the
 * panel of autosam. It is a chassis with modules on one grid of 6 columns,
 * with 2px seams between them. The `Lcd` comes first, then each `Module`.
 * A `<form>` that holds more than one module is a direct child, and its
 * modules sit on the same grid.
 *
 * Only the core interaction of the page goes in the device. Help text goes
 * under it, and history and reference data go in `Records`.
 */
export const Device = ({ children }: { children: ReactNode }) => (
  <div className="device">{children}</div>
);
