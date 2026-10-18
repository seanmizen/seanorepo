#define GLSLIFY 1
// Texture with the particle profile
uniform sampler2D u_texture;

uniform vec3  u_color;     // the plain ink
uniform vec3  u_accent;    // the ripple tint: red in light mode, blue in dark
uniform vec2  u_tintEdge;  // where the tint starts and where it is whole
uniform float u_rest;      // how bright the plain ink is, against a lit particle's 1
uniform float u_afterglow; // how strong the haze left behind the front is

// From the vertex shader: the ripple's tint (x), its afterlight (y), and how
// much of it the cloud lets show here (z).
varying vec3 v_light;
// From the vertex shader: how strongly this dot shows.
varying float v_alpha;

void main() {
  float a = texture2D(u_texture, gl_PointCoord).a;

  // The tint comes in whole and goes out quickly. Halfway between the accent
  // and the plain ink is only mud, so the mix is steep, not linear.
  float tint = smoothstep(u_tintEdge.x, u_tintEdge.y, v_light.x) * v_light.z;

  // The haze behind the front is soft, and only ever part accent.
  float haze = clamp(u_afterglow * v_light.y * v_light.z, 0.0, 1.0);
  float lit = max(tint, haze);

  // Headroom: the plain ink is drawn below full strength, so a lit particle
  // can rise above it. That rise is what reads as glow.
  float bright = mix(u_rest, 1.0, lit);
  vec3 color = mix(u_color, u_accent, max(tint, 0.8 * haze));

  gl_FragColor = vec4(color, a * bright * v_alpha);
}
