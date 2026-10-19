"""Stage 05: the core is thrown to the bottom of the view, with a
temporary tuning panel. The theme toggle moves into the shared layout."""
from lib import apply, write

write('components/shader-ripple/flight.ts', """/* TEMPORARY: the core's flight, tuned live from the dev-only panel in
   app/flight-panel.tsx. When the values are settled, they become constants
   in shader-ripple.tsx, and this file and the panel go.

   On /projects the face falls into a core, and then the core is thrown: it
   rises by `arc`, falls to `margin` above the bottom of the view, and
   shrinks as it goes, as if it flew away from the viewer. */
type FlightSettings = {
  delay: number;
  time: number;
  arc: number;
  endX: number;
  endSize: number;
  endOpacity: number;
  margin: number;
};

type FlightDef = {
  key: keyof FlightSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

const FLIGHT_DEFAULTS: FlightSettings = {
  delay: 0.3,
  time: 1.4,
  arc: 140,
  endX: 0,
  endSize: 0.4,
  endOpacity: 1,
  margin: 27,
};

const FLIGHT_DEFS: FlightDef[] = [
  {
    key: 'delay',
    label: 'delay',
    min: 0,
    max: 3,
    step: 0.05,
    hint: 'Seconds from the core forming to the throw.',
  },
  {
    key: 'time',
    label: 'flight time',
    min: 0.2,
    max: 4,
    step: 0.05,
    hint: 'Seconds in the air.',
  },
  {
    key: 'arc',
    label: 'arc height',
    min: 0,
    max: 400,
    step: 5,
    hint: 'How far the core rises before it falls, in CSS pixels. 0 drops it straight down the curve.',
  },
  {
    key: 'endX',
    label: 'land x',
    min: -600,
    max: 600,
    step: 5,
    hint: 'Where the core lands, left or right of the middle, in CSS pixels.',
  },
  {
    key: 'endSize',
    label: 'land size',
    min: 0.05,
    max: 1,
    step: 0.01,
    hint: 'The core size when it lands, against its size at the start. Smaller looks further away.',
  },
  {
    key: 'endOpacity',
    label: 'land opacity',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How strongly the core shows when it lands. 0 makes it vanish.',
  },
  {
    key: 'margin',
    label: 'bottom margin',
    min: 0,
    max: 120,
    step: 1,
    hint: 'The gap below the landed core, in CSS pixels. The theme toggle box is 16 px up, and its icon is 27 px up.',
  },
];

const FLIGHT_PREFIX = 'flight-v1:';

const serialiseFlight = (flight: FlightSettings) =>
  FLIGHT_PREFIX + JSON.stringify(flight);

/* Read a string from serialiseFlight(). Unknown keys are dropped and
   numbers are clamped to their slider range. Returns null when the string
   is not one of ours. */
const deserialiseFlight = (text: string): FlightSettings | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(FLIGHT_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(FLIGHT_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const flight: FlightSettings = { ...FLIGHT_DEFAULTS };
  for (const def of FLIGHT_DEFS) {
    const v = input[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      flight[def.key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  return flight;
};

export type { FlightDef, FlightSettings };
export { deserialiseFlight, FLIGHT_DEFAULTS, FLIGHT_DEFS, serialiseFlight };
""")
write('components/shader-ripple/index.ts', """export * from './flight';
export * from './hire';
export * from './params';
export type { ShaderRippleHandle } from './shader-ripple';
export { ShaderRipple } from './shader-ripple';
""")

apply('components/shader-ripple/vert-stippling.glsl', [
("""uniform vec2 u_coreAt;     // the core's middle, in world units
""",
"""uniform vec2 u_coreAt;     // the core's middle, in world units
uniform float u_coreScale; // the core's size in flight, against its size at the start
uniform float u_coreAlpha; // how strongly the core shows
"""),
("""varying vec3 v_light;
""",
"""varying vec3 v_light;
// How strongly this dot shows. The core can fade in flight.
varying float v_alpha;
"""),
("""        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
    } else {
        // Vertex shader output
        v_light = vec3(0.0, 0.0, 1.0);
""",
"""        // A dot in the core shrinks and fades with the core as it flies off.
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z * mix(1.0, u_coreScale, u_collapse);
        gl_Position = projectionMatrix * mvPosition;
        v_alpha = mix(1.0, u_coreAlpha, u_collapse);
    } else {
        // Vertex shader output
        v_light = vec3(0.0, 0.0, 1.0);
        v_alpha = 0.0;
"""),
])

