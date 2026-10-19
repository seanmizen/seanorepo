// The glyph background's light, worked out once per cell into a small
// texture that the glyph pass then reads. One fragment here is one cell:
// gl_FragCoord.xy - 0.5 is the cell's column and row from the bottom left.
// ripple.glsl is prepended, so rippleAt() and cloud() are in scope.
//
// Out: the tint (r), the haze (g), how lit the glyph is (b), and how far a
// front has roused it, over 4 (a).

uniform vec2 u_viewPx;      // the canvas size in CSS pixels
uniform vec2 u_cellPx;      // a cell's size in CSS pixels
uniform vec2 u_halfExtent;  // half the visible plane, in world units
uniform vec2 u_tintEdge;    // where the tint starts and where it is whole
uniform float u_afterglow;  // how strong the haze behind the front is

// The playground grid.
uniform float u_gridIdle;   // how much of the cloud shows with no ripple
uniform float u_calm;       // how much the grid thins behind the portrait

// The hire field: text that fades in on /projects. The content mask keeps
// it off the page's content.
uniform float u_hire;          // 1: the hire field; 0: the playground grid
uniform float u_textStrength;  // how strongly the resting text shows
uniform float u_textDrift;     // how much the drifting cloud makes it breathe
uniform float u_revealFade;    // how far the text has faded in, 0 to 1
uniform sampler2D u_contentMask;  // white where the page has content
uniform sampler2D u_tightMask;    // white where [data-mask="tight"] content is

void main() {
  vec2 cell = gl_FragCoord.xy - 0.5;
  vec2 middle = (cell + 0.5) * u_cellPx / u_viewPx * 2.0 - 1.0;
  vec2 p = middle * u_halfExtent;

  vec3 light;
  float roused = rippleAt(p, light).z;
  float c = cloud(vec3(p / u_nebulaScale, u_now * u_nebulaSpeed));

  float tint = smoothstep(u_tintEdge.x, u_tintEdge.y, light.x) * light.z;
  float haze = clamp(u_afterglow * light.y * light.z, 0.0, 1.0);
  float rouse = clamp(roused, 0.0, 1.0) * light.z;
  float lit;

  if (u_hire > 0.5) {
    // Resting text breathes with the drifting cloud.
    float breath = mix(1.0, smoothstep(-0.45, 0.5, c), u_textDrift);
    lit = max(u_textStrength * breath, max(max(tint, haze), rouse));
    lit *= u_revealFade;
  } else {
    // With no ripple, the drifting cloud shows faintly where it is thick.
    float idle = u_gridIdle * smoothstep(u_cloudLevel - u_cloudSoft, u_cloudLevel + u_cloudSoft, c);
    lit = max(max(tint, haze), max(idle, rouse));
    // Thinner behind the portrait, which sits in the middle of the plane.
    lit *= 1.0 - u_calm * exp(-dot(p, p) / 64.0);
  }

  // No glyph shows where the page has content.
  vec2 at = middle * 0.5 + 0.5;
  lit *= 1.0 - max(texture2D(u_contentMask, at).r, texture2D(u_tightMask, at).r);

  gl_FragColor = vec4(tint, haze, clamp(lit, 0.0, 1.0), clamp(roused / 4.0, 0.0, 1.0));
}
