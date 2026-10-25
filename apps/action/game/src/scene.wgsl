// The scene shader: world boxes, players, targets and the view-model gun.
//
// Light: a low sun with a 3x3 PCF shadow map, a sky and ground hemisphere
// ambient, ambient occlusion from the box SDF, up to 52 point lights, a
// Blinn-Phong highlight with Fresnel, sky reflections on metal, height fog
// that takes the sun colour, and in-scatter: the haze glows around each
// point light. Each map light has a cube shadow map (render.zig), so walls
// stop its light, its highlights and its haze. Below the underground height
// there is no sun, a dim neutral ambient takes the place of the sky, each
// point light gives a fill, the air is clear near the eye and a thin dark
// fog starts far away, dirt collects in the corners and runs down the
// walls, and the floor has damp patches. The output is linear HDR.
// post.wgsl tone maps it.
//
// Vertex `mat`: the material id (map.zig Mat). 100 is added for the
// view-model: it gets the near depth range [0.92, 1], the world gets
// [0, 0.92], so the gun never goes into a wall. The camera uses reversed Z
// (render.zig, REQ-RENDER-001): depth 1 is the near plane, 0 the far plane,
// and a nearer fragment has a greater depth. 200 is added for a part
// that casts a shadow only: the head, the arms and the weapon of your own
// body (body.zig). The camera does not draw it.
//
// Your own body has its own light shadow layers (render.zig
// drawBodyShadows): `body_l` names the lights.

const MAX_LIGHTS: u32 = 52u;
// The first light shadow slot of your body: map.zig max_lights.
const BODY_SLOT: u32 = 36u;
// The LED grid of the train indicators: platform_display.zig pitch.
const LED_PITCH: f32 = 0.012;
// The cleats of an escalator tread (material 10): one cleat and one groove
// in each pitch, along X. A real tread has a pitch of about 8.5 mm.
const TREAD_PITCH: f32 = 0.01;
const TREAD_CLEAT: f32 = 0.4;

struct Scene {
  view_proj: mat4x4f,
  light_vp: mat4x4f,
  inv_vp: mat4x4f,
  cam: vec4f,      // xyz camera position, w time in seconds
  sun_dir: vec4f,  // xyz toward the sun
  sun_col: vec4f,
  info: vec4f,     // x unused, y light count, z fog density, w shadow on
  info2: vec4f,    // x underground height, y in-scatter strength, z exposure (post.wgsl), w light band (map.zig)
  body_l: vec4f,   // the light of each body slot: its index in lp and lc from 1, 0 none
  sealed_lo: vec4f, // map.zig sealed: a room with no sun, min and max
  sealed_hi: vec4f,
  cab_lo: array<vec4f, 4>, // the inside of each lift cab, w 1 (0: no cab)
  cab_hi: array<vec4f, 4>,
  grid_o: vec4f,   // the AO grid: xyz origin, w cell size
  grid_n: vec4f,   // xyz cell counts, w the length of the moving list
  lp: array<vec4f, 52>, // xyz position, w radius
  lc: array<vec4f, 52>, // rgb colour, w shadow map from 1 (0: none)
};

// mn.w: 1 when the AO uses the box (render.zig uploadBoxes).
struct BoxG { mn: vec4f, mx: vec4f };

@group(0) @binding(0) var<uniform> u: Scene;
@group(0) @binding(1) var<storage, read> boxes: array<BoxG>;
// The AO grid (ao_grid.zig): the offset of each cell list, then the box
// indices of the lists.
@group(0) @binding(6) var<storage, read> ao_grid: array<u32>;
// The boxes that the grid does not have where they are now.
@group(0) @binding(7) var<storage, read> ao_moving: array<u32>;
@group(0) @binding(2) var shadow_tex: texture_depth_2d;
@group(0) @binding(3) var shadow_smp: sampler_comparison;
// The light shadow maps: six layers (faces) for each map light. The light
// shadow pass reads the view-projection matrix of each layer.
@group(0) @binding(4) var light_shadow_tex: texture_depth_2d_array;
@group(0) @binding(5) var<storage, read> light_faces: array<mat4x4f>;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) mat: f32,
};

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) @interpolate(flat) mat: u32,
};

const VM_SPLIT: f32 = 0.08;

// The depth of the world in reversed Z: [0, 1 - VM_SPLIT]. A multiply keeps
// the float precision of a far depth (near 0).
fn worldDepth(c: vec4f) -> vec4f {
  return vec4f(c.xy, c.z * (1.0 - VM_SPLIT), c.w);
}

@vertex fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  var c = u.view_proj * vec4f(v.pos, 1.0);
  let m = u32(v.mat + 0.5);
  if (m >= 200u) {
    o.clip = vec4f(2.0, 2.0, 2.0, 1.0); // A shadow-only part.
    return o;
  }
  if (m >= 100u) {
    c.z = (1.0 - VM_SPLIT) * c.w + VM_SPLIT * c.z;
  } else {
    c = worldDepth(c);
  }
  o.clip = c;
  o.wpos = v.pos;
  o.nrm = v.nrm;
  o.col = v.col;
  o.mat = m;
  return o;
}

// ---- Shadow pass -----------------------------------------------------------

@vertex fn vs_shadow(v: VIn) -> @builtin(position) vec4f {
  if (v.mat >= 99.5 && v.mat < 199.5) {
    return vec4f(2.0, 2.0, 2.0, 1.0); // The view-model casts no shadow.
  }
  return u.light_vp * vec4f(v.pos, 1.0);
}

// ---- Light shadow pass -----------------------------------------------------
// render.zig drawLightShadows: one draw of the static mesh for each layer,
// and the instance index is the layer. The lamps (emissive) cast no shadow:
// their light comes from inside them. render.zig draw uses the same entry
// for the layers of your body.

