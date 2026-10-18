"""Stage 08: whole boxes in the mask for anything with a background, the
throw settings baked in, a landing slot beside the theme toggle, and
Venom: tendrils that reach for the cursor and a core that eats it."""
import os
from lib import apply, write

# --- vertex shader (Edit-tool edits) -------------------------------------
apply('components/shader-ripple/vert-stippling.glsl', [
("""uniform vec2 u_throwAt;      // where the throw has carried the shape, in world units
uniform float u_throwScale;  // the shape's size in flight, against its size at the start
uniform float u_throwAlpha;  // how strongly the shape shows in flight
uniform sampler2D u_contentMask;  // white where the page has content

// How strongly the passing ripples tint this particle
varying vec3 v_light;
// How strongly this dot shows. The shape can fade in flight.
varying float v_alpha;""",
"""uniform vec2 u_throwAt;      // where the throw has carried the shape, in world units
uniform sampler2D u_contentMask;  // white where the page has content

// Venom: tendrils from the core that reach for the cursor.
uniform vec2 u_cursor;         // the cursor, in world units
uniform float u_grab;          // 0: no tendrils; 1: their tips touch the cursor
uniform float u_tendrils;      // how many tendrils
uniform float u_tendrilShare;  // the share of the core's dots that make them
uniform float u_spread;        // how far they fan out, against their length
uniform float u_strand;        // a tendril's width at its root, in world units
uniform float u_wiggle;        // how far a tendril writhes, in world units

// How strongly the passing ripples tint this particle
varying vec3 v_light;
// How strongly this dot shows: not at all over the page's content.
varying float v_alpha;"""),
("""        // The throw carries the whole shape along its path and shrinks it,
        // as if it flew away from the viewer.
        position.xy = u_throwAt + position.xy * u_throwScale;""",
"""        // The throw carries the whole shape along its path.
        position.xy += u_throwAt;

        // Venom: a share of the core's dots leave it and reach for the
        // cursor, as a few curved tendrils that fan out and meet at the tip.
        // Each dot keeps its own tendril, its place along it (f, 0 at the
        // core) and its place across it.
        if (u_grab > 0.001 && hash31(vec3(a_index, 3.0, 7.0)) < u_tendrilShare) {
            float k = floor(hash31(vec3(a_index, 4.0, 7.0)) * u_tendrils);
            float f = hash31(vec3(a_index, 5.0, 7.0));
            vec2 root = u_throwAt + u_coreAt;
            vec2 tip = mix(root, u_cursor, u_grab);
            vec2 along = tip - root;
            vec2 side = vec2(-along.y, along.x);
            vec2 unitSide = side / max(length(side), 0.0001);
            float fan = u_tendrils > 1.0 ? 2.0 * k / (u_tendrils - 1.0) - 1.0 : 0.0;
            vec2 bend = root + 0.5 * along + fan * u_spread * side;
            vec2 onCurve = mix(mix(root, bend, f), mix(bend, tip, f), f);
            // Thick at the root and thin at the tip. A wave runs out along
            // the tendril, held still at both ends.
            float across = u_strand * (1.0 - f) * (hash31(vec3(a_index, 6.0, 7.0)) - 0.5);
            float writhe = u_wiggle * 4.0 * f * (1.0 - f) * sin(9.0 * f - 7.0 * u_now + 2.1 * k);
            onCurve += unitSide * (across + writhe);
            position.xy = mix(position.xy, onCurve, u_collapse);
        }"""),
("""        // Vertex shader output
        // Every dot shrinks and fades with the shape as it flies off.
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z * u_throwScale;
        gl_Position = projectionMatrix * mvPosition;

        // A dot fades out where the page has content.
        vec2 screen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
        v_alpha = u_throwAlpha * (1.0 - texture2D(u_contentMask, screen).r);""",
"""        // Vertex shader output
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;

        // A dot fades out where the page has content.
        vec2 screen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
        v_alpha = 1.0 - texture2D(u_contentMask, screen).r;"""),
])

apply('components/shader-ripple/frag-stippling.glsl', [
("// From the vertex shader: how strongly this dot shows.\n",
 "// From the vertex shader: how strongly this dot shows. It is 0 over the\n// page's content.\n"),
])

