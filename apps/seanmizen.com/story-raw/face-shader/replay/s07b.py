"""Stage 07, second half: the content mask."""
from lib import apply

apply('components/shader-ripple/shader-ripple.tsx', [
("""  /* Draws the portrait at this scale; the view around it is unchanged. */
  portraitScale?: number;""",
"""  /* Keeps every dot and glyph off the page's content: its text, icons and
     controls. See the content mask below. */
  clearOfContent?: boolean;
  /* Draws the portrait at this scale; the view around it is unchanged. */
  portraitScale?: number;"""),
("""const easeInCubic = (x: number) => x ** 3;""",
"""/* The content mask: a small texture, white wherever the page has content.
   The dots and the glyphs fade out wherever it is white. It is built from
   the line boxes of every text node, plus the boxes of the elements below,
   so it fits any page with no selectors. MASK_SCALE is texels per CSS
   pixel. MASK_PAD is the clear space around content, and MASK_SOFT is the
   distance over which that space fades out, both in CSS pixels. */
const MASK_SCALE = 0.5;
const MASK_PAD = 4;
const MASK_SOFT = 12;
const MASK_ELEMENTS = 'img, svg, video, input, button, select, textarea';

const easeInCubic = (x: number) => x ** 3;"""),
("""  flight = FLIGHT_DEFAULTS,
  portraitScale = 1,""",
"""  flight = FLIGHT_DEFAULTS,
  clearOfContent = false,
  portraitScale = 1,"""),
("""    flight,
    portraitScale,
  });""", """    flight,
    clearOfContent,
    portraitScale,
  });"""),
("""    flight,
    portraitScale,
  };""", """    flight,
    clearOfContent,
    portraitScale,
  };"""),
("""    const simUniforms: Record<string, THREE.IUniform> = {};""",
"""    // The content mask. A resize makes a new texture: a texture keeps the
    // size of its first upload.
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 1;
    maskCanvas.height = 1;
    const maskCtx = maskCanvas.getContext('2d');
    const makeMaskTexture = () => {
      const texture = new THREE.CanvasTexture(maskCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    };
    const contentMask = { value: makeMaskTexture() };
    const range = document.createRange();
    const drawMask = () => {
      if (!maskCtx) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const w = Math.max(1, Math.round(bounds.width * MASK_SCALE));
      const h = Math.max(1, Math.round(bounds.height * MASK_SCALE));
      if (maskCanvas.width !== w || maskCanvas.height !== h) {
        maskCanvas.width = w;
        maskCanvas.height = h;
        contentMask.value.dispose();
        contentMask.value = makeMaskTexture();
      }
      maskCtx.clearRect(0, 0, w, h);
      maskCtx.fillStyle = '#fff';
      maskCtx.shadowColor = '#fff';
      maskCtx.shadowBlur = MASK_SOFT * MASK_SCALE;
      const fill = (box: DOMRect) => {
        if (box.width === 0 || box.height === 0) return;
        maskCtx.fillRect(
          (box.left - bounds.left - MASK_PAD) * MASK_SCALE,
          (box.top - bounds.top - MASK_PAD) * MASK_SCALE,
          (box.width + 2 * MASK_PAD) * MASK_SCALE,
          (box.height + 2 * MASK_PAD) * MASK_SCALE,
        );
      };
      // One box a line of text, so a paragraph clears its own shape and
      // not the whole width of its column.
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!/\\S/.test(node.nodeValue ?? '')) continue;
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) fill(box);
      }
      for (const el of document.querySelectorAll(MASK_ELEMENTS)) {
        fill(el.getBoundingClientRect());
      }
      contentMask.value.needsUpdate = true;
    };

    const simUniforms: Record<string, THREE.IUniform> = {};"""),
("""    const uniforms = {
      ...rippleUniforms,
      ...faceTaps,
      u_width""",
"""    const uniforms = {
      ...rippleUniforms,
      ...faceTaps,
      u_contentMask: contentMask,
      u_width"""),
("""    const lightUniforms = {
      ...rippleUniforms,
      u_tapsFrom: { value: -1 },""",
"""    const lightUniforms = {
      ...rippleUniforms,
      u_tapsFrom: { value: -1 },
      u_contentMask: contentMask,"""),
("""      if (live.current.portraitScale !== view.scale) resize(view.w, view.h);
""",
"""      if (live.current.portraitScale !== view.scale) resize(view.w, view.h);

      // Often enough to follow a scroll, a resize or a section opening.
      if (live.current.clearOfContent && frames % 4 === 0) drawMask();
"""),
("""      atlas.texture.dispose();
      observer?.disconnect();""",
"""      atlas.texture.dispose();
      contentMask.value.dispose();
      observer?.disconnect();"""),
])

apply('components/shader-ripple/vert-stippling.glsl', [
("""uniform float u_throwAlpha;  // how strongly the shape shows in flight
""",
"""uniform float u_throwAlpha;  // how strongly the shape shows in flight
uniform sampler2D u_contentMask;  // white where the page has content
"""),
("""        gl_Position = projectionMatrix * mvPosition;
        v_alpha = u_throwAlpha;""",
"""        gl_Position = projectionMatrix * mvPosition;

        // A dot fades out where the page has content.
        vec2 screen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
        v_alpha = u_throwAlpha * (1.0 - texture2D(u_contentMask, screen).r);"""),
])

apply('components/shader-ripple/frag-glyph-light.glsl', [
("""uniform float u_revealFade;    // how far the text has faded in, 0 to 1
""",
"""uniform float u_revealFade;    // how far the text has faded in, 0 to 1
uniform sampler2D u_contentMask;  // white where the page has content
"""),
("""  gl_FragColor = vec4(tint, haze, clamp(lit, 0.0, 1.0), clamp(roused / 4.0, 0.0, 1.0));""",
"""  // No glyph shows where the page has content.
  lit *= 1.0 - texture2D(u_contentMask, middle * 0.5 + 0.5).r;

  gl_FragColor = vec4(tint, haze, clamp(lit, 0.0, 1.0), clamp(roused / 4.0, 0.0, 1.0));"""),
("""// The hire field: text that fades in around the face, clear of the face.
// Page content keeps itself clear with a halo (see index.css).""",
"""// The hire field: text that fades in around the face, clear of the face.
// The content mask keeps it off the page's content."""),
])

apply('components/shader-ripple/hire.ts', [
("""   face on /projects, kept clear of the face. Page content keeps itself
   clear with a halo (see index.css). A""",
"""   face on /projects, kept clear of the face. The content mask keeps it
   off the page's content. A"""),
])

apply('components/portrait/portrait.tsx', [
("""        flight={flight}
""",
"""        flight={flight}
        clearOfContent
"""),
])
