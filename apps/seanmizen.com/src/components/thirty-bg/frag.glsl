// The dots of one baked thirty city. The channels are in
// apps/thirty/scripts/bake.ts. line-vert.glsl draws the lines.
uniform sampler2D city;
uniform sampler2D content; // White where the page has content.
uniform sampler2D tight; // White where [data-mask="tight"] content is.
uniform float maskOpacity; // How much the content mask hides.
uniform vec2 res; // The canvas in device pixels.
uniform float cells; // City cells on a side.
uniform float steps; // Simulation steps in the run.
uniform float t; // 0 to 1 over the run.
uniform vec3 ink;
uniform vec3 accent;
// The 30-minute contour: two time textures from reach-worker.ts, the old
// area and the new area. reachMix goes from 0 (old) to 1 (new). reachShow
// goes from 0 (off) to 1 (on). Both move linearly. The ease is here.
uniform sampler2D reachOld;
uniform sampler2D reachNew;
uniform float reachMix;
uniform float reachShow;

const float TEXELS = 256.0;

// 1 in the area, with a soft edge from 28 to 30 min.
float reach(sampler2D tex, vec2 uv) {
  return smoothstep(30.0, 28.0, 30.0 * texture2D(tex, uv).r);
}

void main() {
  // The whole square city fits in the canvas, centred. Texel row 0 is the top.
  float side = min(res.x, res.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / side + 0.5;
  uv.y = 1.0 - uv.y;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;

  // A dot per cell. Its area is the unmet demand, which halves by step G.
  vec2 g = uv * cells;
  vec4 c = texelFetch(city, ivec2((floor(g) + 0.5) * TEXELS / cells), 0);
  float halfAt = c.g * 255.0;
  float r = c.r * (halfAt > 254.5 ? 1.0 : exp2(-0.5 * min(t / 0.9, 1.0) * steps / halfAt));
  float cellPx = side / cells;
  float disc = clamp(0.45 * r * cellPx - length(fract(g) - 0.5) * cellPx, 0.0, 1.0);

  // In the area, a faint accent fill, and the dots turn to accent.
  float k = smoothstep(0.0, 1.0, reachShow) *
    mix(reach(reachOld, uv), reach(reachNew, uv), smoothstep(0.0, 1.0, reachMix));
  float a = (0.22 + 0.4 * k) * disc;
  float fill = 0.2 * k * (1.0 - a);
  vec2 at = gl_FragCoord.xy / res;
  float keep = 1.0 - max(maskOpacity * texture2D(content, at).r, texture2D(tight, at).r);
  gl_FragColor = keep * vec4(mix(ink, accent, k) * a + accent * fill, a + fill);
}