# --- settings: flight goes, eat comes ------------------------------------
os.remove('components/shader-ripple/flight.ts')
os.remove('app/flight-panel.tsx')
write('components/shader-ripple/eat.ts', """/* TEMPORARY: the Venom effect, tuned live from the dev-only panel in
   app/eat-panel.tsx. When the values are settled, they become constants in
   shader-ripple.tsx, and this file and the panel go.

   Once the thrown core has landed, a few tendrils reach out of it for a
   cursor that comes near. A cursor that comes closer still is eaten: it is
   hidden until it moves away again. */
type EatSettings = {
  reach: number;
  eatRadius: number;
  release: number;
  lunge: number;
  tendrils: number;
  share: number;
  spread: number;
  strand: number;
  wiggle: number;
  gulp: number;
};

type EatDef = {
  key: keyof EatSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

const EAT_DEFAULTS: EatSettings = {
  reach: 120,
  eatRadius: 14,
  release: 28,
  lunge: 10,
  tendrils: 3,
  share: 0.15,
  spread: 0.3,
  strand: 3,
  wiggle: 4,
  gulp: 1,
};

const EAT_DEFS: EatDef[] = [
  {
    key: 'reach',
    label: 'reach',
    min: 20,
    max: 400,
    step: 5,
    hint: 'The tendrils reach for a cursor inside this distance from the core, in CSS pixels.',
  },
  {
    key: 'eatRadius',
    label: 'eat radius',
    min: 2,
    max: 60,
    step: 1,
    hint: 'The core eats a cursor inside this distance, in CSS pixels. The theme toggle starts 32 px from the core.',
  },
  {
    key: 'release',
    label: 'release',
    min: 4,
    max: 120,
    step: 1,
    hint: 'An eaten cursor comes back out past this distance, in CSS pixels. Keep it under 32, or the cursor stays hidden over the theme toggle.',
  },
  {
    key: 'lunge',
    label: 'lunge speed',
    min: 1,
    max: 40,
    step: 0.5,
    hint: 'How fast the tendrils reach out and pull back. Higher is snappier.',
  },
  {
    key: 'tendrils',
    label: 'tendrils',
    min: 1,
    max: 8,
    step: 1,
    hint: 'How many tendrils reach for the cursor.',
  },
  {
    key: 'share',
    label: 'dots in tendrils',
    min: 0.02,
    max: 0.6,
    step: 0.01,
    hint: 'The share of the core dots that leave it to make the tendrils.',
  },
  {
    key: 'spread',
    label: 'spread',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How far the tendrils fan out on the way, against their length. 0 makes one straight strand.',
  },
  {
    key: 'strand',
    label: 'thickness',
    min: 0,
    max: 12,
    step: 0.5,
    hint: 'How wide a tendril is at the core, in CSS pixels. It thins to a point at the tip.',
  },
  {
    key: 'wiggle',
    label: 'writhe',
    min: 0,
    max: 20,
    step: 0.5,
    hint: 'How far a tendril writhes from side to side, in CSS pixels.',
  },
  {
    key: 'gulp',
    label: 'gulp',
    min: 0,
    max: 4,
    step: 0.05,
    hint: 'How much the core swells for a moment when it eats the cursor. 1 doubles its size.',
  },
];

const EAT_PREFIX = 'eat-v1:';

const serialiseEat = (eat: EatSettings) => EAT_PREFIX + JSON.stringify(eat);

/* Read a string from serialiseEat(). Unknown keys are dropped and numbers
   are clamped to their slider range. Returns null when the string is not
   one of ours. */
const deserialiseEat = (text: string): EatSettings | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(EAT_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(EAT_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const eat: EatSettings = { ...EAT_DEFAULTS };
  for (const def of EAT_DEFS) {
    const v = input[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      eat[def.key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  return eat;
};

export type { EatDef, EatSettings };
export { deserialiseEat, EAT_DEFAULTS, EAT_DEFS, serialiseEat };
""")
apply('components/shader-ripple/index.ts', [
("export * from './flight';", "export * from './eat';"),
])

