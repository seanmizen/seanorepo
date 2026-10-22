// The scene shader: world boxes, players, targets and the view-model gun.
//
// Light: a low sun with a 3x3 PCF shadow map, a sky and ground hemisphere
// ambient, ambient occlusion from the box SDF, up to 24 point lights, a
// Blinn-Phong highlight with Fresnel, sky reflections on metal, height fog
// that takes the sun colour, and in-scatter: the haze glows around each
// point light. Below the underground height there is no sun, the ambient
// falls away, the fog thickens and darkens, dirt collects in the corners
// and runs down the walls, and the floor has wet patches. The output is
// linear HDR. post.wgsl tone maps it.
//
// Vertex `mat`: the material id (map.zig Mat). 100 is added for the
// view-model: it gets the near depth range [0, 0.08], the world gets
// [0.08, 1], so the gun never goes into a wall.

const MAX_LIGHTS: u32 = 24u;

struct Scene {
  view_proj: mat4x4f,
  light_vp: mat4x4f,
  inv_vp: mat4x4f,
  cam: vec4f,      // xyz camera position, w time in seconds
  sun_dir: vec4f,  // xyz toward the sun
  sun_col: vec4f,
  info: vec4f,     // x AO box count, y light count, z fog density, w shadow on
  info2: vec4f,    // x underground height, y in-scatter strength
  lp: array<vec4f, 24>, // xyz position, w radius
  lc: array<vec4f, 24>, // rgb colour
};

struct BoxG { mn: vec4f, mx: vec4f };

@group(0) @binding(0) var<uniform> u: Scene;
@group(0) @binding(1) var<storage, read> boxes: array<BoxG>;
@group(0) @binding(2) var shadow_tex: texture_depth_2d;
@group(0) @binding(3) var shadow_smp: sampler_comparison;

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

@vertex fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  var c = u.view_proj * vec4f(v.pos, 1.0);
  let m = u32(v.mat + 0.5);
  if (m >= 100u) {
    c.z = c.z * VM_SPLIT;
  } else {
    c.z = VM_SPLIT * c.w + (1.0 - VM_SPLIT) * c.z;
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
  if (v.mat >= 99.5) {
    return vec4f(2.0, 2.0, 2.0, 1.0); // The view-model casts no shadow.
  }
  return u.light_vp * vec4f(v.pos, 1.0);
}

// ---- Noise -----------------------------------------------------------------

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.3183099 + vec3f(0.1, 0.2, 0.3));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), w.x),
        mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), w.x), w.y),
    mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), w.x),
        mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), w.x), w.y),
    w.z);
}

