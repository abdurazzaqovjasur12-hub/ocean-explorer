import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { QUALITY_LEVELS } from '@/config/quality';
import { depthToY } from '@/config/zones';
import { createRng } from '@/utils/random';
import { smoothstep } from '@/utils/math';
import { createSprite } from './particles';

/*
 * Hydrothermal vent field on a mid-ocean ridge, for the vents chapter (~3,000 m).
 *
 *   floor      rocky ridge: fBm relief, shader rock detail and bump, sediment on the flats, rust and bacterial
 *              mats round the vents, glowing cracks near them
 *   rocks      boulders and pillow-lava lumps (instanced)
 *   chimneys   knobbly sulphide chimneys with a mound at the foot, flanges, a crater at the top and side spires;
 *              their upper parts and cracks glow with the heat inside
 *   worms      tube worm clumps (instanced)
 *   smoke      black-smoker plumes: camera-facing quads with procedural billowing smoke, born hot and orange,
 *              cooling to black, spreading and bending in the current
 *   embers     hot mineral grains shot out of the mouths, cooling as they rise
 *   sediment   particles drifting over the whole field, warm-lit near the vents
 *   glow       soft light at the mouths and pools of warm haze at the feet
 *   + one warm point light that flickers on the rock
 *
 * Nine draw calls, all GPU-animated, all hidden outside the vent depths. Counts and smoke quality per tier
 * (`story.vents` in config/quality.js). The point light is never removed or hidden (that would recompile every
 * lit material); its intensity drops to zero instead.
 */

const FLOOR_Y = depthToY(3110); // the crest of the ridge, a little below the vent chapter's camera
// Main chimneys: [x, z, height, radius]. Ahead of and below the camera path (which runs down x = 0, z = 0).
const VENTS = [
  [-6, -20, 6.5, 0.9],
  [-1.5, -27, 8.5, 1.1],
  [4.5, -18, 4.6, 0.75],
  [9.5, -29, 7.2, 1.0],
  [-12, -31, 5.2, 0.8],
];
const N = VENTS.length;
const MAX = QUALITY_LEVELS.high.story.vents;
// The field stops short of the camera path, so the camera never passes through it on the way down.
const FIELD = { width: 96, near: -4, far: -74 };

// ---------------------------------------------------------------------------------------------------------
// Noise on the CPU (for geometry), the same family as the GPU's

function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.3;
    amp *= 0.5;
  }
  return sum;
}

/** A ridge running across the view: a rough, blocky crest that falls away steeply towards the camera and beyond. */
function floorHeight(x, z) {
  const off = Math.max(0, Math.abs(z + 26) - 14);
  const relief = (fbm(x * 0.09, z * 0.09, 4) - 0.5) * 5; // broad swells
  const rock = (fbm(x * 0.45 + 3.1, z * 0.45 - 1.7, 3) - 0.5) * 1.3; // rubble
  const ridges = Math.abs(fbm(x * 0.06 - 5, z * 0.2 + 2, 2) - 0.5) * -2.2; // fissures along the ridge
  return relief + rock + ridges - off * off * 0.12;
}
const groundAt = (x, z) => FLOOR_Y + floorHeight(x, z);
const ventTop = ([x, z, h]) => new THREE.Vector3(x, groundAt(x, z) + h, z);

// ---------------------------------------------------------------------------------------------------------
// Shared GLSL

const glslNoise = /* glsl */ `
float vh12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vn(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vh12(i), vh12(i + vec2(1.0, 0.0)), u.x), mix(vh12(i + vec2(0.0, 1.0)), vh12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; }
  return s;
}
// Thin bright lines where the noise crosses its middle: cracks.
float cracks(vec2 p) { return 1.0 - smoothstep(0.0, 0.07, abs(vn(p) - 0.5)); }
vec3 bumpNormal(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

// Additive light should fade to black in the fog (normally blended smoke uses three.js's own fog instead).
const fogToBlack = /* glsl */ `
#ifdef USE_FOG
  col *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#endif`;

