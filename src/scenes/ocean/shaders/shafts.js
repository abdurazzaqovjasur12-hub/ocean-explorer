import { noiseChunk } from './chunks';

// Light shafts: soft beams that hang from the surface along the (refracted) direction of the sun.
// Each beam is a camera-facing strip, additive, brightness shimmering as the surface moves above it.

export const shaftVertex = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aParams; // width, length, intensity, seed
uniform vec3 uDown;     // direction the light travels (unit, pointing down)
uniform float uTime;
uniform vec3 uLightColor;
varying vec2 vUv;
varying vec4 vParams;
varying vec3 vWorld;

void main() {
  float u = position.x;
  float v = position.y;
  float seed = aParams.w;

  // the foot of each beam wanders a little, following the surface above
  vec3 base = aBase;
  base.xz += vec2(sin(uTime * 0.11 + seed * 6.0), cos(uTime * 0.09 + seed * 5.0)) * 0.6;

  vec3 p = base + uDown * (v * aParams.y);
  vec3 side = cross(uDown, cameraPosition - p);
  float len = length(side);
  side = len > 1e-4 ? side / len : vec3(1.0, 0.0, 0.0);
  p += side * (u * aParams.x * (0.7 + 0.5 * v)); // beams spread a little as they go deeper

  vUv = vec2(u, v);
  vParams = aParams;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const shaftFragment = /* glsl */ `
varying vec2 vUv;
varying vec4 vParams;
varying vec3 vWorld;
uniform float uTime;
uniform vec3 uLightColor;
uniform vec3 uDown;
uniform float uStrength;

${noiseChunk}

void main() {
  float x = abs(vUv.x);
  float v = vUv.y;

  float edge = 1.0 - smoothstep(0.3, 1.0, x);                          // exactly zero at the border: no visible edges
  float core = (exp(-x * x * 3.2) + 0.25 * exp(-x * x * 1.0)) * edge;  // soft core with a faint halo
  float fadeIn = smoothstep(0.0, 0.12, v);                             // starts gently at the surface
  float fadeOut = 1.0 - smoothstep(0.35, 1.0, v);                      // and dies away slowly with depth

  // colours are absorbed with depth (same rule as zones.js: 20 m per unit, surface layer of 1 unit)
  float meters = max(0.0, (-vWorld.y - 1.0) / 0.05);
  vec3 absorb = vec3(exp(-meters / 28.0), exp(-meters / 150.0), exp(-meters / 650.0));

  float seed = vParams.w;
  float n = vnoise(vec2(v * 5.0 - uTime * 0.25 + seed * 17.0, seed * 31.0 + uTime * 0.07));
  float shimmer = 0.45 + 1.1 * smoothstep(0.2, 0.9, n); // bright and dim patches sliding down the beam
  float breathe = 0.75 + 0.25 * sin(uTime * 0.37 + seed * 6.2831);

  vec3 toPoint = normalize(vWorld - cameraPosition);
  float towardLight = pow(clamp01(dot(toPoint, -uDown)), 3.0); // brighter when you look up the beam
  float near = smoothstep(2.5, 11.0, distance(vWorld, cameraPosition)); // never a hard wall in front of the lens

  // small on purpose: additive light lands after tone mapping, so a little goes a long way
  float I = core * fadeIn * fadeOut * shimmer * breathe * vParams.z * (0.7 + 0.6 * towardLight) * near * uStrength * 0.12;
  gl_FragColor = vec4(uLightColor * absorb * I, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
