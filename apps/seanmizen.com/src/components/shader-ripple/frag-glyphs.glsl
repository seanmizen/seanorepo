// The glyph background: a grid of characters behind the portrait. The light
// pass (frag-glyph-light.glsl) has already worked out each cell's light, so
// this pass only picks each cell's glyph and draws it. ripple.glsl is
// prepended for hash31().

uniform sampler2D u_light;   // per cell: tint, haze, lit, roused / 4
uniform vec2 u_gridDims;     // columns and rows of cells
uniform sampler2D u_atlas;   // white glyphs on clear, in a grid
uniform vec2 u_atlasGrid;    // columns and rows in the atlas
uniform float u_glyphCount;  // how many glyphs the set has
uniform vec2 u_cellPx;       // a cell's size in CSS pixels
uniform float u_dpr;         // device pixels per CSS pixel

uniform float u_fill;        // the share of cells that hold a glyph
uniform float u_gridAlpha;   // how strongly a lit glyph shows
uniform float u_flicker;     // resting glyph changes per second
uniform float u_spin;        // glyphs a cell runs through as a front passes
uniform float u_message;     // 1: the cells read the set in order, as text
uniform float u_rowShift;    // in text, how far each row starts on from the last

uniform vec3 u_color;        // the plain ink
uniform vec3 u_accent;       // the ripple tint

void main() {
  // Cells are laid out in CSS pixels from the bottom left, so a glyph keeps
  // its size on any screen.
  vec2 css = gl_FragCoord.xy / u_dpr;
  vec2 cell = floor(css / u_cellPx);
  vec2 local = css / u_cellPx - cell;

  float own = hash31(vec3(cell, 1.0));
  if (own >= u_fill) discard;

  vec4 light = texture2D(u_light, (cell + 0.5) / u_gridDims);
  float lit = light.b;
  if (lit < 0.004) discard;
  float roused = light.a * 4.0;

  // Each cell steps through the set at its own pace, from its own place in
  // it, and a passing front runs it on further and back as it settles.
  float pace = hash31(vec3(cell, 2.0));
  float steps = floor(u_now * u_flicker * (0.6 + 0.8 * pace) + hash31(vec3(cell, 3.0)));
  steps += floor(u_spin * roused + hash31(vec3(cell, 4.0)));

  // As text, a cell takes the next character along its row, and each row
  // (counted from the top) starts a few characters on from the one above,
  // so the words never line up in columns. Otherwise it starts anywhere.
  float rowFromTop = u_gridDims.y - 1.0 - cell.y;
  float start = u_message > 0.5
    ? cell.x + rowFromTop * u_rowShift
    : floor(own / u_fill * u_glyphCount);
  float g = mod(start + steps, u_glyphCount);

  // The atlas is drawn from the top left; textures read from the bottom. A
  // narrow cell reads only the middle of its square atlas cell, so the
  // glyph keeps its own shape instead of being squeezed.
  vec2 at = vec2(mod(g, u_atlasGrid.x), floor(g / u_atlasGrid.x));
  float across = 0.5 + (local.x - 0.5) * (u_cellPx.x / u_cellPx.y);
  vec2 uv = vec2((at.x + across) / u_atlasGrid.x, 1.0 - (at.y + 1.0 - local.y) / u_atlasGrid.y);
  float ink = texture2D(u_atlas, uv).a;
  if (ink <= 0.0) discard;

  vec3 color = mix(u_color, u_accent, max(light.r, 0.8 * light.g));
  gl_FragColor = vec4(color, ink * lit * u_gridAlpha);
}
