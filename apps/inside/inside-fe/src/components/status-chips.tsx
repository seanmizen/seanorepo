import { Chip, Stack, Tooltip, useTheme } from '@mui/material';
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
 * Deployment status, fixed top-left on every page.
 *
 * Sits opposite the theme toggle and is deliberately a vertical stack with
 * room to grow — new chips append here rather than finding their own corner.
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

  // Purple, and only ever shown when the SERVER says it is not production.
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
   * One value, three presentations.
   *
   * Label, colour and tooltip previously branched separately, so an in-flight
   * request rendered a green chip whose tooltip said "API reachable" — the app
   * asserting something it had not yet verified. Deriving all three from a
   * single status makes that class of disagreement unrepresentable.
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
    <Stack
      spacing={0.75}
      alignItems="flex-start"
      sx={{ position: 'fixed', top: 16, left: 16, zIndex: 1200 }}
      aria-label="Environment status"
    >
      {chips}
    </Stack>
  );
};

export { StatusChips };
