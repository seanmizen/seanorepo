#define GLSLIFY 1
// Particle index attribute
attribute float a_index;
// Four random numbers from 0 to 1, independent of each other, fixed per
// particle. The index hashes are fine one at a time, but they are all
// made from the same number, so two of them together fall into clumps.
attribute vec4 a_random;

// Simulation uniforms
uniform float u_width;
uniform float u_height;
uniform float u_particleSize;
uniform float u_nActiveParticles;
uniform sampler2D u_positionTexture;
uniform sampler2D u_offsetTexture; // ripple displacement from home (xy)
uniform sampler2D u_bgTexture;
uniform vec2 u_textureOffset;

uniform float u_swell;  // how much a roused particle grows
uniform float u_collapse;    // 0: the face; 1: every dot pulled into the core
uniform float u_coreSize;    // the core's radius, in world units
uniform vec2 u_coreAt;       // how far the core has wandered off its middle
uniform vec2 u_throwAt;      // where the throw has carried the shape, in world units
uniform sampler2D u_contentMask;  // white where the page has content

// Venom: tendrils from the core that reach for the cursor.
uniform vec2 u_cursor;         // the cursor, in world units
uniform float u_grab;          // 0: no tendrils; 1: their tips touch the cursor
uniform float u_tendrils;      // how many tendrils
uniform float u_tendrilShare;  // the share of the core's dots that make them
uniform float u_spread;        // how far they fan out, against their length
uniform float u_strand;        // a tendril's width at its root, in world units
uniform float u_wiggle;        // how far a tendril writhes, in world units

// How strongly the passing ripples tint this particle
varying vec3 v_light;
// How strongly this dot shows: not at all over the page's content.
varying float v_alpha;

/*
 * Returns the texture background color at the given position
 */
vec3 get_background_color(vec3 position) {
    return texture2D(u_bgTexture, (position.xy + u_textureOffset) / (2.0 * u_textureOffset)).rgb;
}

/*
 * The main program
 */
void main() {
    // Check if the particle is one of the active particles
    if (a_index < u_nActiveParticles) {
        // Get the particle position
        vec2 uv = vec2((mod(a_index, u_width) + 0.5) / u_width, (floor(a_index / u_width) + 0.5) / u_height);
        vec3 position = texture2D(u_positionTexture, uv).xyz;
        position.xy += texture2D(u_offsetTexture, uv).xy;

        // Calculate the particle relative size based on the background texture color
        vec3 bgColor = get_background_color(position);
        float relativeSize = 1.0 - 0.3 * dot(bgColor, vec3(1.0));

        // The collapse pulls every dot to its own place in the core. That
        // place comes from the dot's index, not from the face, so no trace
        // of the face is left in the core. The size above is read first,
        // where the dot sits in the face.
        float angle = 6.2831853 * hash31(vec3(a_index, 1.0, 7.0));
        float reach = u_coreSize * sqrt(hash31(vec3(a_index, 2.0, 7.0)));
        vec2 core = u_coreAt + reach * vec2(cos(angle), sin(angle));
        position.xy = mix(position.xy, core, u_collapse);

        // The throw carries the whole shape along its path.
        position.xy += u_throwAt;

        // Venom: a share of the core's dots leave it and reach for the
        // cursor, as a few curved tendrils that fan out and meet at the tip.
        // Each dot keeps its own tendril, its place along it (f, 0 at the
        // core) and its place across it.
        if (u_grab > 0.001 && a_random.x < u_tendrilShare) {
            float k = floor(a_random.y * u_tendrils);
            float f = a_random.z;
            vec2 root = u_throwAt + u_coreAt;
            vec2 tip = mix(root, u_cursor, u_grab);
            vec2 along = tip - root;
            vec2 side = vec2(-along.y, along.x);
            vec2 unitSide = side / max(length(side), 0.0001);
            float fan = u_tendrils > 1.0 ? 2.0 * k / (u_tendrils - 1.0) - 1.0 : 0.0;
            vec2 bend = root + 0.5 * along + fan * u_spread * side;
            vec2 onCurve = mix(mix(root, bend, f), mix(bend, tip, f), f);
            // Thick at the root and thin at the tip. A wave runs out along
            // the tendril, held still at both ends.
            float across = u_strand * (1.0 - f) * (a_random.w - 0.5);
            float writhe = u_wiggle * 4.0 * f * (1.0 - f) * sin(9.0 * f - 7.0 * u_now + 2.1 * k);
            onCurve += unitSide * (across + writhe);
            position.xy = mix(position.xy, onCurve, u_collapse);
            // The face sizes a dot by how dark its place in the photo is,
            // which leaves most dots too small to see once spread out. In a
            // tendril every dot takes one size.
            relativeSize = mix(relativeSize, 0.8, u_collapse);
        }

        // Calculate the model view position
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // A roused particle swells, where the cloud lets the ripple show
        vec3 light;
        float roused = rippleAt(position.xy, light).z;
        relativeSize *= 1.0 + u_swell * min(roused, 1.5) * light.z;
        v_light = light;

        // Vertex shader output
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;

        // A dot fades out where the page has content.
        vec2 screen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
        v_alpha = 1.0 - texture2D(u_contentMask, screen).r;
    } else {
        // Vertex shader output
        v_light = vec3(0.0, 0.0, 1.0);
        v_alpha = 0.0;
        gl_PointSize = 0.0;
        gl_Position = vec4(-1000000.0);
    }
}
