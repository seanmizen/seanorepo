// Click ripples, shared by the velocity sim and the particle vertex shader.
// Everything is in world units on the z = 0 plane the particles live on.
//
// A click is a blow: a front runs out fast and slows, with a trough and a
// weaker crest behind it. Each ripple pushes outward from its own origin and
// the pushes are summed as vectors, so two fronts that meet cancel or add up
// instead of passing through each other.

#define MAX_TAPS 8

uniform float u_now;
uniform int u_tapCount;
// Each: origin (xy), start time in seconds (z), strength (w).
uniform vec4 u_taps[MAX_TAPS];

const float RIPPLE_REACH = 16.0;    // how far a front gets before it stalls
const float RIPPLE_SLOW = 1.3;      // seconds for the front to lose most of its speed
const float RIPPLE_FADE = 1.5;      // seconds for the push to die away
const float RIPPLE_WAVE = 3.0;      // distance between crest and crest behind the front
const float RIPPLE_WOBBLE = 0.35;   // how far the outline strays from a circle

// Returns the push (xy) and how roused the place is (z). Out: the ripple's
// tint, from 0 (none) up.
vec3 rippleAt(vec2 p, out float glow) {
  vec3 sum = vec3(0.0);
  glow = 0.0;

  for (int i = 0; i < MAX_TAPS; i++) {
    if (i >= u_tapCount) break;

    vec4 tap = u_taps[i];
    float age = u_now - tap.z;
    if (age < 0.0) continue;

    vec2 away = p - tap.xy;
    float d = length(away);
    vec2 dir = away / max(d, 0.001);

    // A few lobes, turning slowly and different per click, so the ring is
    // never a drawn circle.
    float lobes = sin(5.0 * atan(away.y, away.x) + 7.0 * tap.z + 0.8 * age);
    float reach = d + RIPPLE_WOBBLE * lobes * min(d, 1.0);

    float behind = RIPPLE_REACH * (1.0 - exp(-age / RIPPLE_SLOW)) - reach;
    float width = 1.6 + 1.0 * age;
    float front = smoothstep(-0.4, 0.25, behind) * exp(-behind * behind / (width * width));
    float swell = tap.w * exp(-age / RIPPLE_FADE) * front;

    // Outward on the crest, a little back in the trough.
    float wave = 0.4 + 0.6 * cos(behind * (6.2831853 / RIPPLE_WAVE));
    sum.xy += dir * swell * wave;
    sum.z += swell;

    // The front glows and leaves a short afterlight inside the ring. Guard
    // the trail ahead of the front, where exp() of a negative would overflow.
    float trail = smoothstep(0.0, 1.2, behind) * exp(-max(behind, 0.0) / 5.0);
    glow += tap.w * (exp(-age / 1.0) * front + 0.7 * exp(-age / RIPPLE_SLOW) * trail);
  }

  return sum;
}
