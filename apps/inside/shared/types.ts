/**
 * Types shared between inside-fe and inside-be.
 *
 * SQL is snake_case; these are the camelCase shapes the API speaks.
 *
 * NAMING WARNING — "project" is overloaded in this domain:
 * - `Project` a designer's completed work, shown in their portfolio
 * - `Brief`   a homeowner's posted job, which designers pitch on
 * - `Pitch`   a designer's response to a brief
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

/* ------------------------------------------------------------------ *
 * Shared domain vocabulary
 * ------------------------------------------------------------------ */

/** Budgets are always a band, never a number — designers quote ranges. */
export type BudgetBand =
  | 'under_10k'
  | '10k_25k'
  | '25k_50k'
  | '50k_100k'
  | '100k_250k'
  | '250k_plus';

/** The kind of work, used on portfolio projects, enquiries and briefs alike. */
export type ProjectType =
  | 'full_home'
  | 'single_room'
  | 'kitchen'
  | 'bathroom'
  | 'extension'
  | 'new_build'
  | 'renovation'
  | 'commercial'
  | 'styling'
  | 'other';

/** How soon a buyer wants to start. */
export type Timeline =
  | 'asap'
  | 'within_3_months'
  | 'within_6_months'
  | 'within_12_months'
  | 'exploring';

/** A designer's own availability. Narrower than `Timeline` — no 'exploring'. */
export type Availability = Exclude<Timeline, 'exploring'>;

/* ------------------------------------------------------------------ *
 * Designers and portfolios
 * ------------------------------------------------------------------ */

/**
 * Approval gate. Designers self-signup but stay unlisted until an admin
 * approves them; a new profile starts as `draft` and is never publicly visible.
 * Discovery only ever selects `approved`.
 */
export type DesignerProfileStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected';

/** The sellable designer. One per `User` with role `designer`. */
export interface DesignerProfile {
  id: number;
  userId: number;
  /** Public, SEO-facing URL segment: /designers/:slug. Unique. */
  slug: string;
  studioName: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  budgetBand: BudgetBand | null;
  coverImageId: number | null;
  status: DesignerProfileStatus;
  reviewedAt: string | null;
  reviewedBy: number | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'draft' | 'published';

/** A portfolio piece: a designer's completed work. Not a `Brief`. */
export interface Project {
  id: number;
  designerProfileId: number;
  /** Unique site-wide, so a project has a stable canonical URL. */
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  projectType: ProjectType | null;
  budgetBand: BudgetBand | null;
  completedYear: number | null;
  coverImageId: number | null;
  status: ProjectStatus;
  /** Curatorial order within the portfolio; lower sorts first. */
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** An image on a portfolio project, in an explicit curatorial sequence. */
export interface ProjectImage {
  id: number;
  projectId: number;
  imageId: number;
  caption: string | null;
  displayOrder: number;
  createdAt: string;
}

/** A buyer's shortlist entry. Unique per (user, designer). */
export interface SavedDesigner {
  id: number;
  userId: number;
  designerProfileId: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Connections
 * ------------------------------------------------------------------ */

export type EnquiryStatus =
  | 'new'
  | 'read'
  | 'replied'
  | 'archived'
  | 'declined';

/**
 * Buyer -> designer, direct. The root of an in-app thread: replies hang off
 * `id` later, so the opening message lives on the enquiry itself.
 *
 * `buyerId` is nullable — the designer keeps the enquiry even if the sender
 * deletes their account, which is why contact details are snapshotted here.
 */
export interface Enquiry {
  id: number;
  buyerId: number | null;
  designerProfileId: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  projectType: ProjectType | null;
  budgetBand: BudgetBand | null;
  location: string | null;
  timeline: Timeline | null;
  message: string;
  status: EnquiryStatus;
  readAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `draft` is never listed; `open` takes pitches; `closed`/`awarded` do not. */
export type BriefStatus = 'draft' | 'open' | 'closed' | 'awarded';

/** Post-a-project: a homeowner's public listing. Not a portfolio `Project`. */
export interface Brief {
  id: number;
  buyerId: number | null;
  title: string;
  description: string;
  projectType: ProjectType | null;
  budgetBand: BudgetBand | null;
  location: string | null;
  timeline: Timeline | null;
  status: BriefStatus;
  closesAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PitchStatus =
  | 'sent'
  | 'read'
  | 'shortlisted'
  | 'accepted'
  | 'declined'
  | 'withdrawn';

/** A designer's response to a `Brief`. One per designer per brief. */
export interface Pitch {
  id: number;
  briefId: number;
  designerProfileId: number;
  message: string;
  budgetBand: BudgetBand | null;
  availability: Availability | null;
  status: PitchStatus;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}