@vertex fn vs_light_shadow(v: VIn, @builtin(instance_index) layer: u32) -> @builtin(position) vec4f {
  if (v.mat > 3.5 && v.mat < 4.5) {
    return vec4f(2.0, 2.0, 2.0, 1.0);
  }
  return light_faces[layer] * vec4f(v.pos, 1.0);
}

// ---- Noise -----------------------------------------------------------------

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.3183099 + vec3f(0.1, 0.2, 0.3));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

// hash3 of one corner, from the lattice terms of hash3 for each axis
// (q = fract(i * 0.3183099 + offset) * 17).
fn hashQ(x: f32, y: f32, z: f32) -> f32 {
  return fract(x * y * z * (x + y + z));
}

// The same values as 8 hash3 calls at the corners. The lattice term of each
// axis has two values (i and i + 1), so the function calculates each one
// time.
fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let q0 = fract(i * 0.3183099 + vec3f(0.1, 0.2, 0.3)) * 17.0;
  let q1 = fract((i + vec3f(1.0)) * 0.3183099 + vec3f(0.1, 0.2, 0.3)) * 17.0;
  return mix(
    mix(mix(hashQ(q0.x, q0.y, q0.z), hashQ(q1.x, q0.y, q0.z), w.x),
        mix(hashQ(q0.x, q1.y, q0.z), hashQ(q1.x, q1.y, q0.z), w.x), w.y),
    mix(mix(hashQ(q0.x, q0.y, q1.z), hashQ(q1.x, q0.y, q1.z), w.x),
        mix(hashQ(q0.x, q1.y, q1.z), hashQ(q1.x, q1.y, q1.z), w.x), w.y),
    w.z);
}

// ---- Band limits -----------------------------------------------------------
// A procedural pattern aliases when its cells get near the size of a pixel.
// Far away it then makes moire: false stripes that move with the camera.
// The functions here take the pixel footprint `fw`: the size of one pixel
// in the cells of the pattern. surface() gets it from the screen
// derivatives before its switch, because derivatives need uniform control
// flow. This is the method of texelNoiseFade in the swindowzig voxel demo.

// The fade of a pattern to its mean: 0 while a cell covers two pixels or
// more, 1 when a cell is the size of a pixel. A new pattern calls this one
// time: mix(pattern, mean, bandFade(fw)).
fn bandFade(fw: f32) -> f32 {
  return smoothstep(0.5, 1.0, fw);
}

// The integral of smoothstep(0, w, s) from s = 0 to t.
fn rampInt(t: f32, w: f32) -> f32 {
  let k = min(t / w, 1.0);
  return w * k * k * k * (1.0 - 0.5 * k) + max(t - w, 0.0);
}

// The integral from 0 to x of the joint profile
// smoothstep(0, w, min(fract(x), 1 - fract(x))). One cell gives 1 - w.
fn jointInt(x: f32, w: f32) -> f32 {
  let f = fract(x);
  let part = select(1.0 - w - rampInt(1.0 - f, w), rampInt(f, w), f <= 0.5);
  return floor(x) * (1.0 - w) + part;
}

// A joint (mortar, grout) at each edge of a cell, on one axis: 0 at the
// edge, 1 at `w` from it. f is the place in the cell, 0 to 1. The value is
// the mean of the profile over one pixel (a box filter), so the joint is
// smooth at each distance, and near it is the same as the profile. As a
// cell gets near the size of a pixel, it goes to the mean of a cell, 1 - w.
fn joint(f: f32, w: f32, fw: f32) -> f32 {
  let d = max(fw, 1e-4);
  let box = (jointInt(f + 0.5 * d, w) - jointInt(f - 0.5 * d, w)) / d;
  return mix(box, 1.0 - w, bandFade(fw));
}

// noise3 with a band limit: `fw` is the pixel footprint in lattice cells.
// The noise goes to its mean, 0.5. When it is all mean, the function does
// not calculate the noise.
fn noiseBL(p: vec3f, fw: f32) -> f32 {
  let k = bandFade(fw);
  if (k >= 1.0) { return 0.5; }
  return mix(noise3(p), 0.5, k);
}

// Fractal noise with a band limit: `fw` is the pixel footprint in lattice
// cells of p. Each octave is 2.03 times finer, and fades to its mean as its
// cells get near the size of a pixel. When one octave is all mean, the next
// octaves are too. Then the function adds their means and stops. fw 0 gives
// all four octaves.
fn fbm(p: vec3f, fw: f32) -> f32 {
  var a = 0.5;
  var q = p;
  var w = fw;
  var sum = 0.0;
  for (var i = 0; i < 4; i++) {
    let k = bandFade(w);
    // The means of this octave and the next: (a + a / 2 + ... + 1/16) / 2.
    if (k >= 1.0) { return sum + a - 0.03125; }
    sum += a * mix(noise3(q), 0.5, k);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.1);
    w *= 2.03;
    a *= 0.5;
  }
  return sum;
}

// smoothstep(lo, hi, fbm(p, fw)) with the same value. noise3 is 0 to 1, so
// the next octaves add 0 to (their amplitudes together) to the sum.
// When the sum plus that is less than lo, or the sum is more than hi, the
// smoothstep is 0 or 1 already. Then the function stops.
fn fbmStep(p: vec3f, lo: f32, hi: f32, fw: f32) -> f32 {
  var a = 0.5;
  var q = p;
  var w = fw;
  var sum = 0.0;
  for (var i = 0; i < 4; i++) {
    let k = bandFade(w);
    if (k >= 1.0) { return smoothstep(lo, hi, sum + a - 0.03125); }
    sum += a * mix(noise3(q), 0.5, k);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.1);
    w *= 2.03;
    // The octaves after octave i: a / 2 + a / 4 + ..., to octave 3.
    let left = a * (1.0 - exp2(f32(i) - 3.0));
    if (sum + left < lo) { return 0.0; }
    if (sum > hi) { return 1.0; }
    a *= 0.5;
  }
  return smoothstep(lo, hi, sum);
}

