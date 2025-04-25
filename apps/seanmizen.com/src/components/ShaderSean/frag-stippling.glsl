#define GLSLIFY 1
// Texture with the particle profile
uniform sampler2D u_texture;
uniform float     u_invert;   // 0.0 = normal, 1.0 = fully inverted

/*
 * The main program
 */
void main() {
    // Fragment shader output
    // gl_FragColor = vec4(vec3(0.0), texture2D(u_texture, gl_PointCoord).a);
    // color = vec4(vec3(0.0), texture2D(u_texture, gl_PointCoord).a);
    // gl_FragColor = mix(color, 1.0 - color, 1);
    float a = texture2D(u_texture, gl_PointCoord).a;

    // pick black or white via mix
    vec3  rgb = mix(vec3(0.0), vec3(1.0), u_invert);

    gl_FragColor = vec4(rgb, a);
}
