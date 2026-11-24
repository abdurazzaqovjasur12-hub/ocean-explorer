// Bubbles as glassy rings: a bright thin rim, a faint body and a small highlight, tinted by the light
// that is left at this depth. Additive, one draw call for hundreds of bubbles.

export const bubbleVertex = /* glsl */ `
attribute float aSize;  // world size
attribute float aAlpha; // 0..1 (fade in and out)
uniform float uScale;   // drawing-buffer height / 2, converts world size to pixels like PointsMaterial
varying float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 96.0);
  vAlpha = aAlpha;
}
`;

export const bubbleFragment = /* glsl */ `
uniform vec3 uTint; // light colour at this depth
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float body = 0.06 * (1.0 - r);
  vec2 h = p - vec2(-0.38, 0.38);
  float highlight = exp(-dot(h, h) * 22.0);
  vec2 b = p - vec2(0.3, -0.34);
  float bounce = exp(-dot(b, b) * 14.0) * 0.25;
  float a = (rim * 0.75 + body + highlight + bounce) * vAlpha;
  gl_FragColor = vec4(uTint * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
