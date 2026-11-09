// A thirty line, clear of the page content as the dots in frag.glsl.
uniform sampler2D content;
uniform sampler2D tight;
uniform float maskOpacity; // How much the content mask hides.
uniform vec2 res;
varying vec4 col;

void main() {
  vec2 at = gl_FragCoord.xy / res;
  gl_FragColor = col * (1.0 - max(maskOpacity * texture2D(content, at).r, texture2D(tight, at).r));
}