# --- the component ---------------------------------------------------------
apply('components/shader-ripple/shader-ripple.tsx', [
("""import type { FC, Ref } from 'react';""", """import type { FC, Ref, RefObject } from 'react';"""),
("""import type { FlightSettings } from './flight';
import { FLIGHT_DEFAULTS } from './flight';
""", """import type { EatSettings } from './eat';
"""),
("""  /* Forget every ripple in flight. */
  clear: () => void;
  /* Put a formed core back in the middle and throw it again. */
  rethrow: () => void;
};""", """  /* Forget every ripple in flight. */
  clear: () => void;
};"""),
("""  /* While true, the face is thrown: it flies to the bottom of the view and
     shrinks into a small pulsing core on the way. When false, it flies back
     and opens out into the face again. */
  thrown?: boolean;
  /* The throw's path and timing. */
  flight?: FlightSettings;""",
"""  /* While true, the face is thrown: it flies to `landing` and shrinks into
     a small pulsing core on the way. When false, it flies back and opens
     out into the face again. */
  thrown?: boolean;
  /* The core lands in the middle of this element. Without it, or while it
     has no size, the core lands near the bottom middle of the view. */
  landing?: RefObject<HTMLElement | null>;
  /* Venom: once the core has landed, it reaches for the cursor and eats
     it. Without it, the core leaves the cursor alone. */
  eat?: EatSettings;"""),
("""/* The core: its radius in world units""",
"""/* The throw: seconds from the face in the middle to the core landed (the
   way back takes the same), how far into it the face has become the core,
   and how far the core rises before it falls, in CSS pixels. */
const THROW_TIME = 0.35;
const CORE_BY = 0.25;
const THROW_ARC = 90;
/* With no landing element, the core lands this far above the bottom middle
   of the view, in CSS pixels. */
const LAND_FALLBACK = 40;

/* Set on the root element while the core has eaten the cursor. index.css
   hides the cursor for it. */
const EATEN_CLASS = 'cursor-eaten';

/* The core: its radius in world units"""),
("""const MASK_ELEMENTS = 'img, svg, video, input, button, select, textarea';""",
"""const MASK_ELEMENTS = 'img, svg, video, input, button, select, textarea';
/* The computed background of an element that paints none. */
const NO_BACKGROUND = 'rgba(0, 0, 0, 0)';"""),
("""const easeInCubic = (x: number) => x ** 3;""",
"""const easeInCubic = (x: number) => x ** 3;
const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};"""),
("""  thrown = false,
  flight = FLIGHT_DEFAULTS,
  clearOfContent = false,""",
"""  thrown = false,
  landing,
  eat,
  clearOfContent = false,"""),
("""    thrown,
    flight,
    clearOfContent,
    portraitScale,
  });""", """    thrown,
    landing,
    eat,
    clearOfContent,
    portraitScale,
  });"""),
("""    thrown,
    flight,
    clearOfContent,
    portraitScale,
  };""", """    thrown,
    landing,
    eat,
    clearOfContent,
    portraitScale,
  };"""),
("""  const api = useRef<ShaderRippleHandle>({
    burst: () => {},
    clear: () => {},
    rethrow: () => {},
  });
  useImperativeHandle(ref, () => ({
    burst: (n, heart) => api.current.burst(n, heart),
    clear: () => api.current.clear(),
    rethrow: () => api.current.rethrow(),
  }));""",
"""  const api = useRef<ShaderRippleHandle>({ burst: () => {}, clear: () => {} });
  useImperativeHandle(ref, () => ({
    burst: (n, heart) => api.current.burst(n, heart),
    clear: () => api.current.clear(),
  }));"""),
("""      for (const el of document.querySelectorAll(MASK_ELEMENTS)) {
        fill(el.getBoundingClientRect());
      }""",
"""      // One whole box for each control, icon and image, and for anything
      // that paints its own background, such as a code block or a swatch.
      for (const el of document.body.getElementsByTagName('*')) {
        if (
          el.matches(MASK_ELEMENTS) ||
          getComputedStyle(el).backgroundColor !== NO_BACKGROUND
        ) {
          fill(el.getBoundingClientRect());
        }
      }"""),
("""      u_throwAt: { value: new THREE.Vector2() },
      u_throwScale: { value: 1 },
      u_throwAlpha: { value: 1 },""",
"""      u_throwAt: { value: new THREE.Vector2() },
      u_cursor: { value: new THREE.Vector2() },
      u_grab: { value: 0 },
      u_tendrils: { value: 1 },
      u_tendrilShare: { value: 0 },
      u_spread: { value: 0 },
      u_strand: { value: 0 },
      u_wiggle: { value: 0 },"""),
("""    // `thrown` is the value from the last frame, to see the face turn for
    // home.
    const throwState = { at: 0, thrown: false };
""",
"""    // `thrown` is the value from the last frame, to see the face turn for
    // home.
    const throwState = { at: 0, thrown: false };

    // Where the core lands, in CSS pixels from the canvas's top left. It
    // keeps the last place it saw, so the way back still has a start once
    // the landing element is gone.
    const land = { x: 0, y: 0, seen: false };

    // Venom: how far the tendrils reach (0 to 1), whether the core has
    // eaten the cursor, and when it last ate it, in real seconds.
    const eatState = { grab: 0, eaten: false, gulpAt: -1e9 };

    // The cursor, in client pixels. Touch has no cursor to eat.
    const pointer = { x: 0, y: 0, in: false };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.in = true;
    };
    const onPointerLeave = () => {
      pointer.in = false;
    };
    window.addEventListener('pointermove', onPointerMove);
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
"""),
("""      clear: () => {
        nTaps = 0;
        rippleUniforms.u_tapCount.value = 0;
      },
      rethrow: () => {
        throwState.at = 0;
      },
    };""",
"""      clear: () => {
        nTaps = 0;
        rippleUniforms.u_tapCount.value = 0;
      },
    };"""),
("""      // The throw moves `at` toward its end at a steady rate.
      const f = live.current.flight;
      const thrown = live.current.thrown;
      if (throwState.thrown && !thrown) faceTaps.u_tapsFrom.value = now;
      throwState.thrown = thrown;
      const step = (thrown ? gap : -gap) / f.time;
      throwState.at = Math.min(1, Math.max(0, throwState.at + step));
      const at = throwState.at;

      // The face falls into its core by `collapseBy` of the way: slowly at
      // first, then faster and faster. Played backward, it bursts out fast
      // and slows.
      uniforms.u_collapse.value = easeInCubic(Math.min(1, at / f.collapseBy));

      // The path, in CSS pixels up from the middle: y = a at + b at^2 tops
      // out `arc` above the start and ends `drop` below it, and x moves at
      // a steady speed. The whole shape shrinks as if it flew away at a
      // steady speed too.
      let throwX = 0;
      let throwY = 0;
      if (at > 0) {
        const worldPerPx = (2 * view.halfY) / view.h;
        // The landed core's radius, plus half a dot.
        const endRadius =
          (CORE_RADIUS * f.endSize) / worldPerPx + f.endSize * view.scale;
        const drop = Math.max(0, view.h / 2 - f.margin - endRadius);
        const a = 2 * f.arc + 2 * Math.sqrt(f.arc * f.arc + f.arc * drop);
        const b = -drop - a;
        throwX = f.endX * at * worldPerPx;
        throwY = (a * at + b * at * at) * worldPerPx;
      }
      uniforms.u_throwAt.value.set(throwX, throwY);
      uniforms.u_throwScale.value = 1 / (1 + at * (1 / f.endSize - 1));
      uniforms.u_throwAlpha.value = 1 + (f.endOpacity - 1) * at;

      // The core pulses and wanders about its middle.
      const pace = realNow * CORE_PACE;
      uniforms.u_coreSize.value =
        CORE_RADIUS * (1 + CORE_PULSE * wander(pace, 1));""",
"""      // The throw moves `at` toward its end at a steady rate.
      const thrown = live.current.thrown;
      if (throwState.thrown && !thrown) faceTaps.u_tapsFrom.value = now;
      throwState.thrown = thrown;
      const step = (thrown ? gap : -gap) / THROW_TIME;
      throwState.at = Math.min(1, Math.max(0, throwState.at + step));
      const at = throwState.at;

      // The face falls into its core by CORE_BY of the way: slowly at
      // first, then faster and faster. Played backward, it bursts out fast
      // and slows.
      uniforms.u_collapse.value = easeInCubic(Math.min(1, at / CORE_BY));

      const bounds = renderer.domElement.getBoundingClientRect();
      const worldPerPx = (2 * view.halfY) / Math.max(view.h, 1);
      const slot = live.current.landing?.current;
      if (slot) {
        const box = slot.getBoundingClientRect();
        land.seen = box.width > 0;
        land.x = box.left + box.width / 2 - bounds.left;
        land.y = box.top + box.height / 2 - bounds.top;
      }
      if (!land.seen) {
        land.x = view.w / 2;
        land.y = view.h - LAND_FALLBACK;
      }

      // The path, in CSS pixels from the middle with y up: x moves at a
      // steady speed, and y = a at + b at^2 tops out THROW_ARC above the
      // start and ends `drop` below it.
      const drop = Math.max(0, land.y - view.h / 2);
      const a =
        2 * THROW_ARC + 2 * Math.sqrt(THROW_ARC * THROW_ARC + THROW_ARC * drop);
      const b = -drop - a;
      uniforms.u_throwAt.value.set(
        (land.x - view.w / 2) * at * worldPerPx,
        (a * at + b * at * at) * worldPerPx,
      );

      // Venom: once the core has landed, its tendrils reach for a cursor
      // that comes inside `reach`, and touch it at `eatRadius`. There the
      // core eats the cursor: the tendrils pull back, the core gulps, and
      // the cursor stays hidden until it moves out past `release`.
      const e = live.current.eat;
      let reachFor = 0;
      if (e && at >= 1 && pointer.in) {
        const d = Math.hypot(
          pointer.x - bounds.left - land.x,
          pointer.y - bounds.top - land.y,
        );
        if (eatState.eaten ? d > e.release : d < e.eatRadius) {
          eatState.eaten = !eatState.eaten;
          if (eatState.eaten) eatState.gulpAt = realNow;
        }
        if (!eatState.eaten) reachFor = smoothstep(e.reach, e.eatRadius, d);
      } else {
        eatState.eaten = false;
      }
      document.documentElement.classList.toggle(EATEN_CLASS, eatState.eaten);
      eatState.grab +=
        (reachFor - eatState.grab) * (1 - Math.exp(-gap * (e?.lunge ?? 10)));
      uniforms.u_grab.value = eatState.grab;
      uniforms.u_cursor.value.set(
        (pointer.x - bounds.left - view.w / 2) * worldPerPx,
        (view.h / 2 - (pointer.y - bounds.top)) * worldPerPx,
      );
      if (e) {
        uniforms.u_tendrils.value = e.tendrils;
        uniforms.u_tendrilShare.value = e.share;
        uniforms.u_spread.value = e.spread;
        uniforms.u_strand.value = e.strand * worldPerPx;
        uniforms.u_wiggle.value = e.wiggle * worldPerPx;
      }
      // The gulp: a quick swell that dies away.
      const sinceGulp = realNow - eatState.gulpAt;
      const gulp =
        (e?.gulp ?? 0) * Math.min(1, sinceGulp * 25) * Math.exp(-sinceGulp * 7);

      // The core pulses and wanders about its middle.
      const pace = realNow * CORE_PACE;
      uniforms.u_coreSize.value =
        CORE_RADIUS * (1 + CORE_PULSE * wander(pace, 1)) * (1 + gulp);"""),
("""      window.removeEventListener('click', startRipple, true);""",
"""      window.removeEventListener('click', startRipple, true);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener(
        'pointerleave',
        onPointerLeave,
      );
      document.documentElement.classList.remove(EATEN_CLASS);"""),
])

