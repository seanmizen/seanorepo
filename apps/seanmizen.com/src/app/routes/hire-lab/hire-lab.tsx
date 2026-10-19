import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Portrait } from '@/components';
import type { HireSettings } from '@/components/shader-ripple';
import {
  deserialiseHire,
  HIRE_DEFAULTS,
  HIRE_DEFS,
  MAX_MESSAGE,
  readHash,
  serialiseHire,
  writeHash,
} from '@/components/shader-ripple';
import { Projects } from '../projects';
import styles from './hire-lab.module.css';

/* The real projects page, with a small panel to tune its hire field. Turn
   "show text" off to see the text fade out, and on to see it fade in. */
const HireLab: FC = () => {
  const initial = useMemo(() => readHash(deserialiseHire), []);
  const [hire, setHire] = useState<HireSettings>(initial ?? HIRE_DEFAULTS);
  const [reveal, setReveal] = useState(true);
  const [thrown, setThrown] = useState(true);
  const [status, setStatus] = useState('');
  // Bumped by "restart" to remount the portrait: no text, no ripples, and a
  // fresh face. The text then fades in again.
  const [run, setRun] = useState(0);

  const serialised = serialiseHire(hire);
  const [draft, setDraft] = useState(serialised);
  useEffect(() => {
    setDraft(serialised);
    writeHash(serialised);
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
      <Projects />
      <Portrait key={run} hire={hire} reveal={reveal} thrown={thrown} />
      <details className={styles.panel} data-no-ripple open>
        <summary className={styles.title}>hire field</summary>
        <p className={styles.hint}>
          Turn "show text" off and on to see the fade. Click anywhere for a
          ripple.
        </p>
        <label className={styles.inline}>
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
          />
          show text
        </label>
        <label className={styles.inline}>
          <input
            type="checkbox"
            checked={thrown}
            onChange={(e) => setThrown(e.target.checked)}
          />
          throw face
        </label>
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
