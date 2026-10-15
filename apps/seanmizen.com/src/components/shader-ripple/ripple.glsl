// Click ripples, shared by the velocity sim and the particle vertex shader.
// Everything is in world units on the z = 0 plane the particles live on.
//
// A click is a blow: a front runs out fast and slows, with a trough and a
// weaker crest behind it. Each ripple pushes outward from its own origin and
// the pushes are summed as vectors, so two fronts that meet cancel or add up
// instead of passing through each other.

#define MAX_TAPS 16

uniform float u_now;
uniform int u_tapCount;
// Each: origin (xy), start time in seconds (z), strength (w).
uniform vec4 u_taps[MAX_TAPS];

uniform float u_reach;      // how far a front gets before it stalls
uniform float u_slow;       // seconds for the front to lose most of its speed
uniform float u_fade;       // seconds for the push to die away
uniform float u_frontWidth; // the front's thickness at the start
uniform float u_widthGrow;  // how much thicker it gets each second
uniform float u_wave;       // distance from crest to crest behind the front
uniform float u_crest;      // 0: push only outward; 1: the trough pulls back as hard
uniform float u_wobble;     // how far the outline strays from a circle
uniform float u_lobes;      // how many bulges the outline has
uniform float u_glowFade;   // seconds for the front's tint to die away
uniform float u_trail;      // how strong the afterlight inside the ring is
uniform float u_trailLen;   // how far behind the front the afterlight reaches

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
    float lobes = sin(u_lobes * atan(away.y, away.x) + 7.0 * tap.z + 0.8 * age);
    float reach = d + u_wobble * lobes * min(d, 1.0);

    float behind = u_reach * (1.0 - exp(-age / u_slow)) - reach;
    float width = u_frontWidth + u_widthGrow * age;
    float front = smoothstep(-0.4, 0.25, behind) * exp(-behind * behind / (width * width));
    float swell = tap.w * exp(-age / u_fade) * front;

    // Outward on the crest, back in the trough as far as u_crest allows.
    float wave = (1.0 - u_crest) + u_crest * cos(behind * (6.2831853 / u_wave));
    sum.xy += dir * swell * wave;
    sum.z += swell;

    // The front glows and leaves an afterlight inside the ring. Guard the
    // trail ahead of the front, where exp() of a negative would overflow.
    float trail = smoothstep(0.0, 1.2, behind) * exp(-max(behind, 0.0) / u_trailLen);
    glow += tap.w * (exp(-age / u_glowFade) * front + u_trail * exp(-age / u_slow) * trail);
  }

  return sum;
}