apply('components/shader-ripple/frag-stippling.glsl', [
("""varying vec3 v_light;
""",
"""varying vec3 v_light;
// From the vertex shader: how strongly this dot shows.
varying float v_alpha;
"""),
("""  gl_FragColor = vec4(color, a * bright);""",
"""  gl_FragColor = vec4(color, a * bright * v_alpha);"""),
])

apply('components/shader-ripple/shader-ripple.tsx', [
("""import type { HireSettings } from './hire';""",
"""import type { FlightSettings } from './flight';
import type { HireSettings } from './hire';"""),
("""  /* Forget every ripple in flight. */
  clear: () => void;
};""",
"""  /* Forget every ripple in flight. */
  clear: () => void;
  /* Put a formed core back in the middle and throw it again. */
  rethrow: () => void;
};"""),
("""     When false, the dots burst back out into the face. */
  collapse?: boolean;
""",
"""     When false, the dots burst back out into the face. */
  collapse?: boolean;
  /* How the core is thrown once it forms. Without it, the core stays in
     the middle. */
  flight?: FlightSettings;
"""),
("""/* The core: its radius in world units (the face is about 8 across), how
   far its size wanders either way, and how far its middle wanders. */
const CORE_RADIUS = 0.15;
const CORE_THROB = 0.25;
const CORE_DRIFT = 0.07;
/* How fast the throb and the drift wander, in rough cycles a second. */""",
"""/* The core: its radius in world units (the face is about 8 across), how
   much it pulses either way, and how far its middle wanders. */
const CORE_RADIUS = 0.15;
const CORE_PULSE = 0.25;
const CORE_DRIFT = 0.07;
/* How fast the pulse and the drift wander, in rough cycles a second. */"""),
("""  collapse = false,
  clearSelector,""",
"""  collapse = false,
  flight,
  clearSelector,"""),
("""    collapse,
    clearSelector,
    portraitScale,
  });""",
"""    collapse,
    flight,
    clearSelector,
    portraitScale,
  });"""),
("""    collapse,
    clearSelector,
    portraitScale,
  };""",
"""    collapse,
    flight,
    clearSelector,
    portraitScale,
  };"""),
("""  const api = useRef<ShaderRippleHandle>({ burst: () => {}, clear: () => {} });
  useImperativeHandle(ref, () => ({
    burst: (n, heart) => api.current.burst(n, heart),
    clear: () => api.current.clear(),
  }));""",
"""  const api = useRef<ShaderRippleHandle>({
    burst: () => {},
    clear: () => {},
    rethrow: () => {},
  });
  useImperativeHandle(ref, () => ({
    burst: (n, heart) => api.current.burst(n, heart),
    clear: () => api.current.clear(),
    rethrow: () => api.current.rethrow(),
  }));"""),
("""      u_coreAt: { value: new THREE.Vector2() },""",
"""      u_coreAt: { value: new THREE.Vector2() },
      u_coreScale: { value: 1 },
      u_coreAlpha: { value: 1 },"""),
("""    const collapseState = {
      target: false,
      from: 0,
      c: 0,
      since: 0,
      duration: 1,
    };
""",
"""    const collapseState = {
      target: false,
      from: 0,
      c: 0,
      since: 0,
      duration: 1,
    };

    // The flight: `s` runs from 0 (the core in the middle) to 1 (landed).
    // `since` is when the current run started, or -1 while it is held.
    const flightState = { s: 0, from: 0, since: -1 };
"""),
("""      clear: () => {
        nTaps = 0;
        rippleUniforms.u_tapCount.value = 0;
      },
    };""",
"""      clear: () => {
        nTaps = 0;
        rippleUniforms.u_tapCount.value = 0;
      },
      rethrow: () => {
        flightState.s = 0;
        flightState.since = -1;
      },
    };"""),
("""      const pace = realNow * CORE_PACE;
      uniforms.u_coreSize.value =
        CORE_RADIUS * (1 + CORE_THROB * wander(pace, 1));
      uniforms.u_coreAt.value.set(
        CORE_DRIFT * wander(pace, 2),
        CORE_DRIFT * wander(pace, 3),
      );
""",
"""      // Once the core has formed, it is thrown. Leaving holds it where it
      // is, so the face bursts back out from there. It goes back to the
      // middle once the face is whole again.
      const f = live.current.flight;
      if (f && collapseState.target && collapseState.c >= 1) {
        if (flightState.since < 0) {
          flightState.since = realNow;
          flightState.from = flightState.s;
        }
        const airborne = Math.max(0, realNow - flightState.since - f.delay);
        flightState.s = Math.min(1, flightState.from + airborne / f.time);
      } else {
        flightState.since = -1;
        if (!f || collapseState.c <= 0) flightState.s = 0;
      }

      // The path, in CSS pixels up from the middle: y = a s + b s^2 tops
      // out `arc` above the start and ends `drop` below it, and x moves at
      // a steady speed. The core shrinks as if it flew away at a steady
      // speed too.
      const s = flightState.s;
      let coreX = 0;
      let coreY = 0;
      let shrink = 1;
      let fade = 1;
      if (f && s > 0) {
        const worldPerPx = (2 * view.halfY) / view.h;
        shrink = 1 / (1 + s * (1 / f.endSize - 1));
        // The landed core's radius, plus half a dot.
        const endRadius =
          (CORE_RADIUS * f.endSize) / worldPerPx + f.endSize * view.scale;
        const drop = Math.max(0, view.h / 2 - f.margin - endRadius);
        const a = 2 * f.arc + 2 * Math.sqrt(f.arc * f.arc + f.arc * drop);
        const b = -drop - a;
        coreX = f.endX * s * worldPerPx;
        coreY = (a * s + b * s * s) * worldPerPx;
        fade = 1 + (f.endOpacity - 1) * s;
      }

      const pace = realNow * CORE_PACE;
      uniforms.u_coreSize.value =
        CORE_RADIUS * shrink * (1 + CORE_PULSE * wander(pace, 1));
      uniforms.u_coreAt.value.set(
        coreX + CORE_DRIFT * shrink * wander(pace, 2),
        coreY + CORE_DRIFT * shrink * wander(pace, 3),
      );
      uniforms.u_coreScale.value = shrink;
      uniforms.u_coreAlpha.value = fade;
"""),
])