# --- portrait, layout, CSS, panel ------------------------------------------
apply('components/portrait/portrait.tsx', [
("""import type { FC, Ref } from 'react';""", """import type { FC, Ref, RefObject } from 'react';"""),
("""import type {
  FlightSettings,
  HireSettings,
  ShaderRippleHandle,
} from '../shader-ripple';
import {
  FLIGHT_DEFAULTS,
  HIRE_DEFAULTS,
  HOME_PARAMS,
  ShaderRipple,
} from '../shader-ripple';""",
"""import type {
  EatSettings,
  HireSettings,
  ShaderRippleHandle,
} from '../shader-ripple';
import {
  EAT_DEFAULTS,
  HIRE_DEFAULTS,
  HOME_PARAMS,
  ShaderRipple,
} from '../shader-ripple';"""),
("""  /* While true, the face is thrown to the bottom of the view and shrinks
     into a small pulsing core on the way. */
  thrown?: boolean;
  /* The throw's path and timing. */
  flight?: FlightSettings;""",
"""  /* While true, the face is thrown to `landing` and shrinks into a small
     pulsing core on the way. */
  thrown?: boolean;
  /* The element the core lands in the middle of. */
  landing?: RefObject<HTMLElement | null>;
  /* How the landed core reaches for the cursor and eats it. */
  eat?: EatSettings;"""),
("""  flight = FLIGHT_DEFAULTS,
  ref,""", """  landing,
  eat = EAT_DEFAULTS,
  ref,"""),
("""        flight={flight}
""", """        landing={landing}
        eat={eat}
"""),
])

