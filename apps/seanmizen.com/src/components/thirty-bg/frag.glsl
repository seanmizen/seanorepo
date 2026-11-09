// One baked thirty city, drawn over the whole canvas. The channels are in
// apps/thirty/scripts/bake.ts.
uniform sampler2D city;
uniform vec2 res; // The canvas in device pixels.
uniform float px; // Device pixels in one CSS pixel.
uniform float cells; // City cells on a side.
uniform float steps; // Simulation steps in the run.
uniform float t; // 0 to 1 over the run.
uniform vec3 ink;
uniform vec3 accent;

const float TEXELS = 256.0;
const float RANGE = 4.0; // The largest distance in B, in texels.

void main() {
  // The square city covers the canvas, centred. Texel row 0 is the top.
  float side = max(res.x, res.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / side + 0.5;
  uv.y = 1.0 - uv.y;
  float s = t * steps;

  // A dot per cell. Its area is the unmet demand, which halves by step G.
  vec2 g = uv * cells;
  vec4 c = texelFetch(city, ivec2((floor(g) + 0.5) * TEXELS / cells), 0);
  float halfAt = c.g * 255.0;
  float r = c.r * (halfAt > 254.5 ? 1.0 : exp2(-0.5 * s / halfAt));
  float cellPx = side / cells;
  float dotA = clamp(0.45 * r * cellPx - length(fract(g) - 0.5) * cellPx, 0.0, 1.0);

  // A thin line, from the step it appears. It shows in accent, then turns to ink.
  // A blend of texel distances does not fall to 0 between texel centres, so
  // a thin line breaks into dots. Use the lower bound from the 3 x 3 nearest
  // texels: the distance here is at least B(q) - |p - q|. On a line it is 0.
  vec2 p = uv * TEXELS - 0.5;
  ivec2 n = ivec2(floor(p + 0.5));
  float lo = -RANGE;
  float far = 0.0;
  float at = 255.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      ivec2 q = clamp(n + ivec2(i, j), 0, int(TEXELS) - 1);
      vec4 l = texelFetch(city, q, 0);
      float d = l.b * RANGE - length(p - vec2(q));
      far = max(far, l.b * RANGE);
      if (d > lo) {
        lo = d;
        at = l.a * 255.0;
      }
    }
  float dist = max(lo, 0.0) * side / TEXELS;
  float age = s - at;
  // Where each near texel is within about half a texel of a line, the lines
  // are too close to draw apart. Draw a flat tone there.
  float lineA = mix(0.4, clamp(0.6 * px - dist + 0.5, 0.0, 1.0), smoothstep(0.55, 0.95, far));
  lineA *= clamp(age + 1.0, 0.0, 1.0);
  vec3 lineC = mix(accent, ink, clamp(age / (0.1 * steps), 0.0, 1.0));

  float a = max(0.22 * dotA, 0.75 * lineA);
  vec3 col = mix(ink, lineC, step(0.22 * dotA, 0.75 * lineA));
  gl_FragColor = vec4(col * a, a);
}