// ---- Sky -------------------------------------------------------------------

fn skyColor(d: vec3f, with_sun: bool) -> vec3f {
  let L = u.sun_dir.xyz;
  let y = d.y;
  let zenith = vec3f(0.07, 0.15, 0.38);
  let horizon = vec3f(1.05, 0.52, 0.26);
  let t = pow(clamp(y, 0.0, 1.0), 0.45);
  var c = mix(horizon, zenith, t);
  let sd = max(dot(d, L), 0.0);
  // The warm glow around the sun, wide and narrow.
  c += u.sun_col.rgb * (0.35 * pow(sd, 6.0) + 0.6 * pow(sd, 64.0));
  if (y < 0.0) {
    c = mix(c, vec3f(0.30, 0.22, 0.18), smoothstep(0.0, -0.15, y));
  }
  if (with_sun) {
    c += u.sun_col.rgb * 30.0 * smoothstep(0.9993, 0.9997, sd);
    // Clouds: a sheet of fbm on a plane high above the map.
    if (y > 0.01) {
      let p = d / y * 400.0;
      let n = fbm(vec3f(p.xz * 0.0045 + vec2f(u.cam.w * 0.004, 0.0), 0.0), 0.0);
      let cover = smoothstep(0.48, 0.78, n);
      let lit = mix(vec3f(0.55, 0.42, 0.48), vec3f(1.25, 0.78, 0.52), pow(sd, 3.0));
      c = mix(c, lit + u.sun_col.rgb * 0.5 * pow(sd, 20.0), cover * smoothstep(0.01, 0.15, y) * 0.85);
    }
  }
  return c;
}

// ---- Shadows and occlusion -------------------------------------------------

fn sunShadow(wp: vec3f, n: vec3f) -> f32 {
  let lp = u.light_vp * vec4f(wp + n * 0.05, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + vec2f(0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z > 1.0) {
    return 1.0;
  }
  let z = lp.z - 0.0008;
  let texel = 1.0 / 2048.0;
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      sum += textureSampleCompareLevel(shadow_tex, shadow_smp, uv + vec2f(f32(x), f32(y)) * texel * 1.25, z);
    }
  }
  return sum / 9.0;
}

// render.zig light_face_tan and light_near.
const LIGHT_FACE_TAN: f32 = 256.0 / 250.0;
const LIGHT_NEAR: f32 = 0.05;

// The light of map light `slot` (from 0) at the point p: 1 where it
// reaches p, 0 where a wall hides p. `lp` is the light position and radius.
// The face is the main axis of p - lp. q is p in that face: x and y across
// it, z along it. This is the same as the face matrix of render.zig
// lightFace, without a matrix read. One compare tap filters 2x2 texels.
fn lightShadow(slot: u32, lp: vec4f, p: vec3f) -> f32 {
  let v = p - lp.xyz;
  let a = abs(v);
  var face: u32;
  var q: vec3f;
  if (a.x >= a.y && a.x >= a.z) {
    face = select(1u, 0u, v.x > 0.0);
    q = select(vec3f(-v.z, v.y, -v.x), vec3f(v.z, v.y, v.x), v.x > 0.0);
  } else if (a.y >= a.z) {
    face = select(3u, 2u, v.y > 0.0);
    q = select(vec3f(-v.x, v.z, -v.y), vec3f(v.x, v.z, v.y), v.y > 0.0);
  } else {
    face = select(5u, 4u, v.z > 0.0);
    q = select(vec3f(v.x, v.y, -v.z), vec3f(-v.x, v.y, v.z), v.z > 0.0);
  }
  let uv = q.xy / (q.z * LIGHT_FACE_TAN) * vec2f(0.5, -0.5) + vec2f(0.5);
  let depth = lp.w / (lp.w - LIGHT_NEAR) * (1.0 - LIGHT_NEAR / q.z);
  return textureSampleCompareLevel(light_shadow_tex, shadow_smp, uv, slot * 6u + face, depth);
}

