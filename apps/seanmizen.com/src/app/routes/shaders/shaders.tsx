import type { FC } from 'react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SiteTitle, ThemeToggle } from '@/components';
import type {
  GlyphSet,
  RippleParams,
  ShaderRippleHandle,
  StageSettings,
} from '@/components/shader-ripple';
import {
  DEFAULTS,
  deserialise,
  GLYPH_SETS,
  GROUPS,
  MAX_MESSAGE,
  PRESETS,
  ShaderRipple,
  SIM_SIZES,
  STAGE_DEFAULTS,
  serialise,
} from '@/components/shader-ripple';
import { ThemeContext } from '@/providers';
import styles from './shaders.module.css';

/* 0 fills the stage. */
const CANVAS_SIZES = [0, 300, 400, 500, 700, 900];

const PRESET_NAMES = Object.keys(PRESETS);

/* The preset the params match exactly, or '' once a slider moves off it. */
const presetOf = (params: RippleParams) =>
  PRESET_NAMES.find((name) => {
    const preset: RippleParams = { ...DEFAULTS, ...PRESETS[name] };
    return (Object.keys(preset) as (keyof RippleParams)[]).every(
      (key) => preset[key] === params[key],
    );
  }) ?? '';

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
  // Bumped by "restart" to remount the shader with a fresh seed.
  const [run, setRun] = useState(0);

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

  const preset = presetOf(params);
  const applyPreset = (name: string) => {
    const values = PRESETS[name];
    if (values) setParams({ ...DEFAULTS, ...values });
  };
  // Step through the presets in order, wrapping at both ends. From custom
  // settings, step from the start of the list.
  const stepPreset = (by: number) => {
    const at = PRESET_NAMES.indexOf(preset);
    const from = at === -1 ? (by > 0 ? -1 : 0) : at;
    const n = PRESET_NAMES.length;
    applyPreset(PRESET_NAMES[(from + by + n) % n]);
  };

  const set = <K extends keyof RippleParams>(key: K, value: RippleParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  return (
    <main className={styles.page}>
      <div className={`container ${styles.crumbs}`} data-no-ripple>
        <SiteTitle path="projects/shaders" />
      </div>
      <div className={styles.stage}>
        <ShaderRipple
          key={run}
          ref={shader}
          params={params}
          simSize={stage.simSize}
          size={stage.size}
          onFps={setFps}
        />
        <p className={styles.tip}>click anywhere</p>
      </div>

      <aside className={styles.panel} data-no-ripple aria-label="Controls">
        <header className={styles.header}>
          <h2 className={styles.title}>ripple playground</h2>
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
            <button
              type="button"
              aria-label="Previous preset"
              onClick={() => stepPreset(-1)}
            >
              ‹
            </button>
            <label className={styles.inline}>
              preset
              <select
                id="ripple-preset"
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="" disabled>
                  custom
                </option>
                {PRESET_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label="Next preset"
              onClick={() => stepPreset(1)}
            >
              ›
            </button>
          </div>
          <div className={styles.row}>
            <button type="button" onClick={() => shader.current?.burst(1)}>
              ripple
            </button>
            <button type="button" onClick={() => shader.current?.burst(5)}>
              burst ×5
            </button>
            <button
              type="button"
              onClick={() => shader.current?.burst(1, true)}
            >
              heart
            </button>
            <button type="button" onClick={() => shader.current?.clear()}>
              clear
            </button>
            <button type="button" onClick={() => setRun((r) => r + 1)}>
              restart
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
                    {n === 0 ? 'fill' : `${n}px`}
                  </option>
                ))}
            </select>
          </label>
          <p className={styles.hint}>
            Particle count and canvas size rebuild the sim. More particles costs
            n² per frame.
          </p>
        </details>

        {GROUPS.map((group) => (
          <details key={group.title} className={styles.section} open>
            <summary className={styles.heading}>{group.title}</summary>
            {group.title === 'Glyph background' && (
              <>
                <label className={styles.inline}>
                  <input
                    type="checkbox"
                    checked={params.grid}
                    onChange={(e) => set('grid', e.target.checked)}
                  />
                  show glyph background
                </label>
                <label className={styles.inline}>
                  glyphs
                  <select
                    id="ripple-glyphs"
                    value={params.glyphs}
                    onChange={(e) => set('glyphs', e.target.value as GlyphSet)}
                  >
                    {(Object.keys(GLYPH_SETS) as GlyphSet[]).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                {params.glyphs === 'message' && (
                  <label className={styles.inline}>
                    message
                    <input
                      id="ripple-message"
                      type="text"
                      value={params.message}
                      maxLength={MAX_MESSAGE}
                      spellCheck={false}
                      onChange={(e) => set('message', e.target.value || ' ')}
                    />
                  </label>
                )}
                <p className={styles.hint}>
                  Tip: set the stage canvas to fill so the grid covers the page.
                  With the message set, end the message with a space so the
                  words do not run together.
                </p>
              </>
            )}
            {group.title === 'Spring back' && (
              <label
                className={styles.inline}
                title="On: a pushed particle springs back to exactly where the undisturbed sim puts it. Off: the push moves the sim itself, and the particles find a new arrangement."
              >
                <input
                  type="checkbox"
                  checked={params.springBack}
                  onChange={(e) => set('springBack', e.target.checked)}
                />
                spring back home
              </label>
            )}
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
      </aside>
    </main>
  );
};

export { Shaders };
