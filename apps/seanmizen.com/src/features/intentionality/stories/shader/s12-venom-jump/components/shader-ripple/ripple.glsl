// Click ripples, shared by the velocity sim, the offset sim and the particle
// vertex shader. Everything is in world units on the z = 0 plane the
// particles live on.
//
// A click is a blow: a front runs out fast and slows, with a trough and a
// weaker crest behind it. Each ripple pushes outward from its own origin and
// the pushes are summed as vectors, so two fronts that meet cancel or add up
// instead of passing through each other. A tap with negative strength runs
// out as a heart instead of a circle.

#define MAX_TAPS 16

uniform float u_now;
uniform int u_tapCount;
// Each: origin (xy), start time in seconds (z), strength (w; below 0 is a heart).
uniform vec4 u_taps[MAX_TAPS];
// Ripples that started before this time are skipped. The face's passes
// set it when the face comes home, so older ripples leave the face alone.
uniform float u_tapsFrom;

uniform float u_reach;       // how far a front gets before it stalls
uniform float u_slow;        // seconds for the front to lose most of its speed
uniform float u_fade;        // seconds for the push to die away
uniform float u_frontWidth;  // the front's thickness at the start
uniform float u_widthGrow;   // how much thicker it gets each second
uniform float u_wave;        // distance from crest to crest behind the front
uniform float u_crest;       // 0: push only outward; 1: the trough pulls back as hard
uniform float u_wobble;      // how far the regular lobes push the outline out
uniform float u_lobes;       // how many regular lobes the outline has
uniform float u_warp;        // how far noise bends the outline off a circle
uniform float u_warpScale;   // the size of a bend
uniform float u_warpSpeed;   // how fast the bends drift
uniform float u_banding;     // 0: the front lights evenly; 1: in crest and trough rings
uniform float u_nebula;      // 0: the front shows everywhere; 1: only where it clears the cloud
uniform float u_cloudLevel;  // the level the cloud plus the ripple must clear to show
uniform float u_cloudSoft;   // how soft the edge of a lit patch is
uniform float u_cloudGain;   // how much the ripple adds to the cloud
uniform float u_nebulaScale; // the size of a cloud
uniform float u_nebulaSpeed; // how fast the clouds drift
uniform float u_glowFade;    // seconds for the front's tint to die away
uniform float u_trail;       // how strong the afterlight inside the ring is
uniform float u_trailLen;    // how far behind the front the afterlight reaches

// A second look further out. Between u_lookNear and u_lookFar from the
// middle, these take over from u_warp, u_wobble, u_banding and u_nebula, so
// one front can leave the portrait in one look and run on in another.
// With u_lookNear beyond the view, only the first look shows.
uniform float u_lookNear;
uniform float u_lookFar;
uniform float u_outerWarp;
uniform float u_outerWobble;
uniform float u_outerBanding;
uniform float u_outerNebula;

// Hash and value noise in plain floats, so they run on WebGL1 as well.
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Smooth value noise, from -1 to 1.
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float n = mix(
    mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y),
    mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y),
    w.z
  );
  return n * 2.0 - 1.0;
}

// Three octaves of noise: big soft clouds with smaller wisps on them.
float cloud(vec3 p) {
  return 0.57 * noise3(p) + 0.29 * noise3(p * 2.03 + 17.0) + 0.14 * noise3(p * 4.01 + 41.0);
}

// How far the heart's outline lies along a direction (a unit vector, y up),
// against a circle's 1. The heart is the zero set of
// (x^2 + y^2 - 1)^3 - x^2 y^3, inside where it is negative; walk out from
// the middle and close in on the edge by halving.
float heartReach(vec2 dir) {
  float lo = 0.0, hi = 1.6;
  for (int i = 0; i < 10; i++) {
    float r = 0.5 * (lo + hi);
    vec2 q = dir * r + vec2(0.0, 0.25); // sit the heart's middle on the click
    float a = dot(q, q) - 1.0;
    float inside = a * a * a - q.x * q.x * q.y * q.y * q.y;
    if (inside < 0.0) lo = r; else hi = r;
  }
  return max(0.5 * (lo + hi), 0.05);
}