fn sdBox(p: vec3f, mn: vec3f, mx: vec3f) -> f32 {
  let c = (mn + mx) * 0.5;
  let h = (mx - mn) * 0.5;
  let q = abs(p - c) - h;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// The distances of the four AO samples to box i, into d. A box further than
// 1.3 m from the point cannot occlude, so the function skips it after one test.
fn aoBox(i: u32, p: vec3f, n: vec3f, d: vec4f) -> vec4f {
  let b = boxes[i];
  if (b.mn.w == 0.0 || sdBox(p, b.mn.xyz, b.mx.xyz) > 1.3) {
    return d;
  }
  return min(d, vec4f(
    sdBox(p + n * 0.08, b.mn.xyz, b.mx.xyz),
    sdBox(p + n * 0.25, b.mn.xyz, b.mx.xyz),
    sdBox(p + n * 0.55, b.mn.xyz, b.mx.xyz),
    sdBox(p + n * 1.0, b.mn.xyz, b.mx.xyz)));
}

// Ambient occlusion: four SDF samples along the normal. The boxes come from
// the cell of the point in the AO grid (each box that can be 1.3 m or less
// from a point of the cell), and from the moving list. A box in both lists
// gives the same minimum.
fn ambientOcclusion(p: vec3f, n: vec3f) -> f32 {
  var d = vec4f(9.0);
  let q = floor((p - u.grid_o.xyz) / u.grid_o.w);
  if (all(q >= vec3f(0.0)) && all(q < u.grid_n.xyz)) {
    let c = u32(q.x) + u32(u.grid_n.x) * (u32(q.y) + u32(u.grid_n.y) * u32(q.z));
    let end = ao_grid[c + 1u];
    for (var k = ao_grid[c]; k < end; k++) {
      d = aoBox(ao_grid[k], p, n, d);
    }
  }
  let moving = u32(u.grid_n.w);
  for (var k = 0u; k < moving; k++) {
    d = aoBox(ao_moving[k], p, n, d);
  }
  var occ = 0.0;
  occ += max(0.08 - d.x, 0.0) * 1.0;
  occ += max(0.25 - d.y, 0.0) * 0.7;
  occ += max(0.55 - d.z, 0.0) * 0.45;
  occ += max(1.0 - d.w, 0.0) * 0.3;
  return clamp(1.0 - 1.1 * occ, 0.0, 1.0);
}

// 1 above ground, 0 underground: below the underground height. The light
// changes in the band above that height (map.zig light_band).
fn outdoors(y: f32) -> f32 {
  return smoothstep(u.info2.x, u.info2.x + u.info2.w, y);
}

// 0 in the sealed room (map.zig sealed) and in a lift cab, 1 out of them:
// the sun, most of the sky light and the sky reflection stop at their
// walls.
fn unsealed(p: vec3f) -> f32 {
  var inside = all(p > u.sealed_lo.xyz) && all(p < u.sealed_hi.xyz);
  for (var i = 0u; i < 4u; i++) {
    let lo = u.cab_lo[i];
    inside = inside || (lo.w > 0.5 && all(p > lo.xyz) && all(p < u.cab_hi[i].xyz));
  }
  return select(1.0, 0.0, inside);
}

// ---- Materials -------------------------------------------------------------

// px: the size of one pixel on the surface, in metres (the band limits).
struct Surface { albedo: vec3f, n: vec3f, rough: f32, metal: f32, emit: f32, px: f32 };

fn surface(col: vec3f, mat: u32, wp: vec3f, n0: vec3f) -> Surface {
  var s: Surface;
  s.albedo = col;
  s.n = n0;
  s.rough = 0.8;
  s.metal = 0.0;
  s.emit = 0.0;
  let an = abs(n0);
  // A 2D face coordinate: the two axes along the face.
  var uv = wp.xz;
  // The pixel footprint in metres, on each world axis and on each face
  // axis (see Band limits): the larger step of the two screen axes. The
  // sum of the two (fwidth) is up to two times too large, and blurs
  // too much at a grazing angle. Derivatives must be in uniform control
  // flow: here, not in the switch. px is the largest axis, for the 3D
  // noise. The LEDs keep fwidth (led_fw) for their dot edge.
  let dx = abs(dpdx(wp));
  let dy = abs(dpdy(wp));
  let fw = max(dx, dy);
  var fw_uv = fw.xz;
  var led_fw = dx.xz + dy.xz;
  if (an.x > 0.5) {
    uv = wp.zy;
    fw_uv = fw.zy;
    led_fw = dx.zy + dy.zy;
  } else if (an.z > 0.5) {
    uv = wp.xy;
    fw_uv = fw.xy;
    led_fw = dx.xy + dy.xy;
  }
  let px = max(fw.x, max(fw.y, fw.z));
  s.px = px;
  switch (mat) {
    case 1u: { // concrete
      let k = 0.82 + 0.2 * fbm(wp * 1.7, px * 1.7) + 0.06 * noiseBL(wp * 14.0, px * 14.0);
      s.albedo = col * k;
      s.rough = 0.85;
    }
    case 2u: { // floor tiles, 2 m, with a dark joint
      let cell = floor(wp.xz / 2.0);
      let f = fract(wp.xz / 2.0);
      let fc = fw.xz / 2.0;
      let jt = joint(f.x, 0.025, fc.x) * joint(f.y, 0.025, fc.y);
      // The colour and the gloss of each tile go to their means as a tile
      // gets near the size of a pixel.
      let fade = bandFade(max(fc.x, fc.y));
      let tone = 0.9 + 0.16 * mix(hash3(vec3f(cell, 1.0)), 0.5, fade) + 0.08 * noiseBL(wp * 3.0, px * 3.0);
      s.albedo = col * tone * mix(0.45, 1.0, jt);
      s.rough = mix(0.9, 0.45, jt * mix(hash3(vec3f(cell, 7.0)), 0.5, fade));
    }
    case 3u: { // corrugated metal: the normal waves along the face
      // One wave is 2 / 9 m. The waves go flat from 4 pixels a wave to 2,
      // before the highlight sparkles. The roughness then takes their place.
      let flat_k = bandFade(fw_uv.x * 9.0);
      if (an.y < 0.5) {
        let a = uv.x * 9.0;
        var t = vec3f(1.0, 0.0, 0.0);
        if (an.x > 0.5) { t = vec3f(0.0, 0.0, 1.0); }
        s.n = normalize(n0 + t * sin(a * 3.14159) * 0.35 * (1.0 - flat_k));
      }
      let grime = fbm(wp * 0.8, px * 0.8);
      s.albedo = col * (0.75 + 0.35 * grime);
      s.rough = mix(0.45, 0.6, flat_k);
      s.metal = 0.6;
    }
    case 4u: { // emissive
      s.emit = 7.0;
    }
    case 5u: { // wood: planks
      let lines = joint(fract(uv.y * 4.0), 0.06, fw_uv.y * 4.0);
      let grain = 0.85 + 0.15 * noiseBL(vec3f(uv.x * 1.5, uv.y * 30.0, 0.0), max(fw_uv.x * 1.5, fw_uv.y * 30.0));
      s.albedo = col * grain * mix(0.55, 1.0, lines);
      s.rough = 0.75;
    }
    case 6u: { // cloth
      s.albedo = col * (0.9 + 0.1 * noiseBL(wp * 40.0, px * 40.0));
      s.rough = 0.95;
    }
    case 7u: { // glazed wall tiles, 150 x 75 mm, with grout
      let t = uv / vec2f(0.15, 0.075);
      let fc = fw_uv / vec2f(0.15, 0.075);
      let row = floor(t.y);
      let tx = t.x + 0.5 * (row % 2.0);
      let f = vec2f(fract(tx), fract(t.y));
      let grout = joint(f.x, 0.06, fc.x) * joint(f.y, 0.03, fc.y);
      let id = vec3f(floor(tx), row, 3.0);
      // Some tiles are a shade off, a few are cracked or stained. Far away
      // the mean tone: 0.9 + 0.12 * 0.5 - 0.25 * 0.03.
      let tone = 0.9 + 0.12 * hash3(id) - 0.25 * step(0.97, hash3(id + 9.0));
      let fc_max = max(fc.x, fc.y);
      s.albedo = col * mix(tone, 0.9525, bandFade(fc_max)) * mix(0.35, 1.0, grout);
      s.rough = mix(0.8, 0.12, grout);
      // The glaze: each tile bows a little. The bow goes flat from 4 pixels
      // a tile to 2, before the highlight sparkles.
      if (an.y < 0.5) {
        var tt = vec3f(1.0, 0.0, 0.0);
        if (an.x > 0.5) { tt = vec3f(0.0, 0.0, 1.0); }
        let bow = 0.12 * (1.0 - bandFade(fc_max * 2.0));
        s.n = normalize(n0 + tt * (f.x - 0.5) * bow + vec3f(0.0, 1.0, 0.0) * (f.y - 0.5) * bow);
      }
    }
    case 8u: { // brick, stretcher bond
      let t = uv / vec2f(0.225, 0.075);
      let fc = fw_uv / vec2f(0.225, 0.075);
      let row = floor(t.y);
      let tx = t.x + 0.5 * (row % 2.0);
      let f = vec2f(fract(tx), fract(t.y));
      let mortar = joint(f.x, 0.05, fc.x) * joint(f.y, 0.05 / 3.0, fc.y);
      let id = vec3f(floor(tx), row, 5.0);
      let shade_k = mix(hash3(id), 0.5, bandFade(max(fc.x, fc.y)));
      let tone = 0.75 + 0.35 * shade_k + 0.1 * noiseBL(wp * 6.0, px * 6.0);
      s.albedo = mix(vec3f(0.42, 0.4, 0.36), col * tone, mortar);
      s.rough = 0.9;
    }
    case 9u: { // LEDs: a round dot in each cell of the grid, black between
      let led = uv / LED_PITCH;
      let led_w = length(led_fw) / LED_PITCH;
      let d = length(fract(led) - 0.5);
      let w = max(led_w, 0.001);
      let dot = 1.0 - smoothstep(0.34 - w, 0.34 + w, d);
      // Far away a cell is smaller than a pixel: the mean of the dot.
      let k = mix(dot, 0.36, bandFade(w));
      // A little above 0, so the black between the dots stays emissive.
      s.emit = 7.0 * k + 0.001;
    }
    case 10u: { // escalator treads: the cleats run along X
      // The box filter of the cleat stripe over the pixel footprint (see
      // Band limits): the integral of the stripe from x - w / 2 to
      // x + w / 2, over w. Far away it is the mean, so the grooves do not
      // alias.
      let cleat = wp.z / TREAD_PITCH;
      let cleat_w = max(fw.z / TREAD_PITCH, 0.0001);
      let a = cleat - 0.5 * cleat_w;
      let b = cleat + 0.5 * cleat_w;
      let ia = floor(a) * TREAD_CLEAT + min(fract(a), TREAD_CLEAT);
      let ib = floor(b) * TREAD_CLEAT + min(fract(b), TREAD_CLEAT);
      let k = (ib - ia) / cleat_w;
      s.albedo = col * mix(0.3, 1.25, k);
      s.rough = mix(0.75, 0.35, k);
      s.metal = 0.7;
    }
    case 11u: { // brushed steel: a fine grain along the face Y axis
      // Streaks a few mm wide across the grain, long along it. Each band
      // goes to its mean as its streaks get near the size of a pixel.
      let fine = noiseBL(vec3f(uv.x * 220.0, uv.y * 2.5, 0.0), max(fw_uv.x * 220.0, fw_uv.y * 2.5));
      let wide = noiseBL(vec3f(uv.x * 45.0, uv.y * 0.8, 4.0), max(fw_uv.x * 45.0, fw_uv.y * 0.8));
      s.albedo = col * (0.86 + 0.12 * fine + 0.16 * wide);
      s.rough = 0.45 + 0.1 * fine;
      s.metal = 0.6;
    }
    case 12u: { // glazed terracotta blocks, 600 x 300 mm, in stretcher bond
      let t = uv / vec2f(0.6, 0.3);
      let fc = fw_uv / vec2f(0.6, 0.3);
      let row = floor(t.y);
      let tx = t.x + 0.5 * (row % 2.0);
      let f = vec2f(fract(tx), fract(t.y));
      let jt = joint(f.x, 0.012, fc.x) * joint(f.y, 0.024, fc.y);
      let id = vec3f(floor(tx), row, 12.0);
      let fade = bandFade(max(fc.x, fc.y));
      let tone = 0.88 + 0.2 * mix(hash3(id), 0.5, fade) + 0.06 * noiseBL(wp * 2.0, px * 2.0);
      s.albedo = col * tone * mix(0.72, 1.0, jt);
      s.rough = mix(0.75, 0.3, jt);
    }
    default: { // paint, and the gun
      s.rough = 0.4;
      s.metal = 0.35;
    }
  }
  return s;
}

// The haze starts this far from the eye. Nearer air gives no haze, so a
// short view (inside a car, along a passage) stays clear, and a light just
// over the head does not lift the whole view.
const HAZE_NEAR: f32 = 4.0;

// The haze in front of a point light: the integral of 1 / d^2 along the
// view ray, from HAZE_NEAR to the surface (`far`). Most of it comes from the
// ray point nearest to the light. If a wall hides that point from a map
// light, that light gives no haze (a lamp behind a wall does not glow
// through it).
//
// `limit`: the loop skips a light whose haze is `limit` or less in each
// channel (see haze). It skips the light before the atan when the upper
// bound of its haze is in the limit, and before the shadow sample when its
// haze with no shadow is in the limit. The bound of k: the integral over
// the full line is pi / h at most, and the integral over the ray is the
// ray length / (the distance from the light to the ray)^2 at most.
fn inScatter(ro: vec3f, rd: vec3f, far: f32, limit: vec3f) -> vec3f {
  var acc = vec3f(0.0);
  let nl = u32(u.info.y);
  let t0 = HAZE_NEAR;
  for (var i = 0u; i < nl; i++) {
    let lp = u.lp[i].xyz;
    let lc = u.lc[i].rgb;
    let tc = dot(lp - ro, rd);
    let h = max(length(ro + rd * tc - lp), 0.25);
    let near = distance(lp, ro + rd * clamp(tc, t0, far));
    let k_max = min(3.14159265 / h, (far - t0) / max(near * near, 1e-6));
    if (all(lc * k_max <= limit)) {
      continue;
    }
    var k = (atan((far - tc) / h) - atan((t0 - tc) / h)) / h;
    if (all(lc * k <= limit)) {
      continue;
    }
    let slot = u32(u.lc[i].w + 0.5);
    if (slot > 0u) {
      // A little in front of the surface, so the surface does not shadow it.
      let q = ro + rd * clamp(tc, t0, max(far - 0.1, t0));
      if (distance(q, lp) < u.lp[i].w) {
        k *= lightShadow(slot - 1u, u.lp[i], q);
      }
    }
    acc += lc * k;
  }
  return acc;
}

// The tone map of post.wgsl fs_final: the exposure, the colour weights,
// ACES, the gamma. HAZE_STEP: the largest change of an output pixel that the
// haze culling can make, half of one 8-bit step (the dither is one step).
const TONE_W = vec3f(1.02, 1.0, 0.97);
const HAZE_STEP: f32 = 0.5 / 255.0;
// The haze strength underground. The air of a station is clear: the haze
// shows only around a bright light and over a long view.
const HAZE_UNDER: f32 = 0.007;

// The slope of the output (after the tone map and the gamma) for each
// channel of the HDR colour c. The curve is concave for c >= 0, at each
// exposure that main.zig uses (0.68 to 1.63). Thus an increase d of c
// changes the output by slope(c) * d or less. The bloom and the vignette
// only make the slope smaller.
fn toneSlope(c: vec3f) -> vec3f {
  let e = u.info2.z * TONE_W;
  let x = max(c, vec3f(0.0)) * e;
  let num = x * (2.51 * x + 0.03);
  let den = x * (2.43 * x + 0.59) + 0.14;
  let y = num / den;
  let dy = ((5.02 * x + 0.03) * den - num * (4.86 * x + 0.59)) / (den * den);
  // Above 1 the tone map clamps: the slope is 0.
  let s = select(dy, vec3f(0.0), y >= vec3f(1.0));
  return (1.0 / 2.2) * pow(max(y, vec3f(1e-12)), vec3f(1.0 / 2.2 - 1.0)) * s * e;
}

// The haze to add to a pixel of HDR colour `base`. The limit of each light
// is HAZE_STEP / slope(base), divided by the light count and the haze
// strength. Thus all the skipped lights together change the output pixel
// by HAZE_STEP or less.
fn haze(ro: vec3f, rd: vec3f, far: f32, base: vec3f, out_k: f32) -> vec3f {
  if (far <= HAZE_NEAR) {
    return vec3f(0.0);
  }
  let strength = u.info2.y * mix(HAZE_UNDER, 0.004, out_k);
  let per_light = max(strength * u.info.y, 1e-9);
  let limit = HAZE_STEP / max(toneSlope(base), vec3f(1e-9)) / per_light;
  return inScatter(ro, rd, far, limit) * strength;
}

// ---- Lighting --------------------------------------------------------------

// The ambient light underground, in place of the sky.
const UNDER_AMB = vec3f(0.04, 0.038, 0.034);
// The fill of each point light underground (see shade).
const LIGHT_FILL: f32 = 0.35;

fn shade(in: VOut, front: bool) -> vec3f {
  let vm = in.mat >= 100u;
  let mat = in.mat % 100u;
  var n0 = normalize(in.nrm);
  if (!front) { n0 = -n0; }
  var s = surface(in.col, mat, in.wpos, n0);
  let out_k = outdoors(in.wpos.y);
  let to_cam = u.cam.xyz - in.wpos;
  let dist = length(to_cam);
  let V = to_cam / dist;
  if (s.emit > 0.0) {
    var e = s.albedo * s.emit;
    if (!vm) { e += haze(u.cam.xyz, -V, dist, e, out_k); }
    return e;
  }
  var ao = 1.0;
  if (!vm) { ao = ambientOcclusion(in.wpos, n0); }
  var wet = 0.0;

  // Grime: dirt in the corners (where the AO is), streaks down the walls,
  // and damp patches on the floor. More of it underground.
  if (!vm && mat != 4u) {
    let dirt = mix(1.3, 0.45, out_k);
    s.albedo *= mix(1.0, 0.55, (1.0 - ao) * dirt);
    if (abs(n0.y) < 0.5) {
      let streak = fbmStep(vec3f(in.wpos.x * 3.1 + in.wpos.z * 2.3, in.wpos.y * 0.25, in.wpos.z * 0.7), 0.5, 0.8, s.px * 4.0);
      // Water stains down the walls underground; outside they are faint.
      s.albedo *= 1.0 - streak * mix(0.3, 0.06, out_k);
    }
    if (n0.y > 0.5) {
      let soil = fbmStep(in.wpos * 0.9, 0.45, 0.75, s.px * 0.9);
      s.albedo *= 1.0 - soil * 0.3 * dirt;
      // Small damp patches: a little darker and a little glossy. They are
      // not puddles. Outside (out_k 1) there are none.
      if (out_k < 1.0) {
        wet = fbmStep(in.wpos * vec3f(0.35, 1.0, 0.35) + 3.0, 0.57, 0.67, s.px) * (1.0 - out_k);
      }
      s.albedo *= 1.0 - wet * 0.25;
      s.rough = mix(s.rough, 0.45, wet);
    }
    if (n0.y < -0.5) {
      s.albedo *= mix(1.0, 0.5, 1.0 - out_k); // soot on the ceilings
    }
  }

  let N = s.n;
  let L = u.sun_dir.xyz;
  let H = normalize(L + V);
  let ndl = max(dot(N, L), 0.0);
  let ndv = max(dot(N, V), 0.0);
  let open_k = unsealed(in.wpos);
  var shadow = out_k * open_k;
  if (u.info.w > 0.5 && shadow > 0.0) {
    if (vm) {
      // The gun tests a point 0.8 m from the eye toward the sun. Your own
      // body is behind and below that point, so its shadow does not fall
      // on the gun. A gun in a wall does not go dark.
      shadow *= sunShadow(u.cam.xyz + L * 0.8, L);
    } else {
      shadow *= sunShadow(in.wpos, n0);
    }
  }

  let shin = mix(512.0, 8.0, s.rough);
  let f0 = mix(vec3f(0.04), s.albedo, s.metal);
  let fres = f0 + (vec3f(1.0) - f0) * pow(1.0 - ndv, 5.0);
  let spec = pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / 25.0;
  let diff = s.albedo * (1.0 - s.metal * 0.7);

  var c = u.sun_col.rgb * ndl * shadow * (diff + fres * spec);

  // Hemisphere ambient: sky above, warm ground bounce below. Underground
  // a dim neutral light takes its place: the light that the tiles bounce.
  // The AO keeps the corners dark.
  let sky_amb = vec3f(0.22, 0.30, 0.48);
  let gnd_amb = vec3f(0.30, 0.20, 0.14);
  let hemi_out = mix(gnd_amb, sky_amb, N.y * 0.5 + 0.5);
  let hemi = mix(UNDER_AMB, hemi_out, out_k) * mix(0.15, 1.0, open_k);
  c += diff * hemi * ao;
  // Sky reflection.
  let R = reflect(-V, N);
  var refl = 0.6;
  if (vm) { refl = 0.1; } // The sky behind the camera is not the one in front.
  c += skyColor(R, false) * fres * (1.0 - s.rough) * ao * refl * out_k * open_k;

  // Point lights. A map light tests its shadow map: no light, highlight or
  // glint where a wall hides the point. The gun tests the eye position: it
  // can reach into a wall, and the part in the wall must not go dark.
  // Underground each light also gives a fill: a part of its diffuse light
  // that does not fall off with the angle. It is the light that bounces
  // off the tiles near the lamp, so a vault or a wall at a low angle to a
  // lamp is lit. It fades to 0 at the shadow line (ndl 0), so the edge
  // stays smooth.
  let fill = LIGHT_FILL * (1.0 - out_k);
  let nl = u32(u.info.y);
  for (var i = 0u; i < nl; i++) {
    let d = u.lp[i].xyz - in.wpos;
    let ld = length(d);
    let r = u.lp[i].w;
    if (ld >= r) { continue; }
    let l = d / ld;
    let ndl_i = max(dot(N, l), 0.0);
    if (ndl_i <= 0.0 && wet <= 0.01) { continue; }
    var vis = 1.0;
    let slot = u32(u.lc[i].w + 0.5);
    if (slot > 0u) {
      // Normal offset: about 1.5 texels of the shadow map at this distance.
      var sp = in.wpos + n0 * (0.02 + 0.012 * ld);
      if (vm) { sp = u.cam.xyz; }
      vis = lightShadow(slot - 1u, u.lp[i], sp);
      // The shadow of your body. The gun tests the eye, and it skips this
      // test, as it does for the sun.
      if (!vm) {
        for (var d = 0u; d < 4u; d++) {
          if (u32(u.body_l[d] + 0.5) == i + 1u) { vis *= lightShadow(BODY_SLOT + d, u.lp[i], sp); }
        }
      }
      if (vis <= 0.0) { continue; }
    }
    let k = 1.0 - (ld * ld) / (r * r);
    let att = k * k / (1.0 + ld * ld * 0.35);
    let h2 = normalize(l + V);
    let sp_i = pow(max(dot(N, h2), 0.0), shin) * (shin + 8.0) / 25.0;
    let wrap = ndl_i + fill * min(ndl_i * 5.0, 1.0);
    c += u.lc[i].rgb * att * (diff * wrap + fres * sp_i * ndl_i) * mix(1.0, ao, 0.5) * vis;
    // A damp floor gives a narrow glint toward each light.
    if (wet > 0.01) {
      let g = pow(max(dot(R, l), 0.0), 320.0) * 1.2;
      c += u.lc[i].rgb * g * wet * k / (1.0 + ld * ld * 0.015) * vis;
    }
  }
  if (vm) {
    // A soft rim keeps the gun readable against a dark wall.
    c += vec3f(0.5, 0.42, 0.36) * pow(1.0 - ndv, 3.0) * 0.25 * mix(0.3, 1.0, out_k);
  }

  if (!vm) {
    c = fog(c, in.wpos, dist, -V, out_k);
    c += haze(u.cam.xyz, -V, dist, c, out_k);
  }
  return c;
}

// The fog underground: none in the first FOG_NEAR m, then a thin dark fog.
// A long tunnel fades into the dark, but a car, a passage or the near part
// of a platform has clear air.
const FOG_NEAR: f32 = 15.0;
const FOG_UNDER: f32 = 0.005;

// The far fog outside: past FAR_NEAR the air of the city thickens. A long
// street (Warwick Road) fades out before the far plane (260 m). The views
// of the station are nearer than FAR_NEAR.
const FAR_NEAR: f32 = 80.0;
const FAR_DENS: f32 = 0.015;

// Fog: thin warm haze outside, a thin dark fog far away underground. `vd`
// is the view direction, from the eye to the point.
fn fog(c: vec3f, wp: vec3f, dist: f32, vd: vec3f, out_k: f32) -> vec3f {
  let dens_out = u.info.z * exp(-max(wp.y, 0.0) * 0.12);
  let dens = mix(FOG_UNDER, dens_out, out_k);
  let f_near = 1.0 - exp(-max(dist - FOG_NEAR * (1.0 - out_k), 0.0) * dens);
  let f_far = (1.0 - exp(-max(dist - FAR_NEAR, 0.0) * FAR_DENS)) * out_k;
  let f = 1.0 - (1.0 - f_near) * (1.0 - f_far);
  let fc_out = skyColor(normalize(vec3f(vd.x, max(vd.y, 0.02), vd.z)), false);
  let fc = mix(vec3f(0.012, 0.011, 0.01), fc_out, out_k);
  return mix(c, fc, f);
}

@fragment fn fs_main(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  return vec4f(shade(in, front), 1.0);
}

// ---- Sky pass --------------------------------------------------------------

struct SkyOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };

