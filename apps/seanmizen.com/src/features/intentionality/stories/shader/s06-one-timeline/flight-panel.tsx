import type { FC } from 'react';
import { useEffect, useState } from 'react';
import styles from '@/app/routes/hire-lab/hire-lab.module.css';
import type { FlightSettings } from './components/shader-ripple';
import {
  deserialiseFlight,
  FLIGHT_DEFAULTS,
  FLIGHT_DEFS,
  serialiseFlight,
} from './components/shader-ripple';

/* TEMPORARY: a dev-only panel to tune the core's flight on the real pages.
   When the values are settled, they become constants, and this file goes
   (see components/shader-ripple/flight.ts). */

// Changed for the story: on the site the panel showed only on the dev
// server. In a story sample it always shows.
const DEV = true;
const STORAGE_KEY = 'flight-settings:shader-s06-one-timeline';

const readStored = () => {
  try {
    return deserialiseFlight(localStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return null;
  }
};

/* The flight settings: the defaults in production, and in development the
   last setup from the panel, kept over a reload. */
const useFlight = () => {
  const [flight, setFlight] = useState<FlightSettings>(() =>
    DEV ? (readStored() ?? FLIGHT_DEFAULTS) : FLIGHT_DEFAULTS,
  );
  useEffect(() => {
    if (!DEV) return;
    try {
      localStorage.setItem(STORAGE_KEY, serialiseFlight(flight));
    } catch {
      // Storage can be off. The settings string still works.
    }
  }, [flight]);
  return [flight, setFlight] as const;
};

type FlightPanelProps = {
  flight: FlightSettings;
  setFlight: (flight: FlightSettings) => void;
  /* Puts the core back in the middle and throws it again. */
  onReplay: () => void;
};

const FlightPanel: FC<FlightPanelProps> = ({ flight, setFlight, onReplay }) => {
  const [status, setStatus] = useState('');
  const serialised = serialiseFlight(flight);
  const [draft, setDraft] = useState(serialised);
  useEffect(() => setDraft(serialised), [serialised]);

  if (!DEV) return null;

  const flash = (text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(''), 2000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serialised);
      flash('copied');
    } catch {
      const box = document.getElementById('flight-settings');
      if (box instanceof HTMLTextAreaElement) box.select();
      flash('press ctrl+c to copy');
    }
  };

  const load = () => {
    const parsed = deserialiseFlight(draft);
    if (!parsed) {
      flash('not a flight-v1 string');
      return;
    }
    setFlight(parsed);
    flash('loaded');
  };

  return (
    <details className={styles.panel} data-no-ripple open>
      <summary className={styles.title}>throw (temporary)</summary>
      <p className={styles.hint}>
        Go between home and projects at any point to see the throw play forward
        and back. Replay throws it again from the middle. Changes apply live.
        Double-click a slider to reset it.
      </p>
      {FLIGHT_DEFS.map((def) => (
        <label key={def.key} className={styles.slider} title={def.hint}>
          <span className={styles.name}>{def.label}</span>
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={flight[def.key]}
            onChange={(e) =>
              setFlight({ ...flight, [def.key]: Number(e.target.value) })
            }
            onDoubleClick={() =>
              setFlight({ ...flight, [def.key]: FLIGHT_DEFAULTS[def.key] })
            }
          />
          <span
            className={
              flight[def.key] === FLIGHT_DEFAULTS[def.key]
                ? styles.value
                : `${styles.value} ${styles.changed}`
            }
          >
            {flight[def.key]}
          </span>
        </label>
      ))}
      <label className={styles.heading} htmlFor="flight-settings">
        settings string
      </label>
      <textarea
        id="flight-settings"
        className={styles.string}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={4}
      />
      <div className={styles.row}>
        <button type="button" onClick={copy}>
          copy
        </button>
        <button type="button" onClick={load} disabled={draft === serialised}>
          load
        </button>
        <button type="button" onClick={() => setFlight(FLIGHT_DEFAULTS)}>
          reset
        </button>
        <button type="button" onClick={onReplay}>
          replay
        </button>
        <output className={styles.status}>{status}</output>
      </div>
    </details>
  );
};

export { FlightPanel, useFlight };