write('components/portrait/portrait.tsx', """import type { FC, Ref } from 'react';
import { useMatchMedia } from '@/hooks';
import type {
  FlightSettings,
  HireSettings,
  ShaderRippleHandle,
} from '../shader-ripple';
import {
  FLIGHT_DEFAULTS,
  HIRE_DEFAULTS,
  HOME_PARAMS,
  ShaderRipple,
} from '../shader-ripple';

/* The page content the hire text keeps clear of. */
const CONTENT = 'main.container > :is(h1, h2, p, ul, nav)';

/* Below this width the portrait draws at half size. */
const NARROW = '(max-width: 880px)';

type PortraitProps = {
  /* The hire field's settings. The /shaders-hire playground passes its
     own to tune them on the real page. */
  hire?: HireSettings;
  /* While true, the hire text fades in. When false, it fades out. */
  reveal?: boolean;
  /* While true, the face falls into a small pulsing core. */
  collapse?: boolean;
  /* How the core is thrown once it forms. */
  flight?: FlightSettings;
  ref?: Ref<ShaderRippleHandle>;
};

/* The face behind the page, fixed to the viewport. Mount it in a layout
   route, and it keeps its particles and ripples across a navigation. */
const Portrait: FC<PortraitProps> = ({
  hire = HIRE_DEFAULTS,
  reveal = false,
  collapse = false,
  flight = FLIGHT_DEFAULTS,
  ref,
}) => {
  const narrow = useMatchMedia(NARROW);
  return (
    <div className="shader-container" aria-hidden="true">
      <ShaderRipple
        ref={ref}
        params={HOME_PARAMS}
        size={0}
        hire={hire}
        reveal={reveal}
        collapse={collapse}
        flight={flight}
        clearSelector={CONTENT}
        portraitScale={narrow ? 0.5 : 1}
      />
    </div>
  );
};

export { Portrait };
""")