@vertex fn vs_sky(@builtin(vertex_index) i: u32) -> SkyOut {
  var o: SkyOut;
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  // The far plane: depth 0 in reversed Z.
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

@fragment fn fs_sky(in: SkyOut) -> @location(0) vec4f {
  // Reversed Z: depth 1 is the near plane, 0 the far plane.
  let a = u.inv_vp * vec4f(in.ndc, 1.0, 1.0);
  let b = u.inv_vp * vec4f(in.ndc, 0.0, 1.0);
  let d = normalize(b.xyz / b.w - a.xyz / a.w);
  return vec4f(skyColor(d, true), 1.0);
}

// ---- Translucent pass ------------------------------------------------------
// Smoke and the debug blast volume (grenade.zig). Alpha blended, drawn after
// the opaque scene with the depth test on and no depth write.
//   - mat < 0: a billboard. nrm.xy is the quad UV in [-1, 1], nrm.z the
//     emission, -mat the alpha. The alpha falls off to the edge, so a quad
//     is a soft round puff.
//   - mat > 0: a shaded volume. nrm is the face normal, mat the alpha.
// The light is simple: the hemisphere ambient, the sun (no shadow), the
// point lights and the same fog as the opaque scene.

struct TOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) mat: f32,
};

@vertex fn vs_trans(v: VIn) -> TOut {
  var o: TOut;
  o.clip = worldDepth(u.view_proj * vec4f(v.pos, 1.0));
  o.wpos = v.pos;
  o.nrm = v.nrm;
  o.col = v.col;
  o.mat = v.mat;
  return o;
}

