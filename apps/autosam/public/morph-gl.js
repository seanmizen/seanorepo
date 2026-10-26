// autosam morph: WebGL layer.
//
// Where: morph.js imports this module.
// When: setup() once, then upload(), draw() on each frame, and release()
// for each morph.
// Why: one instanced quad draws each glyph pair. The fragment shader reads
// the two fields, moves them along the alignment and the flow, and blends
// them. The coverage of each pixel comes from the blended distance.
//
// Each glyph pair has 13 vec4:
// - the two pen origins, the two sizes and the blur flag
// - the two cells and their atlas rects, the two colors, the two clips
// - the alignment, and the flow rect with its texture rect

const VERT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_orig;
layout(location=2) in vec4 a_size;
layout(location=3) in vec4 a_cellA;
layout(location=4) in vec4 a_uvA;
layout(location=5) in vec4 a_cellB;
layout(location=6) in vec4 a_uvB;
layout(location=7) in vec4 a_colA;
layout(location=8) in vec4 a_colB;
layout(location=9) in vec4 a_clipA;
layout(location=10) in vec4 a_clipB;
layout(location=11) in vec4 a_align;
layout(location=12) in vec4 a_flow;
layout(location=13) in vec4 a_flowUV;
uniform vec2 u_view;
uniform float u_t;
out vec2 v_q;
out vec2 v_px;
flat out vec4 v_cellA, v_uvA, v_cellB, v_uvB, v_col, v_clip, v_align, v_flow, v_flowUV;
flat out float v_size, v_diff;
void main() {
  // The quad holds glyph a at each end of its alignment, and glyph b at
  // each end of the inverse alignment.
  vec2 s = a_align.xy;
  vec2 t = a_align.zw;
  vec4 a1 = vec4(a_cellA.xy * s + t, a_cellA.zw * s + t);
  vec4 b0 = vec4((a_cellB.xy - t) / s, (a_cellB.zw - t) / s);
  vec2 lo = min(min(a_cellA.xy, a1.xy), min(a_cellB.xy, b0.xy));
  vec2 hi = max(max(a_cellA.zw, a1.zw), max(a_cellB.zw, b0.zw));
  vec2 q = mix(lo, hi, a_corner);
  vec2 px = mix(a_orig.xy, a_orig.zw, u_t) + q * mix(a_size.x, a_size.y, u_t);
  v_q = q;
  v_px = px;
  v_cellA = a_cellA; v_uvA = a_uvA; v_cellB = a_cellB; v_uvB = a_uvB;
  v_align = a_align; v_flow = a_flow; v_flowUV = a_flowUV;
  v_col = mix(a_colA, a_colB, u_t);
  v_clip = mix(a_clipA, a_clipB, u_t);
  v_size = mix(a_size.x, a_size.y, u_t);
  v_diff = a_size.z;
  vec2 c = px / u_view * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform sampler2D u_flow;
uniform float u_t;
uniform float u_dpr;
uniform float u_blur;
in vec2 v_q;
in vec2 v_px;
flat in vec4 v_cellA, v_uvA, v_cellB, v_uvB, v_col, v_clip, v_align, v_flow, v_flowUV;
flat in float v_size, v_diff;
out vec4 o;
// The signed distance in em. Outside the cell it is the value at the cell
// edge less the distance to the cell.
float sdf(vec4 cell, vec4 uv, vec2 q) {
  vec2 c = clamp(q, cell.xy, cell.zw);
  vec2 f = (c - cell.xy) / (cell.zw - cell.xy);
  return textureLod(u_atlas, mix(uv.xy, uv.zw, f), 0.0).r - length(q - c);
}
// Five taps, b em apart, when b is more than 0. Only the blend method blurs.
float field(vec4 cell, vec4 uv, vec2 q, float b) {
  float s = sdf(cell, uv, q);
  if (b <= 0.0) return s;
  s += sdf(cell, uv, q + vec2(b, b)) + sdf(cell, uv, q + vec2(-b, b));
  s += sdf(cell, uv, q + vec2(b, -b)) + sdf(cell, uv, q + vec2(-b, -b));
  return s / 5.0;
}
// The backward map of the pair at p, in em of b. No flow when the rect is
// empty. The read stays half a texel inside the rect, so it never reads the
// flow of the next pair in the texture.
vec2 flow(vec2 p) {
  if (v_flow.z <= v_flow.x) return vec2(0.0);
  vec2 f = clamp((p - v_flow.xy) / (v_flow.zw - v_flow.xy), 0.0, 1.0);
  vec2 h = 0.5 / vec2(textureSize(u_flow, 0));
  vec2 uv = clamp(mix(v_flowUV.xy, v_flowUV.zw, f), v_flowUV.xy + h, v_flowUV.zw - h);
  return textureLod(u_flow, uv, 0.0).rg;
}
void main() {
  if (v_px.x < v_clip.x || v_px.y < v_clip.y || v_px.x > v_clip.z || v_px.y > v_clip.w) discard;
  // The frame at time t is the frame of a, moved part of the way along the
  // alignment. p is the point in the frame of a, and y the same point in
  // the frame of b.
  vec2 s = v_align.xy;
  vec2 tr = v_align.zw;
  vec2 k = mix(vec2(1.0), s, u_t);
  vec2 p = (v_q - u_t * tr) / k;
  vec2 y = p * s + tr;
  // The ink of a moves along the flow, and the ink of b comes back along it.
  vec2 d = flow(y);
  float b = u_blur * v_diff;
  float da = field(v_cellA, v_uvA, (y + u_t * d - tr) / s, b);
  float db = field(v_cellB, v_uvB, y - (1.0 - u_t) * d, b);
  // The distances in em of the frame at time t.
  float m = sqrt(s.x * s.y);
  float km = mix(1.0, m, u_t);
  float e = mix(da * km, db * km / m, u_t);
  // The distance in device pixels gives the coverage of the pixel.
  float a = clamp(e * v_size * u_dpr + 0.5, 0.0, 1.0) * v_col.a;
  o = vec4(v_col.rgb * a, a);
}`;

let gl = null;
let canvas = null;
let program = null;
let uView = null;
let uT = null;
let uDpr = null;
let uBlur = null;

export function setup() {
  if (gl) return true;
  canvas = document.createElement('canvas');
  canvas.className = 'morph-layer';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.morphSkip = '';
  gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    antialias: false,
  });
  if (!gl) return false;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  uView = gl.getUniformLocation(program, 'u_view');
  uT = gl.getUniformLocation(program, 'u_t');
  uDpr = gl.getUniformLocation(program, 'u_dpr');
  uBlur = gl.getUniformLocation(program, 'u_blur');
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'u_atlas'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'u_flow'), 1);
  return true;
}

const VEC4S = 13; // For each glyph.
export const FLOATS = VEC4S * 4;

// A float texture that the GPU can filter. 16 bits: 8 bits put steps in
// the edge.
function texture(unit, format, type, w, h, data) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, type, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function upload(atlas, flow, data, count) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (let i = 0; i < VEC4S; i++) {
    gl.enableVertexAttribArray(i + 1);
    gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
    gl.vertexAttribDivisor(i + 1, 1);
  }
  const textures = [
    texture(0, gl.R16F, gl.RED, atlas.W, atlas.H, atlas.atlas),
    texture(1, gl.RG16F, gl.RG, flow.W, flow.H, flow.data),
  ];
  return { vao, buffers: [corners, inst], textures, count };
}

export function draw(scene, t) {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(program);
  gl.uniform2f(uView, scene.vw, scene.vh);
  gl.uniform1f(uT, t);
  gl.uniform1f(uDpr, scene.dpr);
  // The blur is greatest halfway and zero at each end.
  gl.uniform1f(uBlur, scene.blur * Math.sin(Math.PI * t));
  gl.bindVertexArray(scene.vao);
  scene.textures.forEach((tex, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  });
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.count);
}

export function release(scene) {
  gl.deleteVertexArray(scene.vao);
  for (const b of scene.buffers) gl.deleteBuffer(b);
  for (const tex of scene.textures) gl.deleteTexture(tex);
}

// The layer canvas. setup() makes it.
export const layer = () => canvas;
export const maxTextureSize = () => gl.getParameter(gl.MAX_TEXTURE_SIZE);
