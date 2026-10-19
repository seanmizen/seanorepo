"""Stage 04: no face in the dot, a smaller core, an irregular pulse and a
small drift."""
from lib import apply

apply('components/shader-ripple/vert-stippling.glsl', [
("""uniform float u_collapse;  // 0: the face; 1: every dot pulled into the core
uniform float u_core;      // the core's size, against the face's
""",
"""uniform float u_collapse;  // 0: the face; 1: every dot pulled into the core
uniform float u_coreSize;  // the core's radius, in world units
uniform vec2 u_coreAt;     // the core's middle, in world units
"""),
("""        // The collapse pulls every dot in toward the middle, into the core.
        // The size above is read first, where the dot sits in the face.
        position.xy *= mix(1.0, u_core, u_collapse);
""",
"""        // The collapse pulls every dot to its own place in the core. That
        // place comes from the dot's index, not from the face, so no trace
        // of the face is left in the core. The size above is read first,
        // where the dot sits in the face.
        float angle = 6.2831853 * hash31(vec3(a_index, 1.0, 7.0));
        float reach = u_coreSize * sqrt(hash31(vec3(a_index, 2.0, 7.0)));
        vec2 core = u_coreAt + reach * vec2(cos(angle), sin(angle));
        position.xy = mix(position.xy, core, u_collapse);
"""),
])

apply('components/shader-ripple/shader-ripple.tsx', [
("""/* The core's size against the face's, how much it pulses, and the seconds
   for one pulse. */
const CORE = 0.07;
const CORE_PULSE = 0.25;
const PULSE_SECONDS = 1.8;

const easeInCubic""",
"""/* The core: its radius in world units (the face is about 8 across), how
   far its size wanders either way, and how far its middle wanders. */
const CORE_RADIUS = 0.15;
const CORE_THROB = 0.25;
const CORE_DRIFT = 0.07;
/* How fast the throb and the drift wander, in rough cycles a second. */
const CORE_PACE = 0.7;

/* Smooth noise from -1 to 1: two layers of value noise, so it never
   settles into a rhythm. Each `seed` gives its own stream. */
const wander = (t: number, seed: number) => {
  const layer = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const at = (n: number) => {
      const h = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
      return 2 * (h - Math.floor(h)) - 1;
    };
    return at(i) + (at(i + 1) - at(i)) * f * f * (3 - 2 * f);
  };
  return 0.65 * layer(t) + 0.35 * layer(2.3 * t + 17);
};

const easeInCubic"""),
("""      u_collapse: { value: 0 },
      u_core: { value: 1 },""",
"""      u_collapse: { value: 0 },
      u_coreSize: { value: CORE_RADIUS },
      u_coreAt: { value: new THREE.Vector2() },"""),
("""      uniforms.u_core.value =
        CORE *
        (1 + CORE_PULSE * Math.sin((2 * Math.PI * realNow) / PULSE_SECONDS));
""",
"""      const pace = realNow * CORE_PACE;
      uniforms.u_coreSize.value =
        CORE_RADIUS * (1 + CORE_THROB * wander(pace, 1));
      uniforms.u_coreAt.value.set(
        CORE_DRIFT * wander(pace, 2),
        CORE_DRIFT * wander(pace, 3),
      );
"""),
])
