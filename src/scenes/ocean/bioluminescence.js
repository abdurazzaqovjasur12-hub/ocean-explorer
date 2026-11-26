import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { createRng } from '@/utils/random';
import { smoothstep } from '@/utils/math';
import { nightAt } from './depthPalette';

const MAX = QUALITY_LEVELS.high.story.glow;
const BOX = new THREE.Vector3(44, 36, 56); // the volume of water around the camera the sparks live in

const vertex = /* glsl */ `
attribute float aSeed;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime;
uniform float uIntensity;
uniform float uExcite;  // the camera moving fast stirs the water: everything flares
uniform float uScale;   // drawing-buffer height / 2
uniform vec3 uCam;
uniform vec3 uBox;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float s = aSeed;
  // Slow drift of their own, then wrapped into a box that travels with the camera (no CPU work per frame).
  vec3 p = position + vec3(sin(uTime * 0.13 + s * 20.0) * 0.8, uTime * (0.04 + s * 0.06), cos(uTime * 0.11 + s * 13.0) * 0.8);
  vec3 c = uCam + vec3(0.0, 0.0, -uBox.z * 0.35);
  vec3 rel = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(e.x, max(e.y, e.z))); // fade before wrapping: no popping

  vec4 mv = modelViewMatrix * vec4(c + rel, 1.0);
  float dist = -mv.z;
  float near = smoothstep(0.6, 2.5, dist);
  float far = exp(-dist * 0.045);

  // Each light breathes at its own pace, and now and then one flashes.
  float breathe = 0.5 + 0.5 * sin(uTime * (0.5 + s * 1.9) + s * 40.0);
  float flash = pow(max(0.0, sin(uTime * (0.21 + s * 0.37) + s * 91.0)), 30.0);
  vAlpha = (0.3 + 0.7 * breathe + 2.4 * flash) * (1.0 + uExcite) * uIntensity * edge * near * far;
  vColor = aColor;
  gl_PointSize = min(aSize * (1.0 + flash * 0.6) * uScale / max(dist, 0.1), 64.0);
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float glow = exp(-d * d * 5.0);
  float core = smoothstep(0.28, 0.0, d);
  float a = (glow * 0.6 + core * 0.7) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** How alive the water is at a depth: none in the sunlit water, brightest around 1,000 m, sparser deeper, rare in the abyss. */
export const glowAt = (m) => smoothstep(300, 800, m) * (1 - 0.6 * smoothstep(1200, 2200, m)) * (1 - 0.7 * smoothstep(6000, 9500, m)); // sparse in the abyss

/**
 * Bioluminescence: blue-green sparks, a few violet, and some larger soft orbs, flickering in the dark
 * around the camera. One draw call, positions animated entirely on the GPU.
 */
export function createBioluminescence(count) {
  const rng = createRng(57);
  const positions = new Float32Array(MAX * 3);
  const seeds = new Float32Array(MAX);
  const sizes = new Float32Array(MAX);
  const colors = new Float32Array(MAX * 3);
  const palette = [
    [0.3, 0.85, 1.0], // cyan-blue: most deep-sea light is blue, it travels furthest in water
    [0.4, 1.0, 0.75], // green-teal
    [0.72, 0.6, 1.0], // violet
  ];
  for (let i = 0; i < MAX; i++) {
    positions[i * 3] = (rng() - 0.5) * BOX.x;
    positions[i * 3 + 1] = (rng() - 0.5) * BOX.y;
    positions[i * 3 + 2] = (rng() - 0.5) * BOX.z;
    seeds[i] = rng();
    const orb = rng() < 0.12;
    sizes[i] = orb ? 0.35 + rng() * 0.4 : 0.07 + rng() * 0.12;
    const r = rng();
    const col = palette[r < 0.7 ? 0 : r < 0.9 ? 1 : 2];
    colors.set(orb ? col.map((v) => v * 0.55) : col, i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uExcite: { value: 0 },
    uScale: { value: 400 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX.clone() },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions are computed in the vertex shader
  points.renderOrder = 3;
  points.visible = false;

  const setCount = (n) => geometry.setDrawRange(0, Math.min(MAX, n));
  setCount(count);

  return {
    points,
    setCount,
    /** meters: camera depth; speed: how fast the camera is moving (scene units / s). */
    update(t, meters, camPos, viewportHeight, speed, under) {
      // At night the plankton just under the surface lights up as well (sea sparkle), not only the deep.
      const intensity = Math.max(glowAt(meters), nightAt(meters) * 0.6 * smoothstep(3, 40, meters)) * under;
      points.visible = intensity > 0.005;
      if (!points.visible) return;
      uniforms.uTime.value = t;
      uniforms.uIntensity.value = intensity;
      uniforms.uExcite.value += (Math.min(1.5, speed / 22) - uniforms.uExcite.value) * 0.08;
      uniforms.uScale.value = viewportHeight * 0.5;
      uniforms.uCam.value.copy(camPos);
    },
  };
}
