import * as THREE from 'three';

/*
 * Two small point layers, additive, on the bloom layer:
 *   wake   plankton lit up by the shark pushing through it: sparks along its flanks and swirling behind it.
 *          In the dark this traces its outline before the body itself can be seen. Moves with the shark.
 *   burst  the water stirred at the camera when it rushes past: a short, soft flash of sparks and silt thrown
 *          outward (about 1.5 s). In world space; drawn only while it lasts.
 */
const wakeVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float uFlow;
uniform float uTime;
uniform float uScale;
uniform float uGlow;
varying float vAlpha;
varying float vPlankton;
void main() {
  float life = fract(uFlow * (0.7 + 0.6 * aSeed.w) + aSeed.x);
  float x = mix(8.0, -22.0, life);
  float r = (1.6 + 3.0 * life * life) * (0.7 + 0.6 * aSeed.y);
  float a = aSeed.z * 6.2832 + life * 2.2;
  vec3 p = vec3(x, sin(a) * r * 0.9, cos(a) * r);
  p += 0.3 * vec3(sin(uTime * 0.7 + aSeed.y * 20.0), cos(uTime * 0.5 + aSeed.z * 17.0), sin(uTime * 0.6 + aSeed.w * 13.0));
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(-mvPosition.z, 0.1);
  vPlankton = step(0.25, aSeed.w);
  float flicker = 0.55 + 0.45 * sin(uTime * 3.4 + aSeed.w * 40.0);
  vAlpha = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.3, 1.0, life)) * uGlow * mix(0.3, flicker, vPlankton);
  gl_PointSize = clamp((0.06 + 0.08 * aSeed.y) * uScale / dist, 1.0, 10.0);
  #include <fog_vertex>
}`;

const burstVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float uAge;
uniform float uScale;
uniform vec3 uOrigin;
uniform vec3 uPush;
varying float vAlpha;
varying float vPlankton;
void main() {
  // A direction on a sphere, flattened a little and pushed the way the water was shoved.
  float th = aSeed.x * 6.2832;
  float cz = aSeed.y * 2.0 - 1.0;
  vec3 dir = vec3(sqrt(1.0 - cz * cz) * cos(th), cz * 0.7, sqrt(1.0 - cz * cz) * sin(th));
  float reach = (1.0 - exp(-uAge * 2.6)) * (1.0 + 2.2 * aSeed.z);
  vec3 p = uOrigin + dir * reach + uPush * (1.0 - exp(-uAge * 1.6)) * (0.5 + aSeed.w);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(-mvPosition.z, 0.1);
  vPlankton = step(0.35, aSeed.w);
  vAlpha = smoothstep(0.0, 0.06, uAge) * exp(-uAge * 2.2) * mix(0.3, 0.75, vPlankton);
  gl_PointSize = clamp((0.02 + 0.035 * aSeed.z) * uScale / dist, 1.0, 9.0);
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
#include <fog_pars_fragment>
varying float vAlpha;
varying float vPlankton;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.5) * vAlpha;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(0.4, 0.48, 0.55), vec3(0.32, 0.95, 0.92), vPlankton) * a;
  #ifdef USE_FOG
    col *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function seeds(count, seed) {
  const a = new Float32Array(count * 4);
  let s = seed;
  for (let i = 0; i < a.length; i++) a[i] = (s = (s * 16807) % 2147483647) / 2147483647;
  return a;
}

function points(max, count, vertexShader, extra, seed) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds(max, seed), 4));
  geometry.setDrawRange(0, Math.min(max, count));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, ...extra }]);
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: fragment, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });
  const p = new THREE.Points(geometry, material);
  p.frustumCulled = false;
  return { points: p, uniforms, setCount: (n) => geometry.setDrawRange(0, Math.min(max, n)) };
}

export function createWake(max, count) {
  const w = points(max, count, wakeVertex, { uFlow: { value: 0 }, uTime: { value: 0 }, uGlow: { value: 0 } }, 7);
  w.points.renderOrder = 3;
  return w;
}

export function createBurst(max, count) {
  const b = points(max, count, burstVertex, { uAge: { value: 9 }, uOrigin: { value: new THREE.Vector3() }, uPush: { value: new THREE.Vector3() } }, 29);
  b.points.renderOrder = 4;
  b.points.visible = false;
  return b;
}
