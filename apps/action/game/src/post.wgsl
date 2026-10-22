// Post passes: bloom (bright pass, then a separable blur at quarter size)
// and the final pass (bloom mix, ACES tone map, vignette, damage tint,
// gamma, dither).

struct Post {
  texel: vec2f,   // 1 / source size
  dir: vec2f,     // blur direction in texels
  exposure: f32,
  damage: f32,
  time: f32,
  bloom: f32,
};

@group(0) @binding(0) var<uniform> p: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var bloom_tex: texture_2d<f32>;

struct FsIn { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs_full(@builtin(vertex_index) i: u32) -> FsIn {
  var o: FsIn;
  let q = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  o.pos = vec4f(q * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(q.x, 1.0 - q.y);
  return o;
}

@fragment fn fs_bright(in: FsIn) -> @location(0) vec4f {
  let t = p.texel;
  var c = textureSample(src, smp, in.uv + vec2f(-t.x, -t.y)).rgb;
  c += textureSample(src, smp, in.uv + vec2f(t.x, -t.y)).rgb;
  c += textureSample(src, smp, in.uv + vec2f(-t.x, t.y)).rgb;
  c += textureSample(src, smp, in.uv + vec2f(t.x, t.y)).rgb;
  c *= 0.25;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let k = max(l - 1.1, 0.0) / max(l, 1e-4);
  return vec4f(min(c * k, vec3f(40.0)), 1.0);
}

@fragment fn fs_blur(in: FsIn) -> @location(0) vec4f {
  // A 9-tap Gaussian with 5 bilinear samples.
  let d = p.dir * p.texel;
  var c = textureSample(src, smp, in.uv).rgb * 0.227;
  c += textureSample(src, smp, in.uv + d * 1.385).rgb * 0.316;
  c += textureSample(src, smp, in.uv - d * 1.385).rgb * 0.316;
  c += textureSample(src, smp, in.uv + d * 3.231).rgb * 0.070;
  c += textureSample(src, smp, in.uv - d * 3.231).rgb * 0.070;
  return vec4f(c, 1.0);
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs_final(in: FsIn) -> @location(0) vec4f {
  var c = textureSample(src, smp, in.uv).rgb;
  let b = textureSample(bloom_tex, smp, in.uv).rgb;
  c += b * p.bloom;
  c *= p.exposure;
  // A warm lift in the shadows, a cool roll-off in the highlights.
  c = aces(c * vec3f(1.02, 1.0, 0.97));
  let v = in.uv - 0.5;
  let vig = 1.0 - dot(v, v) * 0.9;
  c *= vig;
  // Damage: a red edge that fades.
  let edge = smoothstep(0.15, 0.75, length(v) * 1.4);
  c = mix(c, vec3f(0.55, 0.02, 0.02), edge * p.damage);
  c = pow(c, vec3f(1.0 / 2.2));
  // Dither against banding in the sky.
  let n = fract(sin(dot(in.pos.xy + p.time, vec2f(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  return vec4f(c, 1.0);
}