apply('app/app.tsx', [
("""import { FlightPanel, useFlight } from './flight-panel';""", """import { EatPanel, useEat } from './eat-panel';"""),
("""/* What the home page and /projects share. It stays mounted as you move
   between them, so the face does not restart and the theme toggle stays
   put. On /projects, the face is thrown to the bottom of the view and
   shrinks into a core on the way, and the hire text fades in. */
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
        thrown={onProjects}
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
};""",
"""/* What the home page and /projects share. It stays mounted as you move
   between them, so the face does not restart and the theme toggle stays
   put. On /projects, the face is thrown into the slot beside the theme
   toggle and shrinks into a core on the way, and the hire text fades in. */
const Layout: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const onProjects = useMatch('/projects') !== null;
  const slot = useRef<HTMLSpanElement>(null);
  const [eat, setEat] = useEat();
  return (
    <>
      <Outlet />
      <Portrait
        reveal={onProjects}
        thrown={onProjects}
        landing={slot}
        eat={eat}
      />
      <div className="bottom-right-controls">
        {!onProjects && (
          <LastUpdated
            apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo"
            branch="release"
          />
        )}
        {onProjects && (
          <span ref={slot} className="singularity-slot" aria-hidden="true" />
        )}
        <ThemeToggle mode={mode} toggleMode={toggleMode} />
      </div>
      <EatPanel eat={eat} setEat={setEat} />
    </>
  );
};"""),
("import type { ShaderRippleHandle } from '@/components/shader-ripple';\n", ""),
])

