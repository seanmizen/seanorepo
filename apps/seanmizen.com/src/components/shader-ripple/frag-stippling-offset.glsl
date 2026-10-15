// Each particle's displacement from where the undisturbed sim puts it: the
// offset (xy) and its velocity (zw). Ripples push the offset and a damped
// spring pulls it back to zero, so once a ripple has passed, every particle
// is exactly where it would have been without the click.

uniform float u_push;       // how hard a ripple shoves the particles
uniform float u_springBack; // 1: ripples move the offset; 0: they move the sim
uniform float u_spring;     // how hard the offset is pulled home
uniform float u_springDamp; // how much of the offset's speed is lost each frame

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec4 state = texture2D(u_offsetTexture, uv);
  vec2 offset = state.xy;
  vec2 speed = state.zw;

  // Ripples are read where the particle is drawn, so a pushed particle meets
  // the next front where it now is.
  vec3 home = texture2D(u_positionTexture, uv).xyz;
  vec3 light;
  vec2 push = u_springBack * u_push * rippleAt(home.xy + offset, light).xy;

  speed = speed * (1.0 - u_springDamp) + push - u_spring * offset;
  offset += speed;

  gl_FragColor = vec4(offset, speed);
}
