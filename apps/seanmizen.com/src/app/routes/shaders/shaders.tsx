import type { FC } from 'react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HomeLink, ThemeToggle } from '@/components';
import type {
  RippleParams,
  ShaderRippleHandle,
  StageSettings,
} from '@/components/shader-ripple';
import {
  DEFAULTS,
  deserialise,
  GROUPS,
  PRESETS,
  ShaderRipple,
  SIM_SIZES,
  STAGE_DEFAULTS,
  serialise,
} from '@/components/shader-ripple';
import { ThemeContext } from '@/providers';
import styles from './shaders.module.css';

const CANVAS_SIZES = [300, 400, 500, 700, 900];

const COLOR_KEYS = [
  ['lightInk', 'light ink'],
  ['lightAccent', 'light ripple'],
  ['darkInk', 'dark ink'],
  ['darkAccent', 'dark ripple'],
] as const;

/* The settings string also lives in the URL hash, so a reload or a shared
   link comes back to the same setup. */
const readHash = () => {
  try {
    return deserialise(decodeURIComponent(location.hash.slice(1)));
  } catch {
    return null;
  }
};

const Shaders: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const initial = useMemo(readHash, []);
  const [params, setParams] = useState<RippleParams>(
    initial?.params ?? DEFAULTS,
  );
  const [stage, setStage] = useState<StageSettings>(
    initial?.stage ?? STAGE_DEFAULTS,
  );
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('');
  const shader = useRef<ShaderRippleHandle>(null);

  const serialised = serialise(params, stage);
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
      // No clipboard permission: select the text so ctrl+c works.
      const box = document.getElementById('ripple-settings');
      if (box instanceof HTMLTextAreaElement) box.select();
      flash('press ctrl+c to copy');
    }
  };

  const load = () => {
    const parsed = deserialise(draft);
    if (!parsed) {
      flash('not a ripple-v1 string');
      return;
    }
    setParams(parsed.params);
    setStage(parsed.stage);
    flash('loaded');
  };

  const set = <K extends keyof RippleParams>(key: K, value: RippleParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  return (
    <main className={styles.page}>
      <div className={styles.stage}>
        <ShaderRipple
          ref={shader}
          params={params}
          simSize={stage.simSize}
          size={stage.size}
          orbit={stage.orbit}
          onFps={setFps}
        />
        <p className={styles.tip}>
          click anywhere · drag to orbit · scroll to zoom
        </p>
      </div>

      <aside className={styles.panel} data-no-ripple aria-label="Controls">
        <header className={styles.header}>
          <h1 className={styles.title}>ripple playground</h1>
          <span className={styles.fps}>{fps.toFixed(0)} fps</span>
          <ThemeToggle mode={mode} toggleMode={toggleMode} />
        </header>

        <section className={styles.section}>
          <label className={styles.heading} htmlFor="ripple-settings">
            settings string
          </label>
          <textarea
            id="ripple-settings"
            className={styles.string}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            rows={5}
          />
          <div className={styles.row}>
            <button type="button" onClick={copy}>
              copy
            </button>
            <button
              type="button"
              onClick={load}
              disabled={draft === serialised}
            >
              load
            </button>
            <button
              type="button"
              onClick={() => {
                setParams(DEFAULTS);
                setStage(STAGE_DEFAULTS);
              }}
            >
              reset
            </button>
            <output className={styles.status}>{status}</output>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.row}>
            <label className={styles.inline}>
              preset
              <select
                value=""
                onChange={(e) => {
                  const preset = PRESETS[e.target.value];
                  if (preset) setParams({ ...DEFAULTS, ...preset });
                }}
              >
                <option value="" disabled>
                  choose…
                </option>
                {Object.keys(PRESETS).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.row}>
            <button type="button" onClick={() => shader.current?.burst(1)}>
              ripple
            </button>
            <button type="button" onClick={() => shader.current?.burst(5)}>
              burst ×5
            </button>
            <button type="button" onClick={() => shader.current?.clear()}>
              clear
            </button>
          </div>
        </section>

        <details className={styles.section}>
          <summary className={styles.heading}>stage</summary>
          <label className={styles.inline}>
            particles
            <select
              value={stage.simSize}
              onChange={(e) =>
                setStage((s) => ({ ...s, simSize: Number(e.target.value) }))
              }
            >
              {SIM_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n * n}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.inline}>
            canvas
            <select
              value={stage.size}
              onChange={(e) =>
                setStage((s) => ({ ...s, size: Number(e.target.value) }))
              }
            >
              {[...new Set([...CANVAS_SIZES, stage.size])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
            </select>
          </label>
          <label className={styles.inline}>
            <input
              type="checkbox"
              checked={stage.orbit}
              onChange={(e) =>
                setStage((s) => ({ ...s, orbit: e.target.checked }))
              }
            />
            orbit controls
          </label>
          <p className={styles.hint}>
            Particle count and canvas size rebuild the sim. More particles costs
            n² per frame.
          </p>
        </details>

        {GROUPS.map((group) => (
          <details key={group.title} className={styles.section} open>
            <summary className={styles.heading}>{group.title}</summary>
            {group.params.map((def) => (
              <label key={def.key} className={styles.slider} title={def.hint}>
                <span className={styles.name}>{def.label}</span>
                <input
                  type="range"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={params[def.key]}
                  onChange={(e) => set(def.key, Number(e.target.value))}
                  onDoubleClick={() => set(def.key, DEFAULTS[def.key])}
                />
                <span
                  className={
                    params[def.key] === DEFAULTS[def.key]
                      ? styles.value
                      : `${styles.value} ${styles.changed}`
                  }
                >
                  {params[def.key]}
                </span>
              </label>
            ))}
          </details>
        ))}

        <details className={styles.section} open>
          <summary className={styles.heading}>Colours</summary>
          {COLOR_KEYS.map(([key, label]) => (
            <label key={key} className={styles.slider}>
              <span className={styles.name}>{label}</span>
              <input
                type="color"
                value={params[key]}
                onChange={(e) => set(key, e.target.value)}
              />
              <span className={styles.value}>{params[key]}</span>
            </label>
          ))}
        </details>

        <p className={styles.hint}>
          Hover a slider for what it does. Double-click a slider to reset it.
          Changed values are highlighted.
        </p>
        <nav aria-label="Site">
          <HomeLink />
        </nav>
      </aside>
    </main>
  );
};

export { Shaders };
