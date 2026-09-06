import type { Availability, BudgetBand, WorkType } from '@shared/types';

/**
 * The demo dataset.
 *
 * Kept as plain data, separate from the code that inserts it, so the content
 * can be edited without touching the seeding logic — and so it reads like the
 * marketplace we are describing rather than "Studio 1, Studio 2, Studio 3".
 *
 * Every email is @inside.test, which is a reserved TLD and can never receive
 * mail. Seeded accounts must not be able to reach a real inbox.
 */
export interface SeedProject {
  title: string;
  summary: string;
  workType: WorkType;
  budgetBand: BudgetBand;
  location: string;
  completedYear: number;
  /** Cover colour for the generated placeholder image. */
  colour: string;
  published?: boolean;
}

export interface SeedDesigner {
  email: string;
  studioName: string;
  headline: string;
  bio: string;
  location: string;
  budgetBand: BudgetBand;
  availability: Availability;
  /** Where the profile ends up, so every state in the gate is demonstrable. */
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  reviewNote?: string;
  projects: SeedProject[];
}

export const DESIGNERS: SeedDesigner[] = [
  {
    email: 'mercer@inside.test',
    studioName: 'Studio Mercer',
    headline: 'Quiet, material-led interiors for period homes',
    bio: 'A London studio working mostly on Victorian and Georgian houses. We favour plaster, oak and unlacquered brass, and we would rather do one room properly than five quickly.',
    location: 'London',
    budgetBand: '100k_250k',
    availability: 'within_3_months',
    status: 'approved',
    projects: [
      {
        title: 'Clapham Townhouse',
        summary: 'A full refurbishment of a four-storey Victorian townhouse.',
        workType: 'full_home',
        budgetBand: '100k_250k',
        location: 'London',
        completedYear: 2025,
        colour: '#8a6f47',
      },
      {
        title: 'Marylebone Kitchen',
        summary: 'Hand-painted cabinetry and a single slab of Calacatta Viola.',
        workType: 'kitchen',
        budgetBand: '50k_100k',
        location: 'London',
        completedYear: 2024,
        colour: '#5c6b61',
      },
      {
        title: 'Notting Hill Study',
        summary: 'Still being photographed — not yet public.',
        workType: 'single_room',
        budgetBand: '25k_50k',
        location: 'London',
        completedYear: 2026,
        colour: '#6b6660',
        published: false,
      },
    ],
  },
  {
    email: 'atelier@inside.test',
    studioName: 'Atelier Bloom',
    headline: 'Colour-forward residential design',
    bio: 'We are not a beige studio. Bloom works with saturated colour, pattern and salvage, mostly on family homes that need to survive actual families.',
    location: 'Bristol',
    budgetBand: '50k_100k',
    availability: 'asap',
    status: 'approved',
    projects: [
      {
        title: 'Redland Family Kitchen',
        summary:
          'Deep green cabinetry, terracotta floor, and a very large table.',
        workType: 'kitchen',
        budgetBand: '50k_100k',
        location: 'Bristol',
        completedYear: 2025,
        colour: '#3f5f4a',
      },
      {
        title: 'Clifton Bathroom',
        summary: 'A small bathroom that stopped apologising for being small.',
        workType: 'bathroom',
        budgetBand: '10k_25k',
        location: 'Bristol',
        completedYear: 2024,
        colour: '#7b3fbf',
      },
    ],
  },
  {
    email: 'northlight@inside.test',
    studioName: 'Northlight Architects',
    headline: 'Extensions and new build, north of the Trent',
    bio: 'Chartered architects working on domestic extensions, loft conversions and the occasional new build. We do the drawings and the planning, and we stay until it is finished.',
    location: 'Manchester',
    budgetBand: '250k_plus',
    availability: 'within_6_months',
    status: 'approved',
    projects: [
      {
        title: 'Chorlton Rear Extension',
        summary:
          'A glazed rear extension that finally gave the house a back door worth using.',
        workType: 'extension',
        budgetBand: '100k_250k',
        location: 'Manchester',
        completedYear: 2025,
        colour: '#4a5a6b',
      },
    ],
  },
  {
    email: 'pending@inside.test',
    studioName: 'Ash & Ember',
    headline: 'New studio, awaiting review',
    bio: 'Submitted and waiting in the approval queue — useful for demonstrating the review flow.',
    location: 'Edinburgh',
    budgetBand: '25k_50k',
    availability: 'asap',
    status: 'pending',
    projects: [
      {
        title: 'Stockbridge Flat',
        summary: 'A one-bed flat reworked around a single wall of storage.',
        workType: 'single_room',
        budgetBand: '10k_25k',
        location: 'Edinburgh',
        completedYear: 2025,
        colour: '#8a6f47',
      },
    ],
  },
  {
    email: 'draft@inside.test',
    studioName: 'Halcyon Interiors',
    headline: 'Still writing their profile',
    bio: 'Never submitted — sits in draft, invisible to everyone but themselves.',
    location: 'Leeds',
    budgetBand: 'under_10k',
    availability: 'asap',
    status: 'draft',
    projects: [],
  },
  {
    email: 'rejected@inside.test',
    studioName: 'Placeholder Design Co',
    headline: 'Turned down, and told why',
    bio: 'Rejected with a note, so the resubmission flow can be demonstrated.',
    location: 'Cardiff',
    budgetBand: 'under_10k',
    availability: 'asap',
    status: 'rejected',
    reviewNote:
      'We need at least two completed projects with photography before listing a studio.',
    projects: [],
  },
];

export interface SeedBrief {
  title: string;
  description: string;
  workType: WorkType;
  budgetBand: BudgetBand;
  location: string;
  status: 'draft' | 'open' | 'closed';
}

export const BUYERS = [
  { email: 'harriet@inside.test', name: 'Harriet' },
  { email: 'omar@inside.test', name: 'Omar' },
];

export const BRIEFS: SeedBrief[] = [
  {
    title: 'Kitchen and utility, 1930s semi',
    description:
      'We want to open the kitchen into the side return and add a utility. Happy to be led on materials, but no gloss and no handleless.',
    workType: 'kitchen',
    budgetBand: '50k_100k',
    location: 'London',
    status: 'open',
  },
  {
    title: 'Whole-house refurbishment, Georgian terrace',
    description:
      'Four bedrooms, needs rewiring and replastering throughout. Looking for someone who has worked on listed buildings before.',
    workType: 'full_home',
    budgetBand: '250k_plus',
    location: 'Bristol',
    status: 'open',
  },
  {
    title: 'Loft conversion with ensuite',
    description: 'Straightforward dormer loft. Planning already granted.',
    workType: 'extension',
    budgetBand: '25k_50k',
    location: 'Manchester',
    status: 'closed',
  },
];