/** Shared uniforms: time, the vents (x, z, heat radius) and the flicker of the heat. */
function sharedUniforms() {
  return {
    uTime: { value: 0 },
    uHeat: { value: 1 },
    uVents: { value: VENTS.map(([x, z, , r]) => new THREE.Vector3(x, z, 2.2 + r * 1.6)) },
    uMouths: { value: VENTS.map(ventTop) },
    uCurrent: { value: new THREE.Vector2(1, 0.25) },
  };
}

/** Adds world position, procedural rock colour, bump and glowing cracks to a MeshStandardMaterial. */
function rockMaterial(shared, { key, kind }) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = `varying vec3 vWorld;\nattribute float aHeat;\nvarying float vHeat;\n${shader.vertexShader}`
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 wp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
#endif
vWorld = (modelMatrix * wp).xyz;
#if ${kind === 'chimney' ? 1 : 0}
  vHeat = aHeat;
#else
  vHeat = 0.0;
#endif`);
    shader.fragmentShader = `
uniform float uTime;
uniform float uHeat;
uniform vec3 uVents[${N}];
varying vec3 vWorld;
varying float vHeat;
${glslNoise}
float ventHeat(vec2 xz) {
  float h = 0.0;
  for (int i = 0; i < ${N}; i++) h += exp(-distance(xz, uVents[i].xy) / uVents[i].z);
  return h;
}
${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
float heatField = ventHeat(vWorld.xz);
float grain = fbm3(vWorld.xz * 0.9 + vWorld.y * 0.3);
vec3 rock = mix(vec3(0.06, 0.065, 0.075), vec3(0.13, 0.13, 0.14), grain);           // basalt
#if ${kind === 'chimney' ? 1 : 0}
  rock = mix(vec3(0.06, 0.05, 0.045), vec3(0.3, 0.17, 0.07), smoothstep(0.45, 0.75, vn(vec2(atan(vWorld.z, vWorld.x) * 3.0, vWorld.y * 1.3))) * 0.8); // sulphide with ochre streaks
  rock = mix(rock, vec3(0.38, 0.36, 0.32), smoothstep(0.6, 0.95, vHeat) * 0.5);       // pale anhydrite near the mouth
#else
  float flats = smoothstep(0.75, 0.95, vNormal.y);                                     // sediment settles on the flats (view-space up is close enough here)
  rock = mix(rock, vec3(0.17, 0.165, 0.155), flats * smoothstep(0.35, 0.7, fbm3(vWorld.xz * 0.35)) * 0.7);
  float stain = smoothstep(0.15, 1.2, heatField) * smoothstep(0.3, 0.7, fbm3(vWorld.xz * 1.3 + 4.0));
  rock = mix(rock, vec3(0.34, 0.15, 0.05), stain * 0.85);                              // iron oxides: rust
  float mats = smoothstep(0.2, 0.45, heatField) * (1.0 - smoothstep(0.6, 1.0, heatField)) * smoothstep(0.55, 0.8, vn(vWorld.xz * 2.1));
  rock = mix(rock, vec3(0.5, 0.47, 0.34), mats * 0.6);                                // bacterial mats in a ring round each vent
#endif
diffuseColor.rgb *= rock;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float hBump = fbm3(vWorld.xz * 2.4 + vWorld.y * 1.7) + 0.35 * vn(vWorld.xz * 9.0 + vWorld.y * 5.0);
float bumpFade = smoothstep(42.0, 8.0, length(vViewPosition));
normal = bumpNormal(-vViewPosition, normal, vec2(dFdx(hBump), dFdy(hBump)) * 0.6 * bumpFade, faceDirection);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 ember = vec3(1.0, 0.36, 0.07);
#if ${kind === 'chimney' ? 1 : 0}
  float c = cracks(vec2(atan(vWorld.z, vWorld.x) * 2.5 + vWorld.y * 0.6, vWorld.y * 2.2));
  totalEmissiveRadiance += ember * (pow(vHeat, 4.0) * 1.6 + c * smoothstep(0.35, 1.0, vHeat) * 1.4) * uHeat;
#else
  float c = cracks(vWorld.xz * 1.6) * cracks(vWorld.xz * 0.7 + 3.0);
  float near = smoothstep(0.35, 1.4, heatField);
  totalEmissiveRadiance += ember * (c * near * 1.6 + 0.05 * heatField) * uHeat;    // glowing cracks, a faint warm pool
#endif`);
  };
  material.customProgramCacheKey = () => `vents-${key}`;
  return material;
}

