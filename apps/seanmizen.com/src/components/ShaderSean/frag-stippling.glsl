#define GLSLIFY 1
// Texture with the particle profile
uniform sampler2D u_texture;

/* replace the float with a tint colour */
uniform vec3      u_color;   // e.g. (0,0,0) black • (1,1,1) white • any RGB

uniform vec2  u_rippleOrigin;
uniform float u_rippleTime;

void main() {
  float a = texture2D(u_texture, gl_PointCoord).a;
  vec4 base = vec4(u_color, a);
  vec4 outColor = base;

  if (a > 0.0) {
    float r = 600.0 * u_rippleTime;
    float w = 30.0;
    float d = distance(gl_FragCoord.xy, u_rippleOrigin);
    float ripple = smoothstep(r - w, r, d) * (1.0 - smoothstep(r, r + w, d));
    outColor.rgb = mix(outColor.rgb, vec3(1.0, 0.0, 0.0), ripple);
  }

  gl_FragColor = outColor;
}
