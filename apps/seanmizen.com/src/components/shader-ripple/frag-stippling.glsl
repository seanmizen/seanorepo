#define GLSLIFY 1
// Texture with the particle profile
uniform sampler2D u_texture;

/* replace the float with a tint colour */
uniform vec3      u_color;   // e.g. (0,0,0) black • (1,1,1) white • any RGB
uniform vec3      u_accent;  // the ripple tint: red in light mode, blue in dark
uniform vec2      u_tintEdge; // where the tint starts and where it is whole

// How strongly the passing ripples tint this particle
varying float v_glow;

void main() {
  float a = texture2D(u_texture, gl_PointCoord).a;

  // The tint comes in whole and goes out quickly. Halfway between the accent
  // and the plain ink is only mud, so the mix is steep, not linear.
  float tint = smoothstep(u_tintEdge.x, u_tintEdge.y, v_glow);

  gl_FragColor = vec4(mix(u_color, u_accent, tint), a);
}