fn fbm(p: vec3f) -> f32 {
  var a = 0.5;
  var q = p;
  var sum = 0.0;
  for (var i = 0; i < 4; i++) {
    sum += a * noise3(q);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return sum;
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
      let n = fbm(vec3f(p.xz * 0.0045 + vec2f(u.cam.w * 0.004, 0.0), 0.0));
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

fn sdBox(p: vec3f, mn: vec3f, mx: vec3f) -> f32 {
  let c = (mn + mx) * 0.5;
  let h = (mx - mn) * 0.5;
  let q = abs(p - c) - h;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Ambient occlusion: four SDF samples along the normal. A box further than
// 1.3 m from the point cannot occlude, so the loop skips it after one test.
fn ambientOcclusion(p: vec3f, n: vec3f) -> f32 {
  let count = u32(u.info.x);
  var d1 = 9.0;
  var d2 = 9.0;
  var d3 = 9.0;
  var d4 = 9.0;
  let p1 = p + n * 0.08;
  let p2 = p + n * 0.25;
  let p3 = p + n * 0.55;
  let p4 = p + n * 1.0;
  for (var i = 0u; i < count; i++) {
    let mn = boxes[i].mn.xyz;
    let mx = boxes[i].mx.xyz;
    if (sdBox(p, mn, mx) > 1.3) {
      continue;
    }
    d1 = min(d1, sdBox(p1, mn, mx));
    d2 = min(d2, sdBox(p2, mn, mx));
    d3 = min(d3, sdBox(p3, mn, mx));
    d4 = min(d4, sdBox(p4, mn, mx));
  }
  var occ = 0.0;
  occ += max(0.08 - d1, 0.0) * 1.0;
  occ += max(0.25 - d2, 0.0) * 0.7;
  occ += max(0.55 - d3, 0.0) * 0.45;
  occ += max(1.0 - d4, 0.0) * 0.3;
  return clamp(1.0 - 1.1 * occ, 0.0, 1.0);
}

// 1 above ground, 0 deep underground.
fn outdoors(y: f32) -> f32 {
  return smoothstep(u.info2.x - 5.0, u.info2.x, y);
}

// ---- Materials -------------------------------------------------------------

struct Surface { albedo: vec3f, n: vec3f, rough: f32, metal: f32, emit: f32 };

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
  if (an.x > 0.5) { uv = wp.zy; } else if (an.z > 0.5) { uv = wp.xy; }
  switch (mat) {
    case 1u: { // concrete
      let k = 0.82 + 0.2 * fbm(wp * 1.7) + 0.06 * noise3(wp * 14.0);
      s.albedo = col * k;
      s.rough = 0.85;
    }
    case 2u: { // floor tiles, 2 m, with a dark joint
      let cell = floor(wp.xz / 2.0);
      let f = fract(wp.xz / 2.0);
      let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
      let joint = smoothstep(0.0, 0.025, edge);
      let tone = 0.9 + 0.16 * hash3(vec3f(cell, 1.0)) + 0.08 * noise3(wp * 3.0);
      s.albedo = col * tone * mix(0.45, 1.0, joint);
      s.rough = mix(0.9, 0.45, joint * hash3(vec3f(cell, 7.0)));
    }
    case 3u: { // corrugated metal: the normal waves along the face
      if (an.y < 0.5) {
        let a = uv.x * 9.0;
        var t = vec3f(1.0, 0.0, 0.0);
        if (an.x > 0.5) { t = vec3f(0.0, 0.0, 1.0); }
        s.n = normalize(n0 + t * sin(a * 3.14159) * 0.35);
      }
      let grime = fbm(wp * 0.8);
      s.albedo = col * (0.75 + 0.35 * grime);
      s.rough = 0.45;
      s.metal = 0.6;
    }
    case 4u: { // emissive
      s.emit = 7.0;
    }
    case 5u: { // wood: planks
      let plank = fract(uv.y * 4.0);
      let lines = smoothstep(0.0, 0.06, plank) * smoothstep(1.0, 0.94, plank);
      let grain = 0.85 + 0.15 * noise3(vec3f(uv.x * 1.5, uv.y * 30.0, 0.0));
      s.albedo = col * grain * mix(0.55, 1.0, lines);
      s.rough = 0.75;
    }
    case 6u: { // cloth
      s.albedo = col * (0.9 + 0.1 * noise3(wp * 40.0));
      s.rough = 0.95;
    }
    case 7u: { // glazed wall tiles, 150 x 75 mm, with grout
      let t = uv / vec2f(0.15, 0.075);
      let row = floor(t.y);
      let tx = t.x + 0.5 * (row % 2.0);
      let f = vec2f(fract(tx), fract(t.y));
      let grout = smoothstep(0.0, 0.06, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y) * 2.0));
      let id = vec3f(floor(tx), row, 3.0);
      // Some tiles are a shade off, a few are cracked or stained.
      let tone = 0.9 + 0.12 * hash3(id) - 0.25 * step(0.97, hash3(id + 9.0));
      s.albedo = col * tone * mix(0.35, 1.0, grout);
      s.rough = mix(0.8, 0.12, grout);
      // The glaze: each tile bows a little.
      if (an.y < 0.5) {
        var tt = vec3f(1.0, 0.0, 0.0);
        if (an.x > 0.5) { tt = vec3f(0.0, 0.0, 1.0); }
        s.n = normalize(n0 + tt * (f.x - 0.5) * 0.12 + vec3f(0.0, 1.0, 0.0) * (f.y - 0.5) * 0.12);
      }
    }
    case 8u: { // brick, stretcher bond
      let t = uv / vec2f(0.225, 0.075);
      let row = floor(t.y);
      let tx = t.x + 0.5 * (row % 2.0);
      let f = vec2f(fract(tx), fract(t.y));
      let mortar = smoothstep(0.0, 0.05, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y) * 3.0));
      let id = vec3f(floor(tx), row, 5.0);
      let tone = 0.75 + 0.35 * hash3(id) + 0.1 * noise3(wp * 6.0);
      s.albedo = mix(vec3f(0.42, 0.4, 0.36), col * tone, mortar);
      s.rough = 0.9;
    }
    default: { // paint, and the gun
      s.rough = 0.4;
      s.metal = 0.35;
    }
  }
  return s;
}

// The haze in front of a point light: the integral of 1 / d^2 along the
// view ray, from the camera to the surface (or `far`).
fn inScatter(ro: vec3f, rd: vec3f, far: f32) -> vec3f {
  var acc = vec3f(0.0);
  let nl = u32(u.info.y);
  for (var i = 0u; i < nl; i++) {
    let lp = u.lp[i].xyz;
    let tc = dot(lp - ro, rd);
    let h = max(length(ro + rd * tc - lp), 0.25);
    let k = (atan((far - tc) / h) - atan(-tc / h)) / h;
    acc += u.lc[i].rgb * k;
  }
  return acc;
}