write('app/flight-panel.tsx', """import type { FC } from 'react';
import { useEffect, useState } from 'react';
import type { FlightSettings } from '@/components/shader-ripple';
import {
  deserialiseFlight,
  FLIGHT_DEFAULTS,
  FLIGHT_DEFS,
  serialiseFlight,
} from '@/components/shader-ripple';
import styles from './routes/hire-lab/hire-lab.module.css';

/* TEMPORARY: a dev-only panel to tune the core's flight on the real pages.
   When the values are settled, they become constants, and this file goes
   (see components/shader-ripple/flight.ts). */

const DEV = process.env.NODE_ENV === 'development';
const STORAGE_KEY = 'flight-settings';

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
      <summary className={styles.title}>core flight (temporary)</summary>
      <p className={styles.hint}>
        Open projects, or press replay there, to see the throw. Changes apply
        live. Double-click a slider to reset it.
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
""")

write('app/app.tsx', """import type { FC } from 'react';
import { useContext, useRef } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  BrowserRouter as Router,
  Routes,
  useMatch,
} from 'react-router-dom';
import { LastUpdated, Portrait, ThemeToggle } from '@/components';
import type { ShaderRippleHandle } from '@/components/shader-ripple';
import { MapNetwork } from '@/features/Glasto/Map';
import { ThemeContext, ThemeProvider } from '@/providers';
import { FlightPanel, useFlight } from './flight-panel';
import { Cous, HireLab, Home, Projects, Shaders } from './routes';
import '../index.css';

/* What the home page and /projects share. It stays mounted as you move
   between them, so the face does not restart and the theme toggle stays
   put. On /projects, the face falls into a core that is thrown to the
   bottom of the view, and the hire text fades in. */
const Layout: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const onProjects = useMatch('/projects') !== null;
  const portrait = useRef<ShaderRippleHandle>(null);
  const [flight, setFlight] = useFlight();
  return (
    <>
      <Outlet />
      <Portrait
        ref={portrait}
        reveal={onProjects}
        collapse={onProjects}
        flight={flight}
      />
      <div className="bottom-right-controls">
        {!onProjects && (
          <LastUpdated
            apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo"
            branch="release"
          />
        )}
        <ThemeToggle mode={mode} toggleMode={toggleMode} />
      </div>
      <FlightPanel
        flight={flight}
        setFlight={setFlight}
        onReplay={() => portrait.current?.rethrow()}
      />
    </>
  );
};

const App: FC = () => {
  return (
    <ThemeProvider>
      <Router basename="/">
        <Routes>
          {/* The old name for /projects. Old links still land. */}
          <Route path="/apps" element={<Navigate to="/projects" replace />} />
          <Route path="/cous" element={<Cous />} />
          <Route path="/glasto" element={<MapNetwork />} />
          <Route path="/shaders" element={<Shaders />} />
          {/* One path segment: assets load from a relative prefix, so a nested
              path would ask for them under /shaders/. */}
          <Route path="/shaders-hire" element={<HireLab />} />
          <Route element={<Layout />}>
            <Route path="/projects" element={<Projects />} />
            <Route path="/*" element={<Home />} />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export { App };
""")

apply('app/routes/home/home.tsx', [
("""import { useContext, useState } from 'react';""", """import { useState } from 'react';"""),
("""import {
  Entity,
  EntityList,
  HomeLi,
  LastUpdated,
  Spacer,
  SSHModal,
  ThemeToggle,
} from '@/components';""", """import { Entity, EntityList, HomeLi, Spacer, SSHModal } from '@/components';"""),
("""import { useKeySequence } from '@/hooks';
import { ThemeContext } from '@/providers';
""", """import { useKeySequence } from '@/hooks';
"""),
("""  const { mode, toggleMode } = useContext(ThemeContext);
  const [isSSHModalOpen""", """  const [isSSHModalOpen"""),
("""      <Spacer />
      <div className="bottom-right-controls">
        <LastUpdated
          apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo"
          branch="release"
        />
        <ThemeToggle mode={mode} toggleMode={toggleMode} />
      </div>
      <SSHModal""", """      <Spacer />
      <SSHModal"""),
])
