"""Stage 06: the shrink and the throw run on one timeline, so navigation
reverses them from any point. `collapse` becomes `thrown`."""
from lib import apply

# The Edit-tool edits, against the Biome-formatted file.
apply('components/shader-ripple/shader-ripple.tsx', [
("""  /* While true, every dot of the face falls into a small core that pulses.
     When false, the dots burst back out into the face. */
  collapse?: boolean;
  /* How the core is thrown once it forms. Without it, the core stays in
     the middle. */
  flight?: FlightSettings;""",
"""  /* While true, the face is thrown: it flies to the bottom of the view and
     shrinks into a small pulsing core on the way. When false, it flies back
     and opens out into the face again. */
  thrown?: boolean;
  /* The throw's path and timing. */
  flight?: FlightSettings;"""),
("""/* The collapse: seconds to fall into the core, and to burst back out. */
const COLLAPSE_IN = 0.6;
const COLLAPSE_OUT = 0.9;
/* The core:""",
"""/* The core:"""),
("""    // The collapse: `c` runs from 0 (the face) to 1 (the core). Going in,
    // the dots fall faster and faster. Coming out, they burst and slow.
    const collapseState = {
      target: false,
      from: 0,
      c: 0,
      since: 0,
      duration: 1,
    };

    // The flight: `s` runs from 0 (the core in the middle) to 1 (landed).
    // `since` is when the current run started, or -1 while it is held.
    const flightState = { s: 0, from: 0, since: -1 };""",
"""    // The throw: `at` runs at a steady rate from 0 (the face in the middle)
    // to 1 (the core landed) while `thrown` is true, and back to 0 while it
    // is false. Everything the throw draws depends on `at` alone, so a turn
    // at any point plays the throw backward from there.
    const throwState = { at: 0 };"""),
("""      rethrow: () => {
        flightState.s = 0;
        flightState.since = -1;
      },""",
"""      rethrow: () => {
        throwState.at = 0;
      },"""),
("""      now += (Math.min(t - last, 100) / 1000) * p.timeScale;
      last = t;""",
"""      const gap = Math.min(t - last, 100) / 1000;
      now += gap * p.timeScale;
      last = t;"""),
("""      // The collapse follows `collapse`, in real seconds.
      const wantCollapse = Boolean(live.current.collapse);
      if (wantCollapse !== collapseState.target) {
        collapseState.target = wantCollapse;
        collapseState.from = collapseState.c;
        collapseState.since = realNow;
        const distance = wantCollapse ? 1 - collapseState.c : collapseState.c;
        collapseState.duration = Math.max(
          0.05,
          (wantCollapse ? COLLAPSE_IN : COLLAPSE_OUT) * distance,
        );
      }
      const fall = Math.min(
        1,
        (realNow - collapseState.since) / collapseState.duration,
      );
      const ease = collapseState.target ? easeInCubic : easeOutCubic;
      collapseState.c =
        collapseState.from +
        ((collapseState.target ? 1 : 0) - collapseState.from) * ease(fall);
      uniforms.u_collapse.value = collapseState.c;
      // Once the core has formed, it is thrown. Leaving holds it where it
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
      uniforms.u_coreAlpha.value = fade;""",
"""      // The throw moves `at` toward its end at a steady rate.
      const f = live.current.flight;
      const step = (live.current.thrown ? gap : -gap) / f.time;
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
        CORE_RADIUS * (1 + CORE_PULSE * wander(pace, 1));
      uniforms.u_coreAt.value.set(
        CORE_DRIFT * wander(pace, 2),
        CORE_DRIFT * wander(pace, 3),
      );"""),
("""      u_coreScale: { value: 1 },
      u_coreAlpha: { value: 1 },""",
"""      u_throwAt: { value: new THREE.Vector2() },
      u_throwScale: { value: 1 },
      u_throwAlpha: { value: 1 },"""),
])

# The python edits that followed.
apply('components/shader-ripple/shader-ripple.tsx', [
("import type { FlightSettings } from './flight';", "import type { FlightSettings } from './flight';\nimport { FLIGHT_DEFAULTS } from './flight';"),
("  collapse = false,\n  flight,\n", "  thrown = false,\n  flight = FLIGHT_DEFAULTS,\n"),
("    collapse,\n    flight,\n", "    thrown,\n    flight,\n", 2),
])

