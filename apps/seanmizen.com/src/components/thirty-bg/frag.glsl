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

const float TEXELS = 256.0;

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
  float a = 0.22 * clamp(0.45 * r * cellPx - length(fract(g) - 0.5) * cellPx, 0.0, 1.0);
  vec2 at = gl_FragCoord.xy / res;
  a *= 1.0 - max(maskOpacity * texture2D(content, at).r, texture2D(tight, at).r);
  gl_FragColor = vec4(ink * a, a);
}
