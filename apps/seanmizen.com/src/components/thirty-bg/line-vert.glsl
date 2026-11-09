// One segment of a thirty line, as a quad about 1.5 CSS px wide. A point is
// in units of the square city, from its top left. The whole square fits in
// the canvas, centred, as in frag.glsl.
attribute vec2 a; // The start of the segment.
attribute vec2 b; // The end of the segment.
attribute vec2 corner; // x: 0 at a, 1 at b. y: the side, -1 or 1.
attribute float appear; // The step at which the line appears.
uniform vec2 res; // The canvas in device pixels.
uniform float px; // Device pixels in one CSS pixel.
uniform float steps; // Simulation steps in the run.
uniform float t; // 0 to 1 over the run.
uniform vec3 ink;
uniform vec3 accent;
varying vec4 col;

vec2 screen(vec2 p) {
  return 0.5 * res + (p - 0.5) * vec2(1.0, -1.0) * min(res.x, res.y);
}

void main() {
  vec2 pa = screen(a);
  vec2 pb = screen(b);
  vec2 d = normalize(pb - pa);
  // Each end goes on by half a width, so the segments of a line meet at its corners.
  float w = 0.75 * px;
  vec2 p = mix(pa, pb, corner.x) + w * (corner.y * vec2(-d.y, d.x) + (2.0 * corner.x - 1.0) * d);
  // Before its step, a line is outside the canvas. It shows in accent, then turns to ink.
  float age = t * steps - appear;
  gl_Position = age > -1.0 ? vec4(2.0 * p / res - 1.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  float alpha = 0.75 * clamp(age + 1.0, 0.0, 1.0);
  col = vec4(mix(accent, ink, clamp(age / (0.1 * steps), 0.0, 1.0)) * alpha, alpha);
}
