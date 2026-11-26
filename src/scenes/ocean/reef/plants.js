import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { depthToY, metersBelowSurface } from '@/config/zones';
import { createRng } from '@/utils/random';
import { lerp } from '@/utils/math';
import { BANDS } from './bands';
import { reefPoint, reefNormal, sAtMeters, inView } from './shape';
import { fbm } from '@/utils/noise';
import { reefLightGlsl } from './lighting';
import { seagrassGeometry, leafyGeometry, kelpGeometry, redAlgaeGeometry } from './plantGeometry';

const MAX = QUALITY_LEVELS.high.story.reef;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The plants' material: lit by the scene's lights like the rock, per vertex (reef/lighting.js), so they lose
 * their colours with depth and darken at night; animated entirely on the GPU. Each vertex is carried by the
 * swell (back and forth along the current, more the higher up the plant it is, with a lag so a wave runs up
 * the stem) and the tips flutter. Leaves are thin, so they are lit on whichever side faces the camera; seen
 * against the light they glow through (`uBackLight`: the sun's colour left at this depth, silver at night), and
 * the light scattered in the water reaches the undersides too (`uAmbient`), so a leaf seen from below is dark,
 * not black. The fragment shader only applies the colour and the fog. One shader for every plant; the kinds
 * differ only in their uniforms.
 */
const plantVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${reefLightGlsl}
attribute float aBend;
attribute float aFlutter;
uniform float uTime;
uniform vec2 uCurrent;
uniform float uStir;
uniform float uSway;
uniform float uFreq;
uniform float uFlutter;
uniform vec3 uRayDir;
uniform vec3 uBackLight;
uniform vec3 uAmbient;
uniform float uTranslucent;
varying vec3 vColor;
varying vec3 vShade;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vec3 root = m[3].xyz;
  float H = length(m[1].xyz);
  float ph = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
  float h = aBend;
  float tt = uTime * uFreq;
  // The swell: a slow surge, a slower one beneath it, and a little crosswise roll; it runs up the stem.
  float surge = sin(tt * 0.55 + ph + root.x * 0.08 - h * 1.2) * 0.65 + sin(tt * 0.23 + ph * 1.7) * 0.35;
  float roll = sin(tt * 0.41 + ph * 2.3 - h * 1.9);
  vec2 perp = vec2(-uCurrent.y, uCurrent.x);
  float amp = uSway * H * h * h * (1.0 + uStir);
  wp.xz += (uCurrent * (surge + 0.35) + perp * roll * 0.35) * amp;
  wp.y -= abs(surge) * amp * 0.25 * h;
  float fl = aFlutter * uFlutter * (1.0 + uStir);
  wp.xyz += vec3(sin(tt * 2.1 + ph * 7.0 + h * 9.0), cos(tt * 1.7 + ph * 5.0 + h * 7.0) * 0.6, cos(tt * 2.4 + ph * 3.0 + h * 5.0)) * fl;

  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 n = normalize(mat3(m) * normal);
  n *= sign(dot(n, toCam) + 1e-4); // the side we see
  float back = pow(max(0.0, dot(-toCam, uRayDir)), 4.0);
  vShade = reefLight(wp.xyz, n) + uBackLight * back * uTranslucent + uAmbient;
#ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
#else
  vColor = vec3(1.0);
#endif
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const plantFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying vec3 vColor;
varying vec3 vShade;
void main() {
  gl_FragColor = vec4(vColor * vShade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function plantMaterial(shared, { sway, freq, flutter, translucent, key }) {
  const material = new THREE.ShaderMaterial({
    vertexShader: plantVertex,
    fragmentShader: plantFragment,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shared,
      uSway: { value: sway },
      uFreq: { value: freq },
      uFlutter: { value: flutter },
      uTranslucent: { value: translucent },
    },
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = `reef-${key}`;
  return material;
}

/**
 * Scatters `count` spots on the rock within a depth band: in view from the dive, no further than `maxDist`
 * from it, on faces turned up at least `minUp`. `accept(p, n)` can turn a spot down. Plants grow in patches
 * (`patchy` 0..1: how strongly), with bare rock between them.
 */
function scatter(rng, count, { from, to, minUp = -1, maxDist = 80, minDist = 0, patchy = 0.6, seed = 0, accept }) {
  const s0 = sAtMeters(Math.max(0, from - 12)) - (from < 25 ? 16 : 0); // the crest spills over onto the reef flat
  const s1 = sAtMeters(to + 12);
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 120) {
    const x = -60 + rng() * 72; // the reef is on the left; it turns away just right of the middle
    const s = lerp(s0, s1, rng());
    const p = reefPoint(x, s);
    const m = metersBelowSurface(p.y);
    if (m < from || m > to || !inView(p)) continue;
    const dist = Math.hypot(p.x, p.z);
    if (dist > maxDist || dist < minDist) continue;
    const n = reefNormal(x, s);
    if (n.y < minUp) continue;
    const patch = fbm(x * 0.16 + seed, s * 0.2 - seed, 3);
    if (rng() > 1 - patchy + patchy * Math.min(1, Math.max(0, (patch - 0.35) / 0.25))) continue;
    if (accept && !accept(p, n)) continue;
    out.push({ p, n, dist });
  }
  return out;
}

const q = new THREE.Quaternion();
const yawQ = new THREE.Quaternion();
const m4 = new THREE.Matrix4();
const dir = new THREE.Vector3();
const scl = new THREE.Vector3();
const pos = new THREE.Vector3();
const col = new THREE.Color();

/**
 * Fills an InstancedMesh: each plant stands on its spot, upright or partly turned to the rock (`follow`: 0 grows
 * straight up, 1 straight out of the face), turned at random, sized by `size(rng, spot)` => [width, height].
 * Instance colours from `palette`, varied a little.
 */
function plant(geometry, material, spots, { follow, size, palette, rng }) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, spots.length));
  spots.forEach((spot, i) => {
    dir.copy(UP).lerp(spot.n, follow);
    dir.x += (rng() - 0.5) * 0.25;
    dir.z += (rng() - 0.5) * 0.25;
    q.setFromUnitVectors(UP, dir.normalize()).multiply(yawQ.setFromAxisAngle(UP, rng() * Math.PI * 2));
    const [w, h] = size(rng, spot);
    pos.copy(spot.p).addScaledVector(spot.n, -0.04); // the root a little into the rock
    mesh.setMatrixAt(i, m4.compose(pos, q, scl.set(w, h, w)));
    col.copy(palette[Math.floor(rng() * palette.length)]).multiplyScalar(0.85 + rng() * 0.3);
    mesh.setColorAt(i, col);
  });
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

const colors = (...hex) => hex.map((h) => new THREE.Color(h));

/** Splits spots into near and far (for the two levels of detail) by their distance from the dive. */
const byDistance = (spots, limit) => [spots.filter((s) => s.dist <= limit), spots.filter((s) => s.dist > limit)];

/** Kelp may only stand where its whole stipe is clear of the rock above (the slope leans back as it rises). */
function clearOfRock(p, height) {
  const r = new THREE.Vector3();
  for (const f of [0.3, 0.6, 0.95]) {
    const y = p.y + height * f;
    reefPoint(p.x, sAtMeters(metersBelowSurface(y)), r);
    if (p.z < r.z + 0.5) return false;
  }
  return true;
}

export function createPlants(shared) {
  const rng = createRng(404);
  const B = BANDS;

  const seagrass = plant(
    seagrassGeometry(),
    plantMaterial(shared, { key: 'seagrass', sway: 0.2, freq: 1.6, flutter: 0.01, translucent: 0.6 }),
    scatter(rng, MAX.seagrass, { from: B.seagrass.from, to: B.seagrass.to, minUp: 0.55, maxDist: 50, patchy: 0.75, seed: 3 }),
    { rng, follow: 0.5, size: (r) => { const h = 0.34 + r() * 0.3; return [h * 1.4, h]; }, palette: colors('#5f9a2c', '#74a834', '#88b03e', '#4f8a2a') },
  );

  const leafy = plant(
    leafyGeometry(),
    plantMaterial(shared, { key: 'leafy', sway: 0.12, freq: 1.2, flutter: 0.02, translucent: 0.7 }),
    scatter(rng, MAX.shallow, { from: B.shallow.from, to: B.shallow.to, minUp: 0.25, maxDist: 48, patchy: 0.7, seed: 11 }),
    { rng, follow: 0.55, size: (r) => { const h = 0.28 + r() * 0.32; return [h * 1.25, h]; }, palette: colors('#7cc23a', '#9ccc4a', '#a0822c', '#b08a30', '#6aa832') },
  );

  // Kelp: the holdfast on the slope, the crown just below the waves (16 - 26 m).
  const kelpSpots = scatter(rng, MAX.kelp[0] + MAX.kelp[1], {
    from: B.kelp.from,
    to: B.kelp.to,
    minUp: 0.2,
    maxDist: 46,
    patchy: 0.8,
    seed: 23,
    accept(p) {
      p.userHeight = depthToY(lerp(B.kelp.top[0], B.kelp.top[1], rng())) - p.y;
      return p.userHeight > 0.5 && clearOfRock(p, p.userHeight);
    },
  });
  const [kelpNearSpots, kelpFarSpots] = byDistance(kelpSpots, 21);
  const kelpMat = plantMaterial(shared, { key: 'kelp', sway: 0.09, freq: 0.8, flutter: 0.022, translucent: 0.9 });
  const kelpPalette = colors('#a8782a', '#9a7024', '#b08a34', '#86762a', '#b8822c');
  const kelpSize = (r, spot) => [1.25 + r() * 0.5, spot.p.userHeight];
  const kelpNear = plant(kelpGeometry('near'), kelpMat, kelpNearSpots.slice(0, MAX.kelp[0]), { rng, follow: 0, size: kelpSize, palette: kelpPalette });
  const kelpFar = plant(kelpGeometry('far'), kelpMat, kelpFarSpots.slice(0, MAX.kelp[1]), { rng, follow: 0, size: kelpSize, palette: kelpPalette });

  // Red algae on the ledges and the wall, growing out of the rock rather than straight up.
  const algaeSpots = scatter(rng, MAX.algae[0] + MAX.algae[1], { from: B.deepAlgae.from, to: B.deepAlgae.to, minUp: 0.05, maxDist: 40, patchy: 0.9, seed: 37 });
  const [algaeNearSpots, algaeFarSpots] = byDistance(algaeSpots, 17);
  const algaeMat = plantMaterial(shared, { key: 'algae', sway: 0.05, freq: 0.7, flutter: 0.012, translucent: 0.35 });
  const algaePalette = colors('#c0303a', '#a82048', '#d0505c', '#b8343c', '#a86a30');
  const algaeSize = (r) => { const h = 0.4 + r() * 0.45; return [h * 1.15, h]; };
  const algaeNear = plant(redAlgaeGeometry('near'), algaeMat, algaeNearSpots.slice(0, MAX.algae[0]), { rng, follow: 0.6, size: algaeSize, palette: algaePalette });
  const algaeFar = plant(redAlgaeGeometry('far'), algaeMat, algaeFarSpots.slice(0, MAX.algae[1]), { rng, follow: 0.6, size: algaeSize, palette: algaePalette });

  const all = { seagrass, leafy, kelpNear, kelpFar, algaeNear, algaeFar };
  // How many of each the tier draws (instances were scattered at random, so the first n are an even subset).
  const limits = (tier) => ({
    seagrass: tier.seagrass,
    leafy: tier.shallow,
    kelpNear: tier.kelp[0],
    kelpFar: tier.kelp[1],
    algaeNear: tier.algae[0],
    algaeFar: tier.algae[1],
  });
  const placed = Object.fromEntries(Object.entries(all).map(([k, mesh]) => [k, mesh.count]));

  return {
    meshes: all,
    /** Which band each mesh belongs to (for showing and hiding by depth). */
    bands: { seagrass: 'seagrass', leafy: 'shallow', kelpNear: 'kelp', kelpFar: 'kelp', algaeNear: 'deepAlgae', algaeFar: 'deepAlgae' },
    setQuality(tier) {
      const n = limits(tier);
      for (const [k, mesh] of Object.entries(all)) {
        mesh.count = Math.min(placed[k], n[k]);
        mesh.boundingSphere = null; // recomputed for the instances now drawn
      }
    },
  };
}