// ---- Lighting --------------------------------------------------------------

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
    if (!vm) { e += inScatter(u.cam.xyz, -V, dist) * u.info2.y * mix(0.022, 0.004, out_k); }
    return e;
  }
  var ao = 1.0;
  if (!vm) { ao = ambientOcclusion(in.wpos, n0); }
  var wet = 0.0;

  // Grime: dirt in the corners (where the AO is), streaks down the walls,
  // and wet patches on the floor. More of it underground.
  if (!vm && mat != 4u) {
    let dirt = mix(1.3, 0.45, out_k);
    s.albedo *= mix(1.0, 0.55, (1.0 - ao) * dirt);
    if (abs(n0.y) < 0.5) {
      let streak = fbm(vec3f(in.wpos.x * 3.1 + in.wpos.z * 2.3, in.wpos.y * 0.25, in.wpos.z * 0.7));
      // Water runs down the walls underground; outside it is faint.
      s.albedo *= 1.0 - smoothstep(0.5, 0.8, streak) * mix(0.5, 0.06, out_k);
    }
    if (n0.y > 0.5) {
      let soil = fbm(in.wpos * 0.9);
      s.albedo *= 1.0 - smoothstep(0.45, 0.75, soil) * 0.3 * dirt;
      wet = smoothstep(0.5, 0.6, fbm(in.wpos * vec3f(0.35, 1.0, 0.35) + 3.0)) * (1.0 - out_k);
      s.albedo *= 1.0 - wet * 0.45;
      s.rough = mix(s.rough, 0.04, wet);
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
  var shadow = out_k;
  if (u.info.w > 0.5 && out_k > 0.0) { shadow *= sunShadow(in.wpos, n0); }

  let shin = mix(512.0, 8.0, s.rough);
  let f0 = mix(vec3f(0.04), s.albedo, s.metal);
  let fres = f0 + (vec3f(1.0) - f0) * pow(1.0 - ndv, 5.0);
  let spec = pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / 25.0;
  let diff = s.albedo * (1.0 - s.metal * 0.7);

  var c = u.sun_col.rgb * ndl * shadow * (diff + fres * spec);

  // Hemisphere ambient: sky above, warm ground bounce below. Underground
  // only a trace of it is left.
  let sky_amb = vec3f(0.22, 0.30, 0.48);
  let gnd_amb = vec3f(0.30, 0.20, 0.14);
  let hemi = mix(gnd_amb, sky_amb, N.y * 0.5 + 0.5) * mix(0.05, 1.0, out_k);
  c += diff * hemi * ao;
  // Sky reflection.
  let R = reflect(-V, N);
  var refl = 0.6;
  if (vm) { refl = 0.1; } // The sky behind the camera is not the one in front.
  c += skyColor(R, false) * fres * (1.0 - s.rough) * ao * refl * out_k;

  // Point lights.
  let nl = u32(u.info.y);
  for (var i = 0u; i < nl; i++) {
    let d = u.lp[i].xyz - in.wpos;
    let ld = length(d);
    let r = u.lp[i].w;
    if (ld < r) {
      let l = d / ld;
      let k = 1.0 - (ld * ld) / (r * r);
      let att = k * k / (1.0 + ld * ld * 0.35);
      let h2 = normalize(l + V);
      let sp = pow(max(dot(N, h2), 0.0), shin) * (shin + 8.0) / 25.0;
      c += u.lc[i].rgb * att * max(dot(N, l), 0.0) * (diff + fres * sp) * mix(1.0, ao, 0.5);
    }
    // A wet floor mirrors the lights: a long glint toward each one.
    if (wet > 0.01 && ld < 30.0) {
      let l = d / ld;
      let g = pow(max(dot(R, l), 0.0), 180.0) * 2.5 + pow(max(dot(R, l), 0.0), 24.0) * 0.12;
      c += u.lc[i].rgb * g * wet / (1.0 + ld * ld * 0.015);
    }
  }
  if (vm) {
    // A soft rim keeps the gun readable against a dark wall.
    c += vec3f(0.5, 0.42, 0.36) * pow(1.0 - ndv, 3.0) * 0.25 * mix(0.3, 1.0, out_k);
  }

  if (!vm) {
    // Fog: thin warm haze outside, a thicker dark haze underground.
    let dens_out = u.info.z * exp(-max(in.wpos.y, 0.0) * 0.12);
    let dens = mix(0.012, dens_out, out_k);
    let f = 1.0 - exp(-dist * dens);
    let vd = -V;
    let fc_out = skyColor(normalize(vec3f(vd.x, max(vd.y, 0.02), vd.z)), false);
    let fc = mix(vec3f(0.012, 0.011, 0.01), fc_out, out_k);
    c = mix(c, fc, f);
    c += inScatter(u.cam.xyz, vd, dist) * u.info2.y * mix(0.022, 0.004, out_k);
  }
  return c;
}

@fragment fn fs_main(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  return vec4f(shade(in, front), 1.0);
}

// ---- Sky pass --------------------------------------------------------------

struct SkyOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };

@vertex fn vs_sky(@builtin(vertex_index) i: u32) -> SkyOut {
  var o: SkyOut;
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  o.pos = vec4f(p, 1.0, 1.0);
  o.ndc = p;
  return o;
}

@fragment fn fs_sky(in: SkyOut) -> @location(0) vec4f {
  let a = u.inv_vp * vec4f(in.ndc, 0.0, 1.0);
  let b = u.inv_vp * vec4f(in.ndc, 1.0, 1.0);
  let d = normalize(b.xyz / b.w - a.xyz / a.w);
  return vec4f(skyColor(d, true), 1.0);
}
