/**
 * The enum VALUES, as arrays.
 *
 * These live in `shared/` rather than the backend because the frontend needs
 * them too — to build filter controls, and to parse URL state against the same
 * source the server validates with. A copy on each side is a copy that drifts.
 *
 * The union TYPES stay in `types.ts`. These are the runtime lists, and the
 * `satisfies` below keeps the two from diverging.
 */
import type {
  Availability,
  BudgetBand,
  DesignerProfileStatus,
  DesignerSort,
  Timeline,
  WorkType,
} from './types';

export const BUDGET_BANDS = [
  'under_10k',
  '10k_25k',
  '25k_50k',
  '50k_100k',
  '100k_250k',
  '250k_plus',
] as const satisfies readonly BudgetBand[];

export const WORK_TYPES = [
  'full_home',
  'single_room',
  'kitchen',
  'bathroom',
  'extension',
  'new_build',
  'renovation',
  'commercial',
  'styling',
  'other',
] as const satisfies readonly WorkType[];

export const TIMELINES = [
  'asap',
  'within_3_months',
  'within_6_months',
  'within_12_months',
  'exploring',
] as const satisfies readonly Timeline[];

/** Availability is Timeline minus `exploring` — a studio is free or it isn't. */
export const AVAILABILITIES = [
  'asap',
  'within_3_months',
  'within_6_months',
  'within_12_months',
] as const satisfies readonly Availability[];

export const DESIGNER_SORTS = [
  'relevance',
  'newest',
  'oldest',
  'name',
] as const satisfies readonly DesignerSort[];

export const DESIGNER_PROFILE_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
] as const satisfies readonly DesignerProfileStatus[];
