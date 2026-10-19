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
uniform float u_collapse;    // 0: the face; 1: every dot pulled into the core
uniform float u_coreSize;    // the core's radius, in world units
uniform vec2 u_coreAt;       // how far the core has wandered off its middle
uniform vec2 u_throwAt;      // where the throw has carried the shape, in world units
uniform float u_throwScale;  // the shape's size in flight, against its size at the start
uniform float u_throwAlpha;  // how strongly the shape shows in flight
uniform sampler2D u_contentMask;  // white where the page has content

// How strongly the passing ripples tint this particle
varying vec3 v_light;
// How strongly this dot shows. The shape can fade in flight.
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

        // The throw carries the whole shape along its path and shrinks it,
        // as if it flew away from the viewer.
        position.xy = u_throwAt + position.xy * u_throwScale;

        // Calculate the model view position
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // A roused particle swells, where the cloud lets the ripple show
        vec3 light;
        float roused = rippleAt(position.xy, light).z;
        relativeSize *= 1.0 + u_swell * min(roused, 1.5) * light.z;
        v_light = light;

        // Vertex shader output
        // Every dot shrinks and fades with the shape as it flies off.
        gl_PointSize = -u_particleSize * relativeSize / mvPosition.z * u_throwScale;
        gl_Position = projectionMatrix * mvPosition;

        // A dot fades out where the page has content.
        vec2 screen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
        v_alpha = u_throwAlpha * (1.0 - texture2D(u_contentMask, screen).r);
    } else {
        // Vertex shader output
        v_light = vec3(0.0, 0.0, 1.0);
        v_alpha = 0.0;
        gl_PointSize = 0.0;
        gl_Position = vec4(-1000000.0);
    }
}