apply('index.css', [
(""".bottom-right-controls {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
  z-index: 10;
}""",
""".bottom-right-controls {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
  z-index: 10;
}

/* Where the thrown face lands on /projects: an empty space the size of the
   theme toggle, to its left, as if it were one more button. */
.singularity-slot {
  width: 40px;
  height: 40px;
  padding: 0;
}

/* The core on /projects has eaten the cursor. :root lifts this above the
   one-class rules that set a cursor, such as a button's pointer. */
:root.cursor-eaten,
:root.cursor-eaten * {
  cursor: none;
}"""),
])

write('app/eat-panel.tsx', """import type { FC } from 'react';
import { useEffect, useState } from 'react';
import type { EatSettings } from '@/components/shader-ripple';
import {
  deserialiseEat,
  EAT_DEFAULTS,
  EAT_DEFS,
  serialiseEat,
} from '@/components/shader-ripple';
import styles from './routes/hire-lab/hire-lab.module.css';

/* TEMPORARY: a dev-only panel to tune the Venom effect on /projects. When
   the values are settled, they become constants, and this file goes (see
   components/shader-ripple/eat.ts). */

const DEV = process.env.NODE_ENV === 'development';
const STORAGE_KEY = 'eat-settings';

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
            onChange={(e) => setEat({ ...eat, [def.key]: Number(e.target.value) })}
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
""")

# --- the tendril fixes ------------------------------------------------------
apply('components/shader-ripple/vert-stippling.glsl', [
("""            onCurve += unitSide * (across + writhe);
            position.xy = mix(position.xy, onCurve, u_collapse);""",
"""            onCurve += unitSide * (across + writhe);
            position.xy = mix(position.xy, onCurve, u_collapse);
            // The face sizes a dot by how dark its place in the photo is,
            // which leaves most dots too small to see once spread out. In a
            // tendril every dot takes one size.
            relativeSize = mix(relativeSize, 0.8, u_collapse);"""),
("""// Particle index attribute
attribute float a_index;
""",
"""// Particle index attribute
attribute float a_index;
// Four random numbers from 0 to 1, independent of each other, fixed per
// particle. The index hashes are fine one at a time, but they are all
// made from the same number, so two of them together fall into clumps.
attribute vec4 a_random;
"""),
("""        if (u_grab > 0.001 && hash31(vec3(a_index, 3.0, 7.0)) < u_tendrilShare) {
            float k = floor(hash31(vec3(a_index, 4.0, 7.0)) * u_tendrils);
            float f = hash31(vec3(a_index, 5.0, 7.0));""",
"""        if (u_grab > 0.001 && a_random.x < u_tendrilShare) {
            float k = floor(a_random.y * u_tendrils);
            float f = a_random.z;"""),
("""            float across = u_strand * (1.0 - f) * (hash31(vec3(a_index, 6.0, 7.0)) - 0.5);""",
"""            float across = u_strand * (1.0 - f) * (a_random.w - 0.5);"""),
])
apply('components/shader-ripple/shader-ripple.tsx', [
("""    geometry.setAttribute('a_index', new THREE.BufferAttribute(indices, 1));""",
"""    geometry.setAttribute('a_index', new THREE.BufferAttribute(indices, 1));
    const random = new Float32Array(4 * n);
    for (let i = 0; i < random.length; i++) random[i] = Math.random();
    geometry.setAttribute('a_random', new THREE.BufferAttribute(random, 4));"""),
])
