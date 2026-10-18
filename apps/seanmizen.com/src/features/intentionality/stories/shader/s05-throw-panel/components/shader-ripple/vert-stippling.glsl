#define GLSLIFY 1
// Particle index attribute
attribute float a_index;

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
uniform float u_collapse;  // 0: the face; 1: every dot pulled into the core
uniform float u_coreSize;  // the core's radius, in world units
uniform vec2 u_coreAt;     // the core's middle, in world units
uniform float u_coreScale; // the core's size in flight, against its size at the start
uniform float u_coreAlpha; // how strongly the core shows

// How strongly the passing ripples tint this particle
varying vec3 v_light;
// How strongly this dot shows. The core can fade in flight.
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

        // Calculate the model view position
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // A roused particle swells, where the cloud lets the ripple show
        vec3 light;
        float roused = rippleAt(position.xy, light).z;
        relativeSize *= 1.0 + u_swell * min(roused, 1.5) * light.z;
        v_light = light;

        // Vertex shader output
        // A dot in the core shrinks and fades with the core as it flies off.
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z * mix(1.0, u_coreScale, u_collapse);
        gl_Position = projectionMatrix * mvPosition;
        v_alpha = mix(1.0, u_coreAlpha, u_collapse);
    } else {
        // Vertex shader output
        v_light = vec3(0.0, 0.0, 1.0);
        v_alpha = 0.0;
        gl_PointSize = 0.0;
        gl_Position = vec4(-1000000.0);
    }
}
