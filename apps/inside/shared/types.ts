/**
 * Types shared between inside-fe and inside-be.
 *
 * Domain types (Designer, Project, Enquiry, ...) land here as the feature
 * tickets are built. For now this covers the scaffold's public contract.
 */

/**
 * Every account is one row in `users`; `role` decides what they can do.
 * - `buyer`    homeowner / project manager looking for a designer
 * - `designer` architect, interior designer etc. selling their work
 * - `admin`    site owner; approves designer profiles
 */
export type UserRole = 'buyer' | 'designer' | 'admin';

export interface User {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
}

/** GET /api/health */
export interface HealthResponse {
  status: 'ok';
  uptime: number;
  version: string;
}

/** GET /api/config — server-driven copy and limits the frontend reads at boot. */
export interface AppConfig {
  siteName: string;
  tagline: string;
  uploadMaxFileSizeMb: number;
  uploadMaxFiles: number;
}

/** The sizes generated for every uploaded image. Drives `srcset` on the frontend. */
export type ImageVariant = 'thumb' | 'grid' | 'full';

export interface StoredImage {
  id: number;
  /** Storage-relative path of the original upload. */
  path: string;
  /** Public URL per variant, as returned by the storage provider. */
  variants: Record<ImageVariant, { url: string; width: number }>;
  alt: string | null;
}