apply('components/shader-ripple/vert-stippling.glsl', [
("""uniform float u_collapse;  // 0: the face; 1: every dot pulled into the core
uniform float u_coreSize;  // the core's radius, in world units
uniform vec2 u_coreAt;     // the core's middle, in world units
uniform float u_coreScale; // the core's size in flight, against its size at the start
uniform float u_coreAlpha; // how strongly the core shows
""",
"""uniform float u_collapse;    // 0: the face; 1: every dot pulled into the core
uniform float u_coreSize;    // the core's radius, in world units
uniform vec2 u_coreAt;       // how far the core has wandered off its middle
uniform vec2 u_throwAt;      // where the throw has carried the shape, in world units
uniform float u_throwScale;  // the shape's size in flight, against its size at the start
uniform float u_throwAlpha;  // how strongly the shape shows in flight
"""),
("""// How strongly this dot shows. The core can fade in flight.
varying float v_alpha;""",
"""// How strongly this dot shows. The shape can fade in flight.
varying float v_alpha;"""),
("""        position.xy = mix(position.xy, core, u_collapse);
""",
"""        position.xy = mix(position.xy, core, u_collapse);

        // The throw carries the whole shape along its path and shrinks it,
        // as if it flew away from the viewer.
        position.xy = u_throwAt + position.xy * u_throwScale;
"""),
("""        // A dot in the core shrinks and fades with the core as it flies off.
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z * mix(1.0, u_coreScale, u_collapse);
        gl_Position = projectionMatrix * mvPosition;
        v_alpha = mix(1.0, u_coreAlpha, u_collapse);""",
"""        // Every dot shrinks and fades with the shape as it flies off.
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z * u_throwScale;
        gl_Position = projectionMatrix * mvPosition;
        v_alpha = u_throwAlpha;"""),
])

apply('components/shader-ripple/flight.ts', [
("""/* TEMPORARY: the core's flight, tuned live from the dev-only panel in
   app/flight-panel.tsx. When the values are settled, they become constants
   in shader-ripple.tsx, and this file and the panel go.

   On /projects the face falls into a core, and then the core is thrown: it
   rises by `arc`, falls to `margin` above the bottom of the view, and
   shrinks as it goes, as if it flew away from the viewer. */
type FlightSettings = {
  delay: number;
  time: number;""",
"""/* TEMPORARY: the throw, tuned live from the dev-only panel in
   app/flight-panel.tsx. When the values are settled, they become constants
   in shader-ripple.tsx, and this file and the panel go.

   On /projects the face is thrown: it rises by `arc`, falls to `margin`
   above the bottom of the view, and shrinks as it goes, as if it flew away
   from the viewer. On the way, it falls into a small core. */
type FlightSettings = {
  time: number;
  collapseBy: number;"""),
("""const FLIGHT_DEFAULTS: FlightSettings = {
  delay: 0.3,
  time: 1.4,""",
"""const FLIGHT_DEFAULTS: FlightSettings = {
  time: 1.4,
  collapseBy: 0.5,"""),
("""  {
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
  },""",
"""  {
    key: 'time',
    label: 'flight time',
    min: 0.2,
    max: 4,
    step: 0.05,
    hint: 'Seconds from the face in the middle to the core landed. The way back takes the same time.',
  },
  {
    key: 'collapseBy',
    label: 'core by',
    min: 0.05,
    max: 1,
    step: 0.01,
    hint: 'How far into the flight the face has fallen into its core. 0.5 is halfway, and 1 is on landing.',
  },"""),
])

apply('components/portrait/portrait.tsx', [
("""  /* While true, the face falls into a small pulsing core. */
  collapse?: boolean;
  /* How the core is thrown once it forms. */
  flight?: FlightSettings;""",
"""  /* While true, the face is thrown to the bottom of the view and shrinks
     into a small pulsing core on the way. */
  thrown?: boolean;
  /* The throw's path and timing. */
  flight?: FlightSettings;"""),
("  collapse = false,\n", "  thrown = false,\n"),
("        collapse={collapse}\n", "        thrown={thrown}\n"),
])

apply('app/app.tsx', [
("""   put. On /projects, the face falls into a core that is thrown to the
   bottom of the view, and the hire text fades in. */""",
"""   put. On /projects, the face is thrown to the bottom of the view and
   shrinks into a core on the way, and the hire text fades in. */"""),
("        collapse={onProjects}\n", "        thrown={onProjects}\n"),
])

apply('app/routes/hire-lab/hire-lab.tsx', [
("  const [collapse, setCollapse] = useState(true);", "  const [thrown, setThrown] = useState(true);"),
("collapse={collapse}", "thrown={thrown}"),
("""            checked={collapse}
            onChange={(e) => setCollapse(e.target.checked)}
          />
          collapse face""",
"""            checked={thrown}
            onChange={(e) => setThrown(e.target.checked)}
          />
          throw face"""),
])

apply('app/flight-panel.tsx', [
("""        Open projects, or press replay there, to see the throw. Changes apply
        live. Double-click a slider to reset it.""",
"""        Go between home and projects at any point to see the throw play
        forward and back. Replay throws it again from the middle. Changes
        apply live. Double-click a slider to reset it."""),
("<summary className={styles.title}>core flight (temporary)</summary>",
 "<summary className={styles.title}>throw (temporary)</summary>"),
])