// Returns the push (xy) and how roused the place is (z). Out, in `light`:
// the ripple's tint (x, from 0 up), its afterlight (y, from 0 up), and how
// much of it the cloud lets show here (z, 0 to 1).
vec3 rippleAt(vec2 p, out vec3 light) {
  vec3 sum = vec3(0.0);
  light = vec3(0.0, 0.0, 1.0);
  if (u_tapCount == 0) return sum;

  // How far into the outer look this place is, and that look's values.
  float outer = smoothstep(u_lookNear, u_lookFar, length(p));
  float warpBy = mix(u_warp, u_outerWarp, outer);
  float wobbleBy = mix(u_wobble, u_outerWobble, outer);
  float bandingBy = mix(u_banding, u_outerBanding, outer);
  float nebulaBy = mix(u_nebula, u_outerNebula, outer);

  // Read every front a little off true, through smooth drifting noise, so
  // its outline bends irregularly instead of being a drawn circle.
  float drift = u_now * u_warpSpeed;
  vec2 near = p + warpBy * vec2(
    noise3(vec3(p / u_warpScale, drift)),
    noise3(vec3(p / u_warpScale + 9.1, drift + 4.0))
  );

  for (int i = 0; i < MAX_TAPS; i++) {
    if (i >= u_tapCount) break;

    vec4 tap = u_taps[i];
    float age = u_now - tap.z;
    if (age < 0.0 || tap.z < u_tapsFrom) continue;

    vec2 away = near - tap.xy;
    float d = length(away);
    vec2 dir = away / max(d, 0.001);
    float reach = tap.w < 0.0 ? d / heartReach(dir) : d;
    float strength = abs(tap.w);

    // Regular lobes, turning slowly and different per click: the starfish.
    float lobes = sin(u_lobes * atan(away.y, away.x) + 7.0 * tap.z + 0.8 * age);
    reach += wobbleBy * lobes * min(d, 1.0);

    float behind = u_reach * (1.0 - exp(-age / u_slow)) - reach;
    float width = u_frontWidth + u_widthGrow * age;
    float front = smoothstep(-0.4, 0.25, behind) * exp(-behind * behind / (width * width));
    float swell = strength * exp(-age / u_fade) * front;

    // Crest and trough: outward on the crest, back in the trough as far as
    // u_crest allows. The same bands light the air, as far as u_banding
    // allows, which draws rings inside the ring.
    float ring = cos(behind * (6.2831853 / u_wave));
    sum.xy += dir * swell * ((1.0 - u_crest) + u_crest * ring);
    sum.z += swell * ((1.0 - bandingBy) + bandingBy * (0.25 + 0.75 * ring));

    // The front glows and leaves an afterlight inside the ring. Guard the
    // trail ahead of the front, where exp() of a negative would overflow.
    float trail = smoothstep(0.0, 1.2, behind) * exp(-max(behind, 0.0) / u_trailLen);
    light.x += strength * (exp(-age / u_glowFade) * front + u_trail * exp(-age / u_slow) * trail);
    // A softer haze that gathers just after the front passes and lingers.
    light.y += strength * (1.0 - exp(-age / 0.2)) * exp(-age / 1.2) * trail;
  }

  // What shows is a threshold, not a dimmer: a drifting cloud plus the
  // ripple's banded strength must clear a level. Where the cloud is thick a
  // little ripple shows; where it is thin only the crests break through. So
  // a front lights in clumps that grow and join as it passes.
  float c = cloud(vec3(p / u_nebulaScale, u_now * u_nebulaSpeed));
  float field = c + u_cloudGain * sum.z;
  float shows = smoothstep(u_cloudLevel - u_cloudSoft, u_cloudLevel + u_cloudSoft, field);
  light.z = mix(1.0, shows, nebulaBy);

  return sum;
}
