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

// Venom: tendrils from the core that reach for the cursor. JavaScript moves
// each tendril's tip and bend on springs. Here they are only drawn.
uniform vec4 u_tendril[8];     // a tendril's tip (xy) and bend (zw), from the core's middle, in world units
uniform float u_grab;          // the longest tendril, in world units; 0: none out
uniform float u_tendrils;      // how many tendrils
uniform float u_tendrilShare;  // the share of the core's dots that make them
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
        // cursor, as a few curved tendrils. Each dot keeps its own tendril,
        // its place along it (f, 0 at the core) and its place across it.
        if (u_grab > 0.001 && a_random.x < u_tendrilShare) {
            float k = min(floor(a_random.y * u_tendrils), 7.0);
            vec4 tendril = u_tendril[int(k)];
            float f = a_random.z;
            vec2 root = u_throwAt + u_coreAt;
            vec2 bend = root + tendril.zw;
            vec2 tip = root + tendril.xy;
            vec2 onCurve = mix(mix(root, bend, f), mix(bend, tip, f), f);
            vec2 along = mix(bend - root, tip - bend, f);
            vec2 unitSide = vec2(-along.y, along.x) / max(length(along), 0.0001);
            // Thick at the root and thin at the tip. Noise writhes it, held
            // still at both ends. The noise runs out along the tendril and
            // changes its shape as it goes, so no two writhes are the same.
            float across = u_strand * (1.0 - f) * (a_random.w - 0.5);
            float wave = noise3(vec3(3.0 * f - 2.3 * u_now, 5.7 * k, 0.9 * u_now));
            float writhe = u_wiggle * 6.0 * f * (1.0 - f) * wave;
            onCurve += unitSide * (across + writhe);
            // A tendril that has pulled back takes its dots into the core.
            float extended = smoothstep(0.0, 2.0 * u_coreSize, length(tendril.xy));
            position.xy = mix(position.xy, onCurve, extended * u_collapse);
            // The face sizes a dot by how dark its place in the photo is,
            // which leaves most dots too small to see once spread out. In a
            // tendril every dot takes one size.
            relativeSize = mix(relativeSize, 0.8, extended * u_collapse);
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
