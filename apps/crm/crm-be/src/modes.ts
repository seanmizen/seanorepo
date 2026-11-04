import type { Database } from 'bun:sqlite';
import { dayRange } from './dates';
import type { PlateKey } from './ui/DisplayUnit';

/**
 * The three modes of the crm (`apps/crm/docs/002-rack.md`, decision 1).
 * Each one is a latching key on the plate of the display unit, and the
 * keys replace the nav links as the way between the views:
 *
 * - `plan`: the home (`/`), the band grouped by due date.
 * - `work`: an organisation page in its running order: Start, then Prev
 *   and Next (`walkOrder` in `routes/index.tsx`).
 * - `review`: the evening view (`/review`): the visits and notes logged
 *   today, and what is still due.
 *
 * There is no round record: the running order is the list that Sean came
 * from (decision 2).
 */
export type Mode = 'plan' | 'work' | 'review';

/** The numbers in the captions of the mode keys. */
export interface ModeCounts {
  /** The organisations with a next action due today or overdue. */
  due: number;
  /** The visits and notes logged today that show (not hidden). */
  logged: number;
}

/** The counts of the mode keys on the London day `date`. */
export const modeCounts = (db: Database, date: string): ModeCounts => {
  const { from, to } = dayRange(date);
  const due =
    db
      .query<{ n: number }, [string]>(
        'SELECT count(*) AS n FROM organisation WHERE next_action_on <= ?;',
      )
      .get(date)?.n ?? 0;
  const logged =
    db
      .query<{ n: number }, [string, string]>(
        `SELECT
           (SELECT count(*) FROM visit
             WHERE hidden_at IS NULL AND at >= ?1 AND at < ?2)
         + (SELECT count(*) FROM note
             WHERE hidden_at IS NULL AND created_at >= ?1 AND created_at < ?2)
           AS n;`,
      )
      .get(from, to)?.n ?? 0;
  return { due, logged };
};

/**
 * The mode keys of a page: Plan, Work and Review, in that order, each a
 * link with a caption (REQ-CRM-BUTTON-001). The key of the mode of the
 * page (`mode`) is on: its LED is lit. A page that is in no mode (the
 * address book) gives `null`.
 *
 * - Plan opens `/`. Its caption is the number due now.
 * - Work opens `work.href`: the first organisation of the running order
 *   of the page. With no organisation it is off, and `work.caption` is the
 *   reason.
 * - Review opens `/review`. Its caption is the number logged today.
 */
export const modeKeys = ({
  mode,
  work,
  counts,
}: {
  mode: Mode | null;
  work: { href?: string; caption: string };
  counts: ModeCounts;
}): PlateKey[] => [
  {
    id: 'mode-plan',
    label: 'Plan',
    caption: counts.due ? `${counts.due} due` : 'None due',
    href: '/',
    on: mode === 'plan',
  },
  work.href
    ? {
        id: 'mode-work',
        label: 'Work',
        caption: work.caption,
        href: work.href,
        on: mode === 'work',
      }
    : { id: 'mode-work', label: 'Work', caption: work.caption, off: true },
  {
    id: 'mode-review',
    label: 'Review',
    caption: `${counts.logged} logged`,
    href: '/review',
    on: mode === 'review',
  },
];
