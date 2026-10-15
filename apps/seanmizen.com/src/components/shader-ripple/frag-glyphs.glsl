// The glyph background: a grid of characters behind the portrait that the
// click ripples light, tint and run through their set. ripple.glsl is
// prepended, so rippleAt(), cloud() and hash31() are in scope.

uniform sampler2D u_atlas;   // white glyphs on clear, in a grid
uniform vec2 u_atlasGrid;    // columns and rows in the atlas
uniform float u_glyphCount;  // how many glyphs the set has
uniform vec2 u_viewPx;       // the canvas size in CSS pixels
uniform vec2 u_halfExtent;   // half the visible plane, in world units
uniform float u_dpr;         // device pixels per CSS pixel

uniform float u_cellSize;    // a cell's edge in CSS pixels
uniform float u_fill;        // the share of cells that hold a glyph
uniform float u_gridAlpha;   // how strongly a lit glyph shows
uniform float u_gridIdle;    // how much of the cloud shows with no ripple
uniform float u_flicker;     // resting glyph changes per second
uniform float u_spin;        // glyphs a cell runs through as a front passes
uniform float u_calm;        // how much the grid thins behind the portrait

uniform vec3 u_color;        // the plain ink
uniform vec3 u_accent;       // the ripple tint
uniform vec2 u_tintEdge;     // where the tint starts and where it is whole
uniform float u_afterglow;   // how strong the haze behind the front is

void main() {
  // Cells are laid out in CSS pixels from the bottom left, so a glyph keeps
  // its size on any screen.
  vec2 css = gl_FragCoord.xy / u_dpr;
  vec2 cell = floor(css / u_cellSize);
  vec2 local = css / u_cellSize - cell;

  float own = hash31(vec3(cell, 1.0));
  if (own >= u_fill) discard;

  // Everything about the light is read once, at the cell's middle, so a
  // glyph lights as a whole.
  vec2 middle = (cell + 0.5) * u_cellSize / u_viewPx * 2.0 - 1.0;
  vec2 p = middle * u_halfExtent;

  vec3 light;
  float roused = rippleAt(p, light).z;

  // With no ripple, the drifting cloud still shows faintly where it is
  // thick, so the field is never quite empty.
  float c = cloud(vec3(p / u_nebulaScale, u_now * u_nebulaSpeed));
  float idle = u_gridIdle * smoothstep(u_cloudLevel - u_cloudSoft, u_cloudLevel + u_cloudSoft, c);

  float tint = smoothstep(u_tintEdge.x, u_tintEdge.y, light.x) * light.z;
  float haze = clamp(u_afterglow * light.y * light.z, 0.0, 1.0);
  float lit = max(max(tint, haze), max(idle, clamp(roused, 0.0, 1.0) * light.z));

  // Thinner behind the portrait, which sits in the middle of the plane.
  lit *= 1.0 - u_calm * exp(-dot(p, p) / 64.0);
  if (lit < 0.004) discard;

  // Each cell steps through the set at its own pace, from its own place in
  // it, and a passing front runs it on further and back as it settles.
  float pace = hash31(vec3(cell, 2.0));
  float steps = floor(u_now * u_flicker * (0.6 + 0.8 * pace) + hash31(vec3(cell, 3.0)));
  steps += floor(u_spin * roused + hash31(vec3(cell, 4.0)));
  float g = mod(floor(own / u_fill * u_glyphCount) + steps, u_glyphCount);

  // The atlas is drawn from the top left; textures read from the bottom.
  vec2 at = vec2(mod(g, u_atlasGrid.x), floor(g / u_atlasGrid.x));
  vec2 uv = vec2((at.x + local.x) / u_atlasGrid.x, 1.0 - (at.y + 1.0 - local.y) / u_atlasGrid.y);
  float ink = texture2D(u_atlas, uv).a;
  if (ink <= 0.0) discard;

  vec3 color = mix(u_color, u_accent, max(tint, 0.8 * haze));
  gl_FragColor = vec4(color, ink * min(lit, 1.0) * u_gridAlpha);
}
