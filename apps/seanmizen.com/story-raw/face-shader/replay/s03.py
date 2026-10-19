"""Stage 03: the dots shrink into a pulsing singularity on /projects."""
from lib import apply

apply('components/shader-ripple/vert-stippling.glsl', [
("""uniform float u_swell;  // how much a roused particle grows
""",
"""uniform float u_swell;  // how much a roused particle grows
uniform float u_collapse;  // 0: the face; 1: every dot pulled into the core
uniform float u_core;      // the core's size, against the face's
"""),
("""        position.xy += texture2D(u_offsetTexture, uv).xy;

        // Calculate the model view position
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // Calculate the particle relative size based on the background texture color
        vec3 bgColor = get_background_color(position);
        float relativeSize = 1.0 - 0.3 * dot(bgColor, vec3(1.0));
""",
"""        position.xy += texture2D(u_offsetTexture, uv).xy;

        // Calculate the particle relative size based on the background texture color
        vec3 bgColor = get_background_color(position);
        float relativeSize = 1.0 - 0.3 * dot(bgColor, vec3(1.0));

        // The collapse pulls every dot in toward the middle, into the core.
        // The size above is read first, where the dot sits in the face.
        position.xy *= mix(1.0, u_core, u_collapse);

        // Calculate the model view position
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
"""),
])

apply('components/shader-ripple/shader-ripple.tsx', [
("""  hire?: HireSettings;
  reveal?: boolean;
""",
"""  hire?: HireSettings;
  reveal?: boolean;
  /* While true, every dot of the face falls into a small core that pulses.
     When false, the dots burst back out into the face. */
  collapse?: boolean;
"""),
("""const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
""",
"""/* The collapse: seconds to fall into the core, and to burst back out. */
const COLLAPSE_IN = 0.6;
const COLLAPSE_OUT = 0.9;
/* The core's size against the face's, how much it pulses, and the seconds
   for one pulse. */
const CORE = 0.07;
const CORE_PULSE = 0.25;
const PULSE_SECONDS = 1.8;

const easeInCubic = (x: number) => x ** 3;
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
"""),
("""  reveal = false,
  clearSelector,""",
"""  reveal = false,
  collapse = false,
  clearSelector,"""),
("""    hire,
    reveal,
    clearSelector,
    portraitScale,
  });""",
"""    hire,
    reveal,
    collapse,
    clearSelector,
    portraitScale,
  });"""),
("""    hire,
    reveal,
    clearSelector,
    portraitScale,
  };""",
"""    hire,
    reveal,
    collapse,
    clearSelector,
    portraitScale,
  };"""),
("""      u_swell: { value: 0 },
      u_rest: { value: 1 },""",
"""      u_swell: { value: 0 },
      u_collapse: { value: 0 },
      u_core: { value: 1 },
      u_rest: { value: 1 },"""),
("""    const revealState = {
      target: false,
      from: 0,
      r: 0,
      since: 0,
      duration: 1,
    };
""",
"""    const revealState = {
      target: false,
      from: 0,
      r: 0,
      since: 0,
      duration: 1,
    };

    // The collapse: `c` runs from 0 (the face) to 1 (the core). Going in,
    // the dots fall faster and faster. Coming out, they burst and slow.
    const collapseState = {
      target: false,
      from: 0,
      c: 0,
      since: 0,
      duration: 1,
    };
"""),
("""      revealState.r =
        revealState.from +
        ((revealState.target ? 1 : 0) - revealState.from) *
          easeOutCubic(progress);
""",
"""      revealState.r =
        revealState.from +
        ((revealState.target ? 1 : 0) - revealState.from) *
          easeOutCubic(progress);

      // The collapse follows `collapse`, in real seconds.
      const wantCollapse = Boolean(live.current.collapse);
      if (wantCollapse !== collapseState.target) {
        collapseState.target = wantCollapse;
        collapseState.from = collapseState.c;
        collapseState.since = realNow;
        const distance = wantCollapse
          ? 1 - collapseState.c
          : collapseState.c;
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
      uniforms.u_core.value =
        CORE *
        (1 + CORE_PULSE * Math.sin((2 * Math.PI * realNow) / PULSE_SECONDS));
"""),
])

apply('components/portrait/portrait.tsx', [
("""  /* While true, the hire text fades in. When false, it fades out. */
  reveal?: boolean;
};""",
"""  /* While true, the hire text fades in. When false, it fades out. */
  reveal?: boolean;
  /* While true, the face falls into a small pulsing core. */
  collapse?: boolean;
};"""),
("""  reveal = false,
}) => {""",
"""  reveal = false,
  collapse = false,
}) => {"""),
("""        reveal={reveal}
""",
"""        reveal={reveal}
        collapse={collapse}
"""),
])

apply('app/app.tsx', [
("""/* The pages that share the portrait. It stays mounted as you move between
   them, so the face does not restart. On /projects, the hire text fades
   in. */""",
"""/* The pages that share the portrait. It stays mounted as you move between
   them, so the face does not restart. On /projects, the face falls into a
   core and the hire text fades in. */"""),
("""      <Portrait reveal={onProjects} />""",
"""      <Portrait reveal={onProjects} collapse={onProjects} />"""),
])

apply('app/routes/hire-lab/hire-lab.tsx', [
("""  const [reveal, setReveal] = useState(true);
""",
"""  const [reveal, setReveal] = useState(true);
  const [collapse, setCollapse] = useState(true);
"""),
("""      <Portrait key={run} hire={hire} reveal={reveal} />""",
"""      <Portrait key={run} hire={hire} reveal={reveal} collapse={collapse} />"""),
("""          show text
        </label>
""",
"""          show text
        </label>
        <label className={styles.inline}>
          <input
            type="checkbox"
            checked={collapse}
            onChange={(e) => setCollapse(e.target.checked)}
          />
          collapse face
        </label>
"""),
])
