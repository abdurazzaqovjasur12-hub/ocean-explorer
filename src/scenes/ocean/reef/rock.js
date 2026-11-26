import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { createRng } from '@/utils/random';
import { fbm } from '@/utils/noise';
import { REEF_X, reefPoint, reefNormal, reefRows, sAtMeters, inView } from './shape';
import { reefMeters } from './glsl';
import { createNoiseTexture, NOISE_CELLS } from './noiseTexture';
import { reefLightGlsl } from './lighting';

/** The rock face as one indexed grid: columns across the view (x), rows down the cross-section. */
export function reefRockGeometry(columns) {
  const dx = (REEF_X[1] - REEF_X[0]) / columns;
  const rows = reefRows(dx * 0.85);
  const nx = columns + 1;
  const positions = new Float32Array(nx * rows.length * 3);
  const p = new THREE.Vector3();
  rows.forEach((s, j) => {
    for (let i = 0; i < nx; i++) {
      reefPoint(REEF_X[0] + i * dx, s, p);
      positions.set([p.x, p.y, p.z], (j * nx + i) * 3);
    }
  });
  const index = [];
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < columns; i++) {
      const a = j * nx + i;
      const b = a + nx; // next row (further down the face)
      // Wound so the front faces look out of the rock, towards the water and the camera.
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Lit by the scene's own lights, per vertex (reef/lighting.js), so it darkens with the water and at night like
 * everything else. Its colour comes from where it is: pale limestone with a green film of algae on the sunlit
 * crest, brown rock on the slope, pink crusts of coralline algae between 40 and 220 m, dark basalt-grey on
 * the wall, and pale sediment on every upward face. Below 200 m, faint films of glowing bacteria show on the
 * rock in patches, breathing slowly (`glow`: how dark it is around the camera, shared with the glowing
 * threads), so the wall itself is part of the living light. The high tier adds fine grain (`detail`, a
 * uniform: changing tier never recompiles the shader). `fade` dissolves the whole rock into the water as the
 * camera goes deeper than the wall can be seen (it is then hidden, and costs nothing).
 *
 * The rock is also drawn into the bloom (bloom.js) so it hides the glow behind it: there it shows only its
 * own glowing films, on black.
 */
const rockVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${reefLightGlsl}
varying vec3 vReefWorld;
varying vec3 vReefNormal;
varying vec3 vLight;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vReefWorld = wp.xyz;
  vReefNormal = normalize(mat3(m) * normal);
  vLight = reefLight(wp.xyz, vReefNormal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const rockFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uDetail;
uniform float uTime;
uniform float uReefGlow;
uniform float uReefFade;
uniform float uGlowPass;
uniform sampler2D uNoise;
varying vec3 vReefWorld;
varying vec3 vReefNormal;
varying vec3 vLight;
${reefMeters}
void main() {
  float m = reefMetersAt(vReefWorld.y);
  vec2 q = vec2(vReefWorld.x, vReefWorld.y * 1.7 + vReefWorld.z * 0.6);
  // Three reads of the baked noise (noiseTexture.js): the grain of the rock (fBm) and two kinds of patches. The
  // masks below are thresholds of these, mixed differently, rather than noise of their own.
  float g = texture2D(uNoise, q * (0.35 / ${NOISE_CELLS.b.toFixed(1)})).b;
  float g2 = texture2D(uNoise, q * (1.7 / ${NOISE_CELLS.r.toFixed(1)})).r;
  float g3 = texture2D(uNoise, (q * 0.8 + 3.0) / ${NOISE_CELLS.g.toFixed(1)}).g;

  float lz = smoothstep(200.0, 320.0, m) * (1.0 - smoothstep(1250.0, 1400.0, m));
  float film = smoothstep(0.5, 0.78, g * 0.55 + g3 * 0.45) * (0.55 + 0.45 * sin(uTime * 0.3 + q.x * 0.21 + q.y * 0.13));
  vec3 glow = vec3(0.03, 0.16, 0.22) * film * lz * uReefGlow;
  if (uGlowPass > 0.5) {
    // The bloom pass: only the glowing films, fading to black (not to the water) with distance.
#ifdef USE_FOG
    glow *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#endif
    gl_FragColor = vec4(glow * (1.0 - uReefFade), 1.0);
    return;
  }

  vec3 lime = mix(vec3(0.42, 0.4, 0.34), vec3(0.6, 0.57, 0.48), g);
  vec3 slope = mix(vec3(0.25, 0.23, 0.19), vec3(0.38, 0.34, 0.27), g);
  vec3 wall = mix(vec3(0.09, 0.1, 0.11), vec3(0.18, 0.18, 0.19), g);
  vec3 rock = mix(lime, slope, smoothstep(15.0, 60.0, m));
  rock = mix(rock, wall, smoothstep(120.0, 420.0, m));
  rock = mix(rock, vec3(0.2, 0.3, 0.12), smoothstep(0.5, 0.8, g2) * (1.0 - smoothstep(25.0, 70.0, m)) * 0.6);   // algal film
  float crust = smoothstep(0.55, 0.75, g3 * 0.65 + g * 0.35) * smoothstep(40.0, 80.0, m) * (1.0 - smoothstep(180.0, 260.0, m));
  rock = mix(rock, vec3(0.56, 0.27, 0.33), crust * 0.7);                                                      // coralline algae
  float up = smoothstep(0.45, 0.85, vReefNormal.y) * smoothstep(0.3, 0.6, 1.0 - g3 * 0.6 - g2 * 0.4);
  rock = mix(rock, mix(vec3(0.62, 0.58, 0.5), vec3(0.24, 0.24, 0.24), smoothstep(150.0, 500.0, m)), up * 0.55); // sediment
  if (uDetail > 0.0) rock *= 1.0 + uDetail * (texture2D(uNoise, q * (4.5 / ${NOISE_CELLS.a.toFixed(1)})).a - 0.5) * 0.35 * smoothstep(40.0, 10.0, distance(vReefWorld, cameraPosition)); // fine grain, up close

  gl_FragColor = vec4(rock * vLight + glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uReefFade);
#endif
}`;

export function reefRockMaterial({ time, glow, fade, light }) {
  const material = new THREE.ShaderMaterial({
    vertexShader: rockVertex,
    fragmentShader: rockFragment,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...light,
      uDetail: { value: 0 },
      uTime: time,
      uReefGlow: glow,
      uReefFade: fade,
      uGlowPass: { value: 0 },
      uNoise: { value: createNoiseTexture() },
    },
    fog: true,
  });
  material.userData.detail = material.uniforms.uDetail;
  return material;
}

/** Tells the rock's material, before each draw, whether this is the bloom pass (the camera sees only the glow layer). */
export function markGlowPass(mesh, glowLayer) {
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material) => {
    const pass = camera.layers.mask === 1 << glowLayer ? 1 : 0;
    if (material.uniforms.uGlowPass.value !== pass) {
      material.uniforms.uGlowPass.value = pass;
      material.uniformsNeedUpdate = true;
    }
  };
}

/**
 * Boulders and blocks fallen on the crest and the slope (14 - 150 m), so the reef reads as rock and not as a
 * smooth bank: one noise-dented, flattened rock, instanced, with the rock's own material.
 */
export function createBoulders(material) {
  const max = QUALITY_LEVELS.high.story.reef.boulders;
  const rng = createRng(71);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.7 + 0.6 * fbm(v.x * 1.6 + 4, v.y * 1.6 + v.z * 1.2, 3));
    v.y *= 0.6;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(g, material, max);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const s0 = sAtMeters(14);
  const s1 = sAtMeters(150);
  let placed = 0;
  for (let tries = 0; placed < max && tries < max * 200; tries++) {
    const x = -55 + rng() * 65;
    const at = s0 + (s1 - s0) * rng();
    const pos = reefPoint(x, at);
    if (!inView(pos) || Math.hypot(pos.x, pos.z) > 44) continue;
    const n = reefNormal(x, at);
    if (n.y < 0.45) continue;
    const size = 0.35 + Math.pow(rng(), 2.4) * 1.7;
    pos.addScaledVector(n, size * 0.12);
    e.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
    s.set(size * (0.8 + rng() * 0.6), size * (0.7 + rng() * 0.5), size * (0.8 + rng() * 0.6));
    mesh.setMatrixAt(placed++, m.compose(pos, q.setFromEuler(e), s));
  }
  mesh.count = placed;
  mesh.userData.placed = placed;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
