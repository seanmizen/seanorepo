import { alpha, Chip, Paper, Tooltip, useTheme } from '@mui/material';
import type { AppConfig, HealthResponse } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import type { FC, ReactNode } from 'react';
import { api } from '@/config';

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json() as Promise<T>;
};

/**
 * Each status colour needs a light and a dark value.
 *
 * A single fixed colour cannot clear 4.5:1 against both grounds — the first
 * attempt here used one value per status and failed axe on every dark-theme
 * page at 2.73:1.
 */
interface ChipColour {
  light: string;
  dark: string;
}

const PURPLE: ChipColour = { light: '#7b3fbf', dark: '#cbaaf2' };
const GREEN: ChipColour = { light: '#2e7d32', dark: '#86d691' };
const RED: ChipColour = { light: '#c62828', dark: '#f4948b' };
/** Deliberately not green: "we don't know yet" must not look like "it's fine". */
const NEUTRAL: ChipColour = { light: '#5f5a54', dark: '#a39d94' };

/**
 * Every chip is the same shape, so the stack reads as one system as more are
 * added (queue depth, build ref, feature flags) rather than a row of one-offs.
 */
const StatusChip: FC<{
  label: string;
  title: string;
  colour: ChipColour;
  testId: string;
  /** The state this chip is reporting, exposed so tests assert the state
   *  machine rather than the wording. */
  status?: string;
}> = ({ label, title, colour: pair, testId, status }) => {
  const theme = useTheme();
  const colour = theme.palette.mode === 'dark' ? pair.dark : pair.light;

  return (
    <Tooltip title={title} placement="right">
      <Chip
        size="small"
        variant="outlined"
        label={label}
        data-testid={testId}
        data-status={status}
        // The tooltip text is the chip's accessible name too, so a screen
        // reader gets the full status rather than only the short label.
        aria-label={title}
        sx={{
          // Explicit rather than a palette slot: these are meta-UI about the
          // deployment, deliberately outside the site's own brand colours.
          color: colour,
          borderColor: colour,
          backgroundColor: 'background.paper',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontSize: 11,
          height: 22,
        }}
      />
    </Tooltip>
  );
};

/**
 * Deployment status: floating, top-left, stacked, with room to grow.
 *
 * Implements, and is the reason for the shape of, five requirements — see
 * `apps/inside/requirements/chips.md`:
 *
 * - REQ-CHIPS-001 — fixed-position chrome, never in normal flow
 * - REQ-CHIPS-002 — anchored top-left, stacking downwards as chips are added
 * - REQ-CHIPS-003 — translucent backdrop, fully opaque content
 * - REQ-CHIPS-005 — present on every route (rendered once, in app/provider)
 * - REQ-CHIPS-006 — the dev chip appears only when the server says so
 *
 * Do not move these into the header to resolve a layout collision; adjust the
 * header's offset instead, which is REQ-CHIPS-004. That trade was made once,
 * in #197, and reverted in #198.
 */
const StatusChips: FC = () => {
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => fetchJson<AppConfig>(api.endpoints.config),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchJson<HealthResponse>(api.endpoints.health),
    refetchInterval: 30_000,
  });

  const chips: ReactNode[] = [];

  // REQ-CHIPS-006. Purple, and only ever shown when the SERVER says it is not
  // production — a build-time flag would say what the bundle was compiled to
  // believe, which is a different claim.
  if (config.data?.devMode) {
    chips.push(
      <StatusChip
        key="dev"
        testId="status-chip-dev"
        label="dev"
        title="Running against a non-production backend"
        colour={PURPLE}
      />,
    );
  }

  /**
   * One value, three presentations. REQ-STATE-004, and the mechanism that
   * makes REQ-STATE-002 hold rather than merely be intended.
   *
   * Label, colour and tooltip previously branched separately, so an in-flight
   * request rendered a green chip whose tooltip said "API reachable" — the app
   * asserting something it had not yet verified. Deriving all three from a
   * single status makes that class of disagreement unrepresentable.
   *
   * `checking` is deliberately neutral rather than optimistic: a pending state
   * must not look like a successful one.
   */
  const backend: 'checking' | 'ok' | 'down' = health.isPending
    ? 'checking'
    : health.isError
      ? 'down'
      : 'ok';

  const BACKEND_PRESENTATION = {
    checking: {
      label: 'backend…',
      colour: NEUTRAL,
      title: 'Checking whether the API is reachable',
    },
    down: {
      label: 'backend down',
      colour: RED,
      title: 'The API is not reachable',
    },
    ok: {
      label: 'backend ok',
      colour: GREEN,
      title: `API reachable${health.data ? ` · up ${health.data.uptime}s` : ''}`,
    },
  } as const;

  chips.push(
    <StatusChip
      key="backend"
      testId="status-chip-backend"
      status={backend}
      {...BACKEND_PRESENTATION[backend]}
    />,
  );

  return (
    <Paper
      elevation={0}
      data-testid="status-chips"
      sx={{
        // REQ-CHIPS-001. Not a styling preference: moving this into flow is
        // the specific regression #198 exists to prevent.
        position: 'fixed',
        // REQ-CHIPS-002 — top-left, and the column below stacks downwards.
        top: 14,
        left: 14,
        zIndex: (theme) => theme.zIndex.appBar + 1,
        p: 0.75,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.5,
        // REQ-CHIPS-003: 90% on the BACKGROUND, not the element. Fading the
        // whole card fades the chip text with it, which cost the green chip its
        // contrast (4.25:1 against the composited ground) — the opposite of
        // what a legibility backdrop is for. `opacity` here would be the bug.
        backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.9),
        border: '1px solid',
        borderColor: 'divider',
      }}
      aria-label="Environment status"
    >
      {chips}
    </Paper>
  );
};

export { StatusChips };
