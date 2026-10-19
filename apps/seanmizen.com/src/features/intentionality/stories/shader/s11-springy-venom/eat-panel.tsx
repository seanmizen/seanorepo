import type { FC } from 'react';
import { useEffect, useState } from 'react';
import styles from '@/app/routes/hire-lab/hire-lab.module.css';
import type { EatSettings } from './components/shader-ripple';
import {
  deserialiseEat,
  EAT_DEFAULTS,
  EAT_DEFS,
  serialiseEat,
} from './components/shader-ripple';

/* TEMPORARY: a dev-only panel to tune the Venom effect on /projects. When
   the values are settled, they become constants, and this file goes (see
   components/shader-ripple/eat.ts). */

// Changed for the story: on the site the panel showed only on the dev
// server. In a story sample it always shows.
const DEV = true;
const STORAGE_KEY = 'eat-settings:shader-s11-springy-venom';

const readStored = () => {
  try {
    return deserialiseEat(localStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return null;
  }
};

/* The Venom settings: the defaults in production, and in development the
   last setup from the panel, kept over a reload. */
const useEat = () => {
  const [eat, setEat] = useState<EatSettings>(() =>
    DEV ? (readStored() ?? EAT_DEFAULTS) : EAT_DEFAULTS,
  );
  useEffect(() => {
    if (!DEV) return;
    try {
      localStorage.setItem(STORAGE_KEY, serialiseEat(eat));
    } catch {
      // Storage can be off. The settings string still works.
    }
  }, [eat]);
  return [eat, setEat] as const;
};

type EatPanelProps = {
  eat: EatSettings;
  setEat: (eat: EatSettings) => void;
};

const EatPanel: FC<EatPanelProps> = ({ eat, setEat }) => {
  const [status, setStatus] = useState('');
  const serialised = serialiseEat(eat);
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
      const box = document.getElementById('eat-settings');
      if (box instanceof HTMLTextAreaElement) box.select();
      flash('press ctrl+c to copy');
    }
  };

  const load = () => {
    const parsed = deserialiseEat(draft);
    if (!parsed) {
      flash('not an eat-v1 string');
      return;
    }
    setEat(parsed);
    flash('loaded');
  };

  return (
    <details className={styles.panel} data-no-ripple open>
      <summary className={styles.title}>venom (temporary)</summary>
      <p className={styles.hint}>
        On projects, move the cursor toward the core beside the theme toggle.
        Changes apply live. Double-click a slider to reset it.
      </p>
      {EAT_DEFS.map((def) => (
        <label key={def.key} className={styles.slider} title={def.hint}>
          <span className={styles.name}>{def.label}</span>
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={eat[def.key]}
            onChange={(e) =>
              setEat({ ...eat, [def.key]: Number(e.target.value) })
            }
            onDoubleClick={() =>
              setEat({ ...eat, [def.key]: EAT_DEFAULTS[def.key] })
            }
          />
          <span
            className={
              eat[def.key] === EAT_DEFAULTS[def.key]
                ? styles.value
                : `${styles.value} ${styles.changed}`
            }
          >
            {eat[def.key]}
          </span>
        </label>
      ))}
      <label className={styles.heading} htmlFor="eat-settings">
        settings string
      </label>
      <textarea
        id="eat-settings"
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
        <button type="button" onClick={() => setEat(EAT_DEFAULTS)}>
          reset
        </button>
        <output className={styles.status}>{status}</output>
      </div>
    </details>
  );
};

export { EatPanel, useEat };
