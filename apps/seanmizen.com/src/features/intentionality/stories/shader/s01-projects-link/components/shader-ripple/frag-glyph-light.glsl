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

// The hire field: text that fades in around the face, clear of the face
// and of the page content.
uniform float u_hire;          // 1: the hire field; 0: the playground grid
uniform float u_textStrength;  // how strongly the resting text shows
uniform float u_textDrift;     // how much the drifting cloud makes it breathe
uniform float u_revealFade;    // how far the text has faded in, 0 to 1
uniform float u_clearFace;     // the radius kept clear around the face
uniform float u_clearSoft;     // how soft the clear edges are, against u_clearFace
uniform vec4 u_clearRect;      // the content's box: min xy, max xy (world)

float boxDistance(vec2 p, vec4 box) {
  vec2 middle = 0.5 * (box.xy + box.zw);
  vec2 halfSize = 0.5 * (box.zw - box.xy);
  vec2 q = abs(p - middle) - halfSize;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

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

    // Keep the face and the content clear, with soft edges.
    float soft = max(u_clearSoft * u_clearFace, 0.001);
    float face = smoothstep(u_clearFace, u_clearFace + soft, length(p));
    float content = u_clearRect.z > u_clearRect.x
      ? smoothstep(0.0, soft, boxDistance(p, u_clearRect))
      : 1.0;
    lit *= min(face, content) * u_revealFade;
  } else {
    // With no ripple, the drifting cloud shows faintly where it is thick.
    float idle = u_gridIdle * smoothstep(u_cloudLevel - u_cloudSoft, u_cloudLevel + u_cloudSoft, c);
    lit = max(max(tint, haze), max(idle, rouse));
    // Thinner behind the portrait, which sits in the middle of the plane.
    lit *= 1.0 - u_calm * exp(-dot(p, p) / 64.0);
  }

  gl_FragColor = vec4(tint, haze, clamp(lit, 0.0, 1.0), clamp(roused / 4.0, 0.0, 1.0));
}