// ---------------------------------------------------------------------------------------------------------
// Geometry

function floorGeometry(segments) {
  const depth = FIELD.near - FIELD.far;
  const g = new THREE.PlaneGeometry(FIELD.width, depth, segments, Math.round(segments * (depth / FIELD.width)));
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, (FIELD.near + FIELD.far) / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  return g;
}

/** One chimney: a mound at the foot, a knobbly leaning column with flanges, a crater at the top. */
function chimney(rng, x, z, height, radius, rings, sides) {
  const seed = rng() * 100;
  const base = groundAt(x, z) - 1.2; // sunk into the floor: no gap at the foot
  const total = height + 1.2;
  const flanges = [0.35 + rng() * 0.15, 0.6 + rng() * 0.15];
  const pos = [];
  const heat = [];
  const index = [];
  const ring = (y, cx, cz, r, t, h) => {
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const n = fbm(ca * 1.4 + seed + t * 4, sa * 1.4 + t * 7, 3); // periodic around the column: no seam
      const rr = r * (0.72 + 0.6 * n);
      pos.push(cx + ca * rr, y, cz + sa * rr);
      heat.push(h);
    }
  };
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    let r = radius * (1 + 1.7 * Math.exp(-t * 7)) * (1 - 0.35 * t);
    for (const f of flanges) r *= 1 + 0.4 * Math.exp(-(((t - f) / 0.035) ** 2));
    const cx = x + Math.sin(t * 2.2 + seed) * 0.45 * t;
    const cz = z + Math.cos(t * 1.7 + seed) * 0.45 * t;
    ring(base + t * total, cx, cz, r, t, Math.pow(t, 5));
  }
  // The crater: a lip folding inwards and down into the hot throat.
  const tx = x + Math.sin(2.2 + seed) * 0.45;
  const tz = z + Math.cos(1.7 + seed) * 0.45;
  ring(base + total - 0.05, tx, tz, radius * 0.38, 1.02, 1);
  ring(base + total - 0.6, tx, tz, radius * 0.12, 1.04, 1);
  const rows = rings + 3;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const k = i * (sides + 1) + j;
      const n = k + sides + 1;
      index.push(k, n, k + 1, k + 1, n, n + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aHeat', new THREE.Float32BufferAttribute(heat, 1));
  g.setIndex(index);
  return g;
}