@fragment fn fs_trans(in: TOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let to_cam = u.cam.xyz - in.wpos;
  let dist = length(to_cam);
  let V = to_cam / dist;
  let out_k = outdoors(in.wpos.y);
  var alpha = abs(in.mat);
  var N = V;
  var emit = 0.0;
  if (in.mat < 0.0) {
    let r2 = dot(in.nrm.xy, in.nrm.xy);
    if (r2 >= 1.0) { discard; }
    // A soft edge, and a little noise so the puffs do not look like discs.
    let wisp = 0.75 + 0.5 * noise3(in.wpos * 3.0 + vec3f(0.0, -u.cam.w * 0.4, 0.0));
    alpha = alpha * (1.0 - r2) * (1.0 - r2) * wisp;
    emit = in.nrm.z;
  } else {
    N = normalize(in.nrm);
    if (!front) { N = -N; }
    // A volume fades out near the eye, so it does not fill the view.
    alpha = alpha * smoothstep(0.6, 3.0, dist);
  }
  if (emit > 0.0) {
    return vec4f(in.col * emit, clamp(alpha, 0.0, 1.0));
  }
  let sky_amb = vec3f(0.22, 0.30, 0.48);
  let gnd_amb = vec3f(0.30, 0.20, 0.14);
  var light = mix(gnd_amb, sky_amb, N.y * 0.5 + 0.5) * mix(0.05, 1.0, out_k);
  // A billboard takes the sun from all sides (smoke scatters it).
  var ndl = 0.5;
  if (in.mat > 0.0) { ndl = max(dot(N, u.sun_dir.xyz), 0.0); }
  light += u.sun_col.rgb * ndl * out_k * 0.6;
  let nl = u32(u.info.y);
  for (var i = 0u; i < nl; i++) {
    let d = u.lp[i].xyz - in.wpos;
    let ld = length(d);
    let r = u.lp[i].w;
    if (ld < r) {
      let k = 1.0 - (ld * ld) / (r * r);
      light += u.lc[i].rgb * k * k / (1.0 + ld * ld * 0.35) * 0.6;
    }
  }
  let c = fog(in.col * light, in.wpos, dist, -V, out_k);
  return vec4f(c, clamp(alpha, 0.0, 1.0));
}
