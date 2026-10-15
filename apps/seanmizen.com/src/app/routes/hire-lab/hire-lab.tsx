import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { HireSettings } from '@/components/shader-ripple';
import {
  deserialiseHire,
  HIRE_DEFAULTS,
  HIRE_DEFS,
  MAX_MESSAGE,
  serialiseHire,
} from '@/components/shader-ripple';
import { Home } from '../home';
import styles from './hire-lab.module.css';

/* The settings string also lives in the URL hash, so a reload or a shared
   link comes back to the same setup. */
const readHash = () => {
  try {
    return deserialiseHire(decodeURIComponent(location.hash.slice(1)));
  } catch {
    return null;
  }
};

/* The real home page, with a small panel to tune its hire field. Open
   "projects" to see the reveal; close it to see it run back. */
const HireLab: FC = () => {
  const initial = useMemo(readHash, []);
  const [hire, setHire] = useState<HireSettings>(initial ?? HIRE_DEFAULTS);
  const [status, setStatus] = useState('');
  // Bumped by "restart" to remount the page: projects closed, no text, no
  // ripples, and a fresh portrait.
  const [run, setRun] = useState(0);

  const serialised = serialiseHire(hire);
  const [draft, setDraft] = useState(serialised);
  useEffect(() => {
    setDraft(serialised);
    try {
      history.replaceState(null, '', `#${encodeURIComponent(serialised)}`);
    } catch {
      // A sandboxed frame can refuse this. The string box still works.
    }
  }, [serialised]);

  const flash = (text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(''), 2000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serialised);
      flash('copied');
    } catch {
      const box = document.getElementById('hire-settings');
      if (box instanceof HTMLTextAreaElement) box.select();
      flash('press ctrl+c to copy');
    }
  };

  const load = () => {
    const parsed = deserialiseHire(draft);
    if (!parsed) {
      flash('not a hire-v1 string');
      return;
    }
    setHire(parsed);
    flash('loaded');
  };

  return (
    <>
      <Home key={run} hire={hire} />
      <details className={styles.panel} data-no-ripple open>
        <summary className={styles.title}>hire field</summary>
        <p className={styles.hint}>
          Open and close "projects" to see the reveal. Click anywhere for a
          ripple.
        </p>
        <label className={styles.inline}>
          message
          <input
            id="hire-message"
            type="text"
            value={hire.message}
            maxLength={MAX_MESSAGE}
            spellCheck={false}
            onChange={(e) =>
              setHire((h) => ({ ...h, message: e.target.value || ' ' }))
            }
          />
        </label>
        {HIRE_DEFS.map((def) => (
          <label key={def.key} className={styles.slider} title={def.hint}>
            <span className={styles.name}>{def.label}</span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={hire[def.key]}
              onChange={(e) =>
                setHire((h) => ({ ...h, [def.key]: Number(e.target.value) }))
              }
              onDoubleClick={() =>
                setHire((h) => ({ ...h, [def.key]: HIRE_DEFAULTS[def.key] }))
              }
            />
            <span
              className={
                hire[def.key] === HIRE_DEFAULTS[def.key]
                  ? styles.value
                  : `${styles.value} ${styles.changed}`
              }
            >
              {hire[def.key]}
            </span>
          </label>
        ))}
        <label className={styles.heading} htmlFor="hire-settings">
          settings string
        </label>
        <textarea
          id="hire-settings"
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
          <button type="button" onClick={() => setHire(HIRE_DEFAULTS)}>
            reset
          </button>
          <button type="button" onClick={() => setRun((r) => r + 1)}>
            restart
          </button>
          <output className={styles.status}>{status}</output>
        </div>
      </details>
    </>
  );
};

export { HireLab };