function chimneysGeometry(rng, detail) {
  const parts = [];
  for (const [x, z, h, r] of VENTS) {
    parts.push(chimney(rng, x, z, h, r, detail.rings, detail.sides));
    // One or two smaller spires leaning off the same mound.
    const spires = 1 + Math.floor(rng() * 2);
    for (let s = 0; s < spires; s++) {
      const a = rng() * Math.PI * 2;
      const d = r * (1.6 + rng() * 0.8);
      parts.push(chimney(rng, x + Math.cos(a) * d, z + Math.sin(a) * d, h * (0.3 + rng() * 0.3), r * 0.45, Math.round(detail.rings * 0.6), Math.max(8, Math.round(detail.sides * 0.7))));
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** Boulders and pillow-lava lumps: one noise-dented rock, instanced at many sizes. */
function createRocks(material, rng, count) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.7 + 4, v.y * 1.7 + v.z * 1.3, 3);
    v.multiplyScalar(0.75 + 0.5 * n);
    v.y *= 0.65; // squat, like pillow lava
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const heat = new Float32Array(p.count);
  g.setAttribute('aHeat', new THREE.BufferAttribute(heat, 1));

  const mesh = new THREE.InstancedMesh(g, material, MAX.rocks);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let placed = 0;
  while (placed < MAX.rocks) {
    const x = (rng() - 0.5) * FIELD.width * 0.8;
    const z = FIELD.far * 0.15 + (rng() - 0.5) * 40 - 16;
    if (z > FIELD.near - 3) continue;
    if (VENTS.some(([vx, vz, , vr]) => Math.hypot(x - vx, z - vz) < vr * 2.6)) continue; // not on a chimney
    const size = 0.4 + Math.pow(rng(), 2.2) * 2.2;
    pos.set(x, groundAt(x, z) + size * 0.15, z);
    e.set((rng() - 0.5) * 0.4, rng() * Math.PI, (rng() - 0.5) * 0.4);
    s.set(size * (0.8 + rng() * 0.5), size, size * (0.8 + rng() * 0.5));
    mesh.setMatrixAt(placed++, m.compose(pos, q.setFromEuler(e), s));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Tube worms: white tubes with blood-red plumes, in clumps round the chimney feet. One instanced mesh. */
function createWorms(rng) {
  const tube = new THREE.CylinderGeometry(0.045, 0.06, 0.9, 5, 1, true);
  tube.translate(0, 0.45, 0);
  const plume = new THREE.ConeGeometry(0.11, 0.26, 6, 1);
  plume.rotateX(Math.PI);
  plume.translate(0, 0.98, 0);
  const paint = (g, hex) => {
    const f = g.index ? g.toNonIndexed() : g;
    const col = new THREE.Color(hex);
    const arr = new Float32Array(f.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) arr.set([col.r, col.g, col.b], i);
    f.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    f.deleteAttribute('uv');
    return f;
  };
  const geometry = mergeGeometries([paint(tube, 0xd9d4c6), paint(plume, 0xb3121c)], false);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX.worms);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < MAX.worms; i++) {
    const [vx, vz, , vr] = VENTS[i % N];
    const a = rng() * Math.PI * 2;
    const d = vr * 2.4 + rng() * 2.2;
    const x = vx + Math.cos(a) * d;
    const z = vz + Math.sin(a) * d;
    p.set(x, groundAt(x, z) - 0.05, z);
    e.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
    s.setScalar(0.7 + rng() * 0.9);
    mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------
// Smoke: instanced camera-facing quads with procedural smoke

const smokeVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute float aVent;
attribute vec4 aSeed;
uniform vec3 uMouths[${N}];
uniform float uTime;
uniform vec2 uCurrent;
varying vec2 vUv;
varying float vLife;
varying vec4 vSeed;

void main() {
  vec3 m = uMouths[int(aVent + 0.5)];
  float life = fract(uTime * (0.045 + 0.03 * aSeed.x) + aSeed.y);
  float rise = life * (15.0 + 6.0 * aSeed.z);
  vec3 c = m + vec3(0.0, rise, 0.0);
  c.xz += uCurrent * life * life * 7.0;                                         // the plume leans over in the current
  c.xz += vec2(sin(life * 6.0 + aSeed.w * 20.0), cos(life * 5.0 + aSeed.x * 17.0)) * life * 1.6; // and churns
  float size = mix(0.7, 6.5, sqrt(life)) * (0.75 + 0.5 * aSeed.w);
  float ang = aSeed.x * 6.2832 + life * (aSeed.z - 0.5) * 3.0;                 // each puff turns slowly
  vec2 corner = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * position.xy;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c + (right * corner.x + up * corner.y) * size;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vLife = life;
  vSeed = aSeed;
  #include <fog_vertex>
}
`;

const smokeFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform float uOpacity;
uniform float uHeat;
varying vec2 vUv;
varying float vLife;
varying vec4 vSeed;
${glslNoise}
float smokeFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < SMOKE_OCTAVES; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
  return s;
}

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  // Billowing: noise in the puff, drifting as it rises, warped by a second layer.
  vec2 q = vUv * 2.3 + vSeed.xy * 13.0 + vec2(0.0, -vLife * 1.6);
  #if SMOKE_WARP
    float warp = smokeFbm(q * 0.7 + 5.0);
  #else
    float warp = 0.5;
  #endif
  float n = smokeFbm(q + warp * 1.2);
  float shape = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.9);
  float density = shape * smoothstep(0.0, 0.05, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife)) * uOpacity;
  if (density < 0.004) discard;
  // Hot and orange at the mouth; then black smoke, lit from below by the glow, cooling as it climbs.
  float hot = exp(-vLife * 14.0);
  vec3 col = vec3(0.045, 0.05, 0.06) * (0.6 + 0.8 * n);
  col += vec3(0.45, 0.15, 0.035) * exp(-vLife * 4.5) * (0.4 + 0.8 * n) * uHeat;
  col = mix(col, vec3(1.0, 0.5, 0.15) * uHeat, hot);
  gl_FragColor = vec4(col, density);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment> // after the colour conversion, like the built-in materials: fades exactly as the rock does
}
`;

function createSmoke(shared, count, octaves) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  const rng = createRng(301);
  const vent = new Float32Array(MAX.smoke);
  const seed = new Float32Array(MAX.smoke * 4);
  for (let i = 0; i < MAX.smoke; i++) {
    vent[i] = i % N;
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rng();
  }
  g.setAttribute('aVent', new THREE.InstancedBufferAttribute(vent, 1));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = Math.min(MAX.smoke, count);
  const material = new THREE.ShaderMaterial({
    vertexShader: smokeVertex,
    fragmentShader: smokeFragment,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 0.42 } }]),
    defines: { SMOKE_OCTAVES: octaves, SMOKE_WARP: octaves >= 4 ? 1 : 0 },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  for (const k of ['uTime', 'uMouths', 'uCurrent', 'uHeat']) material.uniforms[k] = shared[k];
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    setQuality(next) {
      g.instanceCount = Math.min(MAX.smoke, next.story.vents.smoke);
      if (material.defines.SMOKE_OCTAVES !== next.story.vents.octaves) {
        material.defines.SMOKE_OCTAVES = next.story.vents.octaves;
        material.defines.SMOKE_WARP = next.story.vents.octaves >= 4 ? 1 : 0;
        material.needsUpdate = true;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Point layers: embers, sediment, glow

const emberVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute float aVent;
attribute vec4 aSeed;
uniform vec3 uMouths[${N}];
uniform float uTime;
uniform vec2 uCurrent;
uniform float uScale;
varying float vLife;

void main() {
  vec3 m = uMouths[int(aVent + 0.5)];
  float life = fract(uTime * (0.2 + 0.25 * aSeed.x) + aSeed.y);
  float a = aSeed.z * 6.2832;
  float burst = 1.0 - exp(-life * 4.0);                       // shot out fast, then carried
  vec3 p = m + vec3(cos(a) * burst * (0.3 + 0.9 * aSeed.w), burst * (3.0 + 4.0 * aSeed.x) + life * 2.0, sin(a) * burst * (0.3 + 0.9 * aSeed.w));
  p.xz += uCurrent * life * life * 2.5;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp((0.05 + 0.05 * aSeed.w) * uScale / max(-mvPosition.z, 0.1), 1.0, 10.0);
  vLife = life;
  #include <fog_vertex>
}
`;
const emberFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform float uHeat;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.4, 1.0, vLife)) * smoothstep(0.0, 0.03, vLife);
  if (a < 0.003) discard;
  vec3 col = mix(vec3(1.0, 0.75, 0.35), vec3(0.6, 0.1, 0.02), smoothstep(0.0, 0.6, vLife)) * a * 1.6 * uHeat; // cools as it rises
  ${fogToBlack}
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const sedimentVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform vec3 uMouths[${N}];
uniform float uTime;
uniform vec2 uCurrent;
uniform float uScale;
uniform vec3 uBoxCentre;
uniform vec3 uBox;
varying float vWarm;
varying float vAlpha;

void main() {
  // Drift with the current, settle slowly, swirl; wrapped inside a box over the field (no CPU work).
  vec3 p = position + vec3(uCurrent.x, -0.08, uCurrent.y) * uTime * (0.25 + 0.3 * aSeed.x);
  p += vec3(sin(uTime * 0.3 + aSeed.y * 30.0), sin(uTime * 0.23 + aSeed.z * 20.0) * 0.5, cos(uTime * 0.27 + aSeed.w * 25.0)) * 0.6;
  vec3 rel = mod(p - uBoxCentre + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(e.x, max(e.y, e.z)));
  vec3 w = uBoxCentre + rel;
  float warm = 0.0;
  for (int i = 0; i < ${N}; i++) warm += exp(-distance(w, uMouths[i] - vec3(0.0, 3.0, 0.0)) / 5.0);
  vWarm = min(warm, 1.5);
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp((0.05 + 0.07 * aSeed.x) * uScale / max(-mvPosition.z, 0.1), 1.0, 9.0);
  vAlpha = edge * (0.35 + 0.65 * aSeed.y);
  #include <fog_vertex>
}
`;
const sedimentFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform float uHeat;
varying float vWarm;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 3.5) * vAlpha;
  if (a < 0.003) discard;
  vec3 col = (vec3(0.1, 0.14, 0.2) + vec3(1.0, 0.45, 0.15) * vWarm * 0.9 * uHeat) * a * 0.55; // dim blue-grey, warm-lit near the vents
  ${fogToBlack}
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const glowVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute float aSize;
attribute float aStrength;
attribute float aSeed;
uniform float uScale;
uniform float uTime;
uniform float uHeat;
varying float vStrength;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min(aSize * uScale / max(-mvPosition.z, 0.1), 512.0);
  vStrength = aStrength * uHeat * (0.85 + 0.15 * sin(uTime * (3.0 + aSeed * 4.0) + aSeed * 30.0));
  #include <fog_vertex>
}
`;
const glowFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform sampler2D uMap;
varying float vStrength;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vStrength;
  vec3 col = vec3(1.0, 0.42, 0.12) * a;
  ${fogToBlack}
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function pointsLayer({ vertexShader, fragmentShader, attributes, count, max, uniforms, shared, keys, blending = THREE.AdditiveBlending }) {
  const g = new THREE.BufferGeometry();
  for (const [name, [array, size]] of Object.entries(attributes)) g.setAttribute(name, new THREE.BufferAttribute(array, size));
  if (!g.attributes.position) g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  g.setDrawRange(0, Math.min(max, count));
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    transparent: true,
    depthWrite: false,
    blending,
    fog: true,
  });
  for (const k of keys) material.uniforms[k] = shared[k];
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return { points, material, setCount: (n) => g.setDrawRange(0, Math.min(max, n)) };
}

function seeds(n, rng) {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = rng();
  return a;
}

// ---------------------------------------------------------------------------------------------------------

export function createVents(scene, settings) {
  const rng = createRng(77);
  const tier = settings.story.vents;
  const shared = sharedUniforms();
  shared.uScale = { value: 400 };
  const group = new THREE.Group();
  group.visible = false;

  const floor = new THREE.Mesh(floorGeometry(tier.floor), rockMaterial(shared, { key: 'floor', kind: 'floor' }));
  floor.geometry.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(floor.geometry.attributes.position.count), 1));
  const rocks = createRocks(rockMaterial(shared, { key: 'rocks', kind: 'rocks' }), rng, tier.rocks);
  rocks.count = Math.min(MAX.rocks, tier.rocks);
  const chimneys = new THREE.Mesh(chimneysGeometry(rng, tier.chimney), rockMaterial(shared, { key: 'chimney', kind: 'chimney' }));
  const worms = createWorms(rng);
  worms.count = Math.min(MAX.worms, tier.worms);
  const smoke = createSmoke(shared, tier.smoke, tier.octaves);

  // Embers from the mouths.
  const emberVent = new Float32Array(MAX.embers);
  for (let i = 0; i < MAX.embers; i++) emberVent[i] = i % N;
  const embers = pointsLayer({
    vertexShader: emberVertex,
    fragmentShader: emberFragment,
    attributes: { aVent: [emberVent, 1], aSeed: [seeds(MAX.embers, rng), 4] },
    count: tier.embers,
    max: MAX.embers,
    uniforms: {},
    shared,
    keys: ['uMouths', 'uTime', 'uCurrent', 'uScale', 'uHeat'],
  });

  // Sediment over the whole field.
  const box = new THREE.Vector3(64, 14, 52);
  const sedPos = new Float32Array(MAX.sediment * 3);
  for (let i = 0; i < MAX.sediment; i++) {
    sedPos[i * 3] = (rng() - 0.5) * box.x;
    sedPos[i * 3 + 1] = (rng() - 0.5) * box.y;
    sedPos[i * 3 + 2] = (rng() - 0.5) * box.z;
  }
  const sediment = pointsLayer({
    vertexShader: sedimentVertex,
    fragmentShader: sedimentFragment,
    attributes: { position: [sedPos, 3], aSeed: [seeds(MAX.sediment, rng), 4] },
    count: tier.sediment,
    max: MAX.sediment,
    uniforms: { uBoxCentre: { value: new THREE.Vector3(0, FLOOR_Y + 5, -26) }, uBox: { value: box } },
    shared,
    keys: ['uMouths', 'uTime', 'uCurrent', 'uScale', 'uHeat'],
  });

  // Glow: a bright, tight light at each mouth and a broad warm haze at each foot.
  const glowPos = [];
  const glowSize = [];
  const glowStrength = [];
  const glowSeed = [];
  VENTS.forEach(([x, z, h, r], i) => {
    const top = ventTop(VENTS[i]);
    glowPos.push(top.x, top.y + 0.2, top.z, x, groundAt(x, z) + 0.8, z);
    glowSize.push(2.6 + r, 10 + r * 4);
    glowStrength.push(1.0, 0.22);
    glowSeed.push(rng(), rng());
  });
  const glow = pointsLayer({
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    attributes: {
      position: [new Float32Array(glowPos), 3],
      aSize: [new Float32Array(glowSize), 1],
      aStrength: [new Float32Array(glowStrength), 1],
      aSeed: [new Float32Array(glowSeed), 1],
    },
    count: N * 2,
    max: N * 2,
    uniforms: { uMap: { value: createSprite() } },
    shared,
    keys: ['uTime', 'uScale', 'uHeat'],
  });

  group.add(floor, rocks, chimneys, worms, smoke.mesh, embers.points, sediment.points, glow.points);

  // Warm light from the vent field, on the rock, the worms and the smoke's roots.
  const light = new THREE.PointLight(0xff7a33, 0, 38, 2);
  light.position.set(-1, FLOOR_Y + 4, -24);
  scene.add(light);
  scene.add(group);

  return {
    group,
    glowing: [floor, chimneys, embers.points, glow.points], // their glowing cracks, mouths and embers feed the bloom
    update(dt, t, meters, viewportHeight) {
      const presence = smoothstep(2300, 2750, meters) * (1 - smoothstep(3150, 3250, meters));
      group.visible = presence > 0.001;
      const flicker = 0.88 + 0.12 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
      light.intensity = group.visible ? presence * 85 * flicker : 0;
      if (!group.visible) return;
      shared.uTime.value = t;
      shared.uHeat.value = 0.85 + 0.15 * Math.sin(t * 5.1 + Math.sin(t * 1.7));
      shared.uScale.value = viewportHeight * 0.5;
      shared.uCurrent.value.set(Math.cos(t * 0.05) * 0.9 + 0.3, Math.sin(t * 0.04) * 0.4);
    },
    setQuality(next) {
      const v = next.story.vents;
      smoke.setQuality(next);
      embers.setCount(v.embers);
      sediment.setCount(v.sediment);
      rocks.count = Math.min(MAX.rocks, v.rocks);
      worms.count = Math.min(MAX.worms, v.worms);
    },
  };
}
