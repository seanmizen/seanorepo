"""Stage 07, first half: the old content box goes, and ripples from before
the face came home skip the face. (The CSS halo edits in the same session
step were reverted with git checkout, so they are not replayed.)"""
from lib import apply

apply('components/portrait/portrait.tsx', [
("""/* The page content the hire text keeps clear of. */
const CONTENT = 'main.container > :is(h1, h2, p, ul, nav)';

""", ""),
("""        clearSelector={CONTENT}
""", ""),
])

apply('components/shader-ripple/frag-glyph-light.glsl', [
("""// The hire field: text that fades in around the face, clear of the face
// and of the page content.""",
"""// The hire field: text that fades in around the face, clear of the face.
// Page content keeps itself clear with a halo (see index.css)."""),
("""uniform vec4 u_clearRect;      // the content's box: min xy, max xy (world)

float boxDistance(vec2 p, vec4 box) {
  vec2 middle = 0.5 * (box.xy + box.zw);
  vec2 halfSize = 0.5 * (box.zw - box.xy);
  vec2 q = abs(p - middle) - halfSize;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
""", ""),
("""    // Keep the face and the content clear, with soft edges.
    float soft = max(u_clearSoft * u_clearFace, 0.001);
    float face = smoothstep(u_clearFace, u_clearFace + soft, length(p));
    float content = u_clearRect.z > u_clearRect.x
      ? smoothstep(0.0, soft, boxDistance(p, u_clearRect))
      : 1.0;
    lit *= min(face, content) * u_revealFade;""",
"""    // Keep the face clear, with a soft edge.
    float soft = max(u_clearSoft * u_clearFace, 0.001);
    float face = smoothstep(u_clearFace, u_clearFace + soft, length(p));
    lit *= face * u_revealFade;"""),
])

apply('components/shader-ripple/hire.ts', [
("""/* The projects page's text field: a message that fades in around the
   face on /projects, kept clear of the face and of the page content. A""",
"""/* The projects page's text field: a message that fades in around the
   face on /projects, kept clear of the face. Page content keeps itself
   clear with a halo (see index.css). A"""),
("""    hint: 'How gently the text fades in at the edge of the clear areas.',""",
"""    hint: 'How gently the text fades in at the edge of the clear area.',"""),
])

apply('components/shader-ripple/ripple.glsl', [
("""uniform vec4 u_taps[MAX_TAPS];
""",
"""uniform vec4 u_taps[MAX_TAPS];
// Ripples that started before this time are skipped. The face's passes
// set it when the face comes home, so older ripples leave the face alone.
uniform float u_tapsFrom;
"""),
("""    if (age < 0.0) continue;""",
"""    if (age < 0.0 || tap.z < u_tapsFrom) continue;"""),
])

apply('components/shader-ripple/shader-ripple.tsx', [
("""  /* Elements whose combined box the hire field keeps clear of text. */
  clearSelector?: string;
""", ""),
("""  flight = FLIGHT_DEFAULTS,
  clearSelector,
""", """  flight = FLIGHT_DEFAULTS,
"""),
("""    flight,
    clearSelector,
    portraitScale,
  });""", """    flight,
    portraitScale,
  });"""),
("""    flight,
    clearSelector,
    portraitScale,
  };""", """    flight,
    portraitScale,
  };"""),
("""    const simUniforms: Record<string, THREE.IUniform> = {};""",
"""    // The face's passes skip ripples that started before this time on the
    // ripple clock. It moves on when the face comes home, so ripples from
    // /projects leave the face alone. The text field sees every ripple.
    const faceTaps = { u_tapsFrom: { value: -1 } };

    const simUniforms: Record<string, THREE.IUniform> = {};"""),
("""    Object.assign(velVar.material.uniforms, {
      ...shared,
      ...rippleUniforms,
      ...simUniforms,""",
"""    Object.assign(velVar.material.uniforms, {
      ...shared,
      ...rippleUniforms,
      ...faceTaps,
      ...simUniforms,"""),
("""    Object.assign(offVar.material.uniforms, {
      ...rippleUniforms,
      ...simUniforms,
    });""",
"""    Object.assign(offVar.material.uniforms, {
      ...rippleUniforms,
      ...faceTaps,
      ...simUniforms,
    });"""),
("""    const uniforms = {
      ...rippleUniforms,
      u_width""",
"""    const uniforms = {
      ...rippleUniforms,
      ...faceTaps,
      u_width"""),
("""    const lightUniforms = {
      ...rippleUniforms,""",
"""    const lightUniforms = {
      ...rippleUniforms,
      u_tapsFrom: { value: -1 },"""),
("""      u_clearRect: { value: new THREE.Vector4() },
""", ""),
("""    const throwState = { at: 0 };

    // The content box the text keeps clear of, in world units.
    const clearBox = new THREE.Vector4();
    const measureClear = () => {
      clearBox.set(0, 0, 0, 0);
      const selector = live.current.clearSelector;
      if (!selector) return;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      // Measure each element's contents, not its box: a block is as wide as
      // its container, but its text may take a third of that.
      const range = document.createRange();
      for (const el of document.querySelectorAll(selector)) {
        range.selectNodeContents(el);
        const box = range.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.right);
        bottom = Math.max(bottom, box.bottom);
      }
      if (right <= left) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const toX = (x: number) =>
        ((x - bounds.left) / bounds.width) * 2 * view.halfX - view.halfX;
      const toY = (y: number) =>
        view.halfY - ((y - bounds.top) / bounds.height) * 2 * view.halfY;
      clearBox.set(toX(left), toY(bottom), toX(right), toY(top));
    };
""",
"""    // `thrown` is the value from the last frame, to see the face turn for
    // home.
    const throwState = { at: 0, thrown: false };
"""),
("""        revealState.duration = Math.max(0.05, (h?.revealTime ?? 1) * distance);
        // The page has just changed (a navigation), so measure now rather
        // than a few frames late.
        measureClear();
      }""",
"""        revealState.duration = Math.max(0.05, (h?.revealTime ?? 1) * distance);
      }"""),
("""      // The throw moves `at` toward its end at a steady rate.
      const f = live.current.flight;
      const step = (live.current.thrown ? gap : -gap) / f.time;""",
"""      // The throw moves `at` toward its end at a steady rate.
      const f = live.current.flight;
      const thrown = live.current.thrown;
      if (throwState.thrown && !thrown) faceTaps.u_tapsFrom.value = now;
      throwState.thrown = thrown;
      const step = (thrown ? gap : -gap) / f.time;"""),
("""          // Often enough to follow a scroll or a resize.
          if (frames % 4 === 0) measureClear();
""", ""),
("""          lightUniforms.u_clearRect.value.copy(clearBox);
""", ""),
])
