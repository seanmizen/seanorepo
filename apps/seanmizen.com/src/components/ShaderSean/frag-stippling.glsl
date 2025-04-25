#define GLSLIFY 1
// Texture with the particle profile
uniform sampler2D u_texture;

/* replace the float with a tint colour */
uniform vec3      u_color;   // e.g. (0,0,0) black • (1,1,1) white • any RGB

void main() {
    float a = texture2D(u_texture, gl_PointCoord).a;
    gl_FragColor = vec4(u_color, a);   // keep sprite alpha, tint RGB
}
