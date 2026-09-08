/**
 * Types shared between inside-fe and inside-be.
 *
 * SQL is snake_case. These are the camelCase shapes the API speaks.
 *
 * NAMING WARNING — this domain overloads the word "project":
 * - `PortfolioProject` a designer's completed work, shown in their portfolio
 * - `Brief`   a homeowner's posted job, which designers bid on
 * - `Bid`   a designer's response to a brief
 */

/**
 * Every account is one row in `users`. `role` decides what they can do.
 * - `buyer`    homeowner / project manager looking for a designer
 * - `designer` architect, interior designer etc. selling their work
 * - `admin`    site owner, approves designer profiles
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
  /** True when the server is not running in production. Drives the dev chip. */
  devMode: boolean;
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
export type WorkType =
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
 * approves them. A new profile starts as `draft` and is never publicly visible.
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
  /** When the designer can start. A discovery filter, not a promise. */
  availability: Availability | null;
  coverImageId: number | null;
  status: DesignerProfileStatus;
  reviewedAt: string | null;
  reviewedBy: number | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PortfolioProjectStatus = 'draft' | 'published';

/** A portfolio piece: a designer's completed work. Not a `Brief`. */
export interface PortfolioProject {
  id: number;
  designerProfileId: number;
  /** Unique site-wide, so a project has a stable canonical URL. */
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  workType: WorkType | null;
  budgetBand: BudgetBand | null;
  completedYear: number | null;
  coverImageId: number | null;
  status: PortfolioProjectStatus;
  /** Curatorial order within the portfolio. Lower sorts first. */
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** An image on a portfolio project, in an explicit curatorial sequence. */
export interface PortfolioProjectImage {
  id: number;
  portfolioProjectId: number;
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

/**
 * Who may EVER see a brief. Orthogonal to whether it is currently published.
 *
 * `link` means unlisted, NOT secret. The server derives brief slugs from
 * titles and a user can edit them, so they are guessable by design — a buyer who chooses
 * anything other than `private` is consenting to a reachable URL, not a hidden
 * one. UI copy must say "unlisted", never "only people with the link".
 * `private` is the only value that enforces anything.
 */
export type BriefVisibility = 'public' | 'link' | 'private';

/**
 * Post-a-project: a homeowner's job. Not a portfolio `PortfolioProject`.
 *
 * There is no `status`. It duplicated `publishedAt` — `draft` was exactly
 * `publishedAt === null` — and a terminal `closed` could not express
 * publish/unpublish at will. Two timestamps carry it instead:
 *
 * - `publishedAt === null` — unpublished, hidden from everyone but the owner,
 *   whatever `visibility` says and whoever holds an invite.
 * - `closesAt` in the past — still visible, no longer accepting bids.
 */
export interface Brief {
  id: number;
  buyerId: number | null;
  /** Public URL segment. History-backed, so a rename keeps old links alive. */
  slug: string;
  title: string;
  description: string;
  workType: WorkType | null;
  budgetBand: BudgetBand | null;
  location: string | null;
  timeline: Timeline | null;
  visibility: BriefVisibility;
  closesAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Someone a buyer has let into a private brief. A user, not a designer. */
export interface BriefInvitee {
  id: number;
  briefId: number;
  userId: number;
  invitedAt: string;
}

/**
 * A designer is writing a bid, has sent it, or took it back.
 *
 * Deliberately small: the previous six states (sent/read/shortlisted/accepted/
 * declined/withdrawn) had no code driving any of them, and lacked the one
 * state the product actually needs — a draft you can come back to.
 */
export type BidStatus = 'draft' | 'submitted' | 'withdrawn';

/** A designer's response to a `Brief`. One per designer per brief. */
export interface Bid {
  id: number;
  briefId: number;
  designerProfileId: number;
  message: string;
  budgetBand: BudgetBand | null;
  availability: Availability | null;
  status: BidStatus;
  /** Set when the designer sends the bid. Null while it is still a draft. */
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Post-a-project API shapes
 * ------------------------------------------------------------------ */

/**
 * A brief as the public board sees it.
 *
 * `buyerId` is deliberately absent: the board is readable anonymously, and who
 * posted a job is contact detail. It must never leak from a listing.
 */
export type PublicBrief = Omit<Brief, 'buyerId'> & {
  /** How many designers have responded. A count identifies nobody. */
  bidCount: number;
};

/** A brief in its own author's dashboard, where `buyerId` is their own id. */
export type OwnedBrief = Brief & { bidCount: number };

/** The designer behind a bid, as shown to the brief's owner. */
export interface BidDesigner {
  id: number;
  slug: string;
  studioName: string;
  headline: string | null;
  location: string | null;
  budgetBand: BudgetBand | null;
}

/** A bid as the brief's owner sees it. Only ever served to that owner. */
export type ReceivedBid = Bid & { designer: BidDesigner };

/** A bid as its author sees it, alongside the brief it answers. */
export type SentBid = Bid & { brief: PublicBrief };

/** GET /api/briefs — the public board, paginated. */
export interface BriefListResponse {
  briefs: PublicBrief[];
  total: number;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ *
 * Discovery — the public, anonymous-facing read side
 * ------------------------------------------------------------------ */

/**
 * How the API orders a designer list.
 *
 * `relevance` is only meaningful alongside a search query, and the API
 * rejects it without one — silently falling back would make the ordering unexplainable.
 */
export type DesignerSort = 'relevance' | 'newest' | 'oldest' | 'name';

/**
 * A designer as they appear in a list. Deliberately narrower than
 * `DesignerProfile`: no bio, and none of the review fields, which are the
 * approval pipeline's business and not a visitor's.
 */
export interface DesignerListItem {
  id: number;
  slug: string;
  studioName: string;
  headline: string | null;
  location: string | null;
  budgetBand: BudgetBand | null;
  availability: Availability | null;
  /** Published portfolio pieces only. */
  projectCount: number;
  /** Ready for a `srcset` — the same shape the image library returns. */
  coverImage: StoredImage | null;
  createdAt: string;
}

export interface DesignerListResponse {
  designers: DesignerListItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** A portfolio image with its captions and every variant. */
export interface PublicProjectImage {
  caption: string | null;
  image: StoredImage;
}

/** A published portfolio piece with its imagery resolved for rendering. */
export interface PublicProject extends PortfolioProject {
  coverImage: StoredImage | null;
  images: PublicProjectImage[];
}

export interface DesignerPortfolioResponse {
  designer: { slug: string; studioName: string };
  portfolioProjects: PublicProject[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
