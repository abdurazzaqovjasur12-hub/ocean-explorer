import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { createRng } from '@/utils/random';
import { BANDS } from './bands';
import { reefPoint, reefNormal, sAtMeters, inView } from './shape';
import { reefMeters } from './glsl';

/*
 * The wall below 200 m: no plants (there is not enough light for them), but it is not dark either.
 *
 *   threads  a few long, fine glowing filaments standing out from the rock and waving in the current; light
 *            pulses up them from the root to a bead of light at the tip
 *   mats     spots and patches of light on the rock itself, each breathing at its own pace
 *
 * Both are pure emitted light (additive, no scene lights), the blue-green of deep-sea bioluminescence with the
 * odd violet. They only glow from 200 m down, stronger the darker the water around the camera (so at night
 * they show higher up), and fade out by the bottom of their band. Both are on the bloom layer.
 */
const MAX = QUALITY_LEVELS.high.story.reef;
const PALETTE = ['#3fd8ff', '#47a2ff', '#5ae8ff', '#38e6d2', '#4f8bff', '#a77bff'].map((h) => new THREE.Color(h));
const pick = (rng) => PALETTE[rng() < 0.08 ? 5 : Math.floor(rng() * 5)];

const zone = /* glsl */ `
${reefMeters}
float lumZone(float y) {
  float m = reefMetersAt(y);
  return smoothstep(${BANDS.luminous.from - 5}.0, ${BANDS.luminous.from + 90}.0, m) * (1.0 - smoothstep(${BANDS.luminous.to - 60}.0, ${BANDS.luminous.to + 80}.0, m));
}`;

const threadVertex = /* glsl */ `
attribute vec3 aTangent;
attribute float aSide;
attribute float aBend;
attribute float aStrand;
uniform float uTime;
uniform float uGlow;
uniform float uStir;
uniform float uScale;
varying float vLight;
varying float vSide;
varying vec3 vColor;
${zone}
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec3 root = m[3].xyz;
  vec4 wp = m * vec4(position, 1.0);
  vec3 tw = normalize(mat3(m) * aTangent);
  float ph = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832 + aStrand * 6.2832;
  float h = aBend;
  wp.x += sin(uTime * 0.45 + ph + h * 2.0) * 0.16 * h * h * (1.0 + uStir);
  wp.z += cos(uTime * 0.33 + ph * 1.3 + h * 1.6) * 0.1 * h * h;
  wp.y += sin(uTime * 0.27 + ph) * 0.04 * h;
  // A ribbon turned to face the camera, never thinner than about a pixel and a half (fainter instead).
  // uScale is half the drawing-buffer height; 0.554 = tan(half the vertical field of view), near enough.
  vec3 toCam = cameraPosition - wp.xyz;
  float dist = length(toCam);
  float w = max(0.012, 0.75 * 0.554 * dist / uScale) * (1.0 + 1.6 * smoothstep(0.85, 1.0, aBend));
  wp.xyz += normalize(cross(tw, toCam)) * aSide * w;
  gl_Position = projectionMatrix * viewMatrix * wp;
  float pulse = 0.5 + 0.5 * sin(uTime * (0.7 + aStrand * 0.6) + ph * 3.0 - h * 4.0);
  // Brightest at the very tip, where each thread ends in a bead of light.
  float tip = smoothstep(0.82, 1.0, h);
  vLight = lumZone(root.y) * uGlow * exp(-dist * 0.024) * (0.2 + 1.2 * h * h + 2.5 * tip) * (0.4 + 0.6 * pulse) * max(0.35, 0.012 / w);
  vSide = aSide;
#ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
#else
  vColor = vec3(0.25, 0.85, 1.0);
#endif
}`;

const threadFragment = /* glsl */ `
varying float vLight;
varying float vSide;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor * vLight * (1.0 - vSide * vSide) * 2.2, 1.0);
}`;

const matVertex = /* glsl */ `
attribute float aSize;
attribute float aSeed;
attribute vec3 aColor;
uniform float uTime;
uniform float uGlow;
uniform float uScale;
varying float vLight;
varying vec3 vColor;
${zone}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  float breathe = 0.5 + 0.5 * sin(uTime * (0.25 + aSeed * 0.9) + aSeed * 60.0);
  float flare = pow(max(0.0, sin(uTime * (0.09 + aSeed * 0.2) + aSeed * 31.0)), 24.0);
  vLight = lumZone(position.y) * uGlow * exp(-dist * 0.022) * (0.5 + 0.9 * breathe + 2.0 * flare) * smoothstep(0.5, 2.0, dist);
  vColor = aColor;
  gl_PointSize = clamp(aSize * uScale / max(dist, 0.1), 1.5, 40.0);
  gl_Position = projectionMatrix * mv;
}`;

const matFragment = /* glsl */ `
varying float vLight;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * (1.0 - d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor * vLight * a, 1.0);
}`;

/** A few glowing threads in unit space, rising from the root and gently wavy, each a camera-facing ribbon. */
function threadGeometry(strands = 4, segments = 9) {
  const rng = createRng(31);
  const pos = [];
  const tan = [];
  const side = [];
  const bend = [];
  const strand = [];
  const index = [];
  for (let i = 0; i < strands; i++) {
    const az = rng() * Math.PI * 2;
    const tilt = 0.05 + rng() * 0.3;
    const len = 0.8 + rng() * 0.6;
    const wave = 2 + rng() * 2;
    const seed = rng();
    const d = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const p = new THREE.Vector3(Math.cos(az) * 0.04, 0, Math.sin(az) * 0.04);
    const first = pos.length / 3;
    for (let k = 0; k <= segments; k++) {
      for (const sgn of [-1, 1]) {
        pos.push(p.x, p.y, p.z);
        tan.push(d.x, d.y, d.z);
        side.push(sgn);
        bend.push(k / segments);
        strand.push(seed);
      }
      p.addScaledVector(d, len / segments);
      d.y -= 0.05; // arching over a little
      d.x += Math.cos(az) * 0.03 + Math.sin(k * wave * 0.7) * 0.12 * Math.sin(az);
      d.z += Math.sin(az) * 0.03 - Math.sin(k * wave * 0.7) * 0.12 * Math.cos(az);
      d.normalize();
    }
    for (let k = 0; k < segments; k++) {
      const a = first + k * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTangent', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aBend', new THREE.Float32BufferAttribute(bend, 1));
  g.setAttribute('aStrand', new THREE.Float32BufferAttribute(strand, 1));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.2);
  return g;
}

/** Random spots on the wall within the luminous band, in view from the dive. */
function wallSpots(rng, count, { minUp = -0.6 } = {}) {
  const s0 = sAtMeters(BANDS.luminous.from);
  const s1 = sAtMeters(BANDS.luminous.to + 60);
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 60) {
    // Denser in the upper half of the band, where the camera spends longer near the wall.
    const s = s0 + (s1 - s0) * Math.pow(rng(), 1.3);
    const x = -75 + rng() * 90;
    const p = reefPoint(x, s);
    if (!inView(p)) continue;
    const n = reefNormal(x, s);
    if (n.y < minUp) continue;
    out.push({ p, n });
  }
  return out;
}

export function createLuminous(shared, tier, glow) {
  const rng = createRng(222);
  const uniforms = {
    uTime: shared.uTime,
    uStir: shared.uStir,
    uGlow: glow,
    uScale: { value: 400 },
  };
  const additive = (vertexShader, fragmentShader) => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Threads: one instanced tuft, standing out of the rock.
  const threadMat = additive(threadVertex, threadFragment);
  threadMat.side = THREE.DoubleSide;
  const threadSpots = wallSpots(rng, MAX.filaments);
  const threads = new THREE.InstancedMesh(threadGeometry(), threadMat, Math.max(1, threadSpots.length));
  const up = new THREE.Vector3(0, 1, 0);
  const d = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  threadSpots.forEach(({ p, n }, i) => {
    d.copy(up).lerp(n, 0.55).normalize();
    qa.setFromUnitVectors(up, d).multiply(qb.setFromAxisAngle(up, rng() * Math.PI * 2));
    const size = 0.8 + rng() * 1.4;
    threads.setMatrixAt(i, m4.compose(p, qa, sc.setScalar(size)));
    threads.setColorAt(i, pick(rng));
  });
  threads.count = threadSpots.length;
  threads.renderOrder = 3;
  const threadsPlaced = threads.count;

  // Mats: patches of small spots (a few to a dozen round a centre), and the odd larger single light.
  const total = MAX.spots;
  const positions = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const seeds = new Float32Array(total);
  const tints = new Float32Array(total * 3);
  const centres = wallSpots(rng, Math.ceil(total / 6));
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const p = new THREE.Vector3();
  let k = 0;
  // Patches are dealt round-robin so the first n spots of any tier are spread over the whole wall.
  const patches = centres.map((c) => ({ ...c, left: 1 + Math.floor(rng() * 11), color: pick(rng), r: 0.3 + rng() * 1.1 }));
  while (k < total && patches.some((c) => c.left > 0)) {
    for (const c of patches) {
      if (k >= total || c.left <= 0) continue;
      c.left--;
      t1.crossVectors(c.n, up);
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
      t1.normalize();
      t2.crossVectors(c.n, t1);
      const a = rng() * Math.PI * 2;
      const r = c.r * Math.sqrt(rng());
      p.copy(c.p).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).addScaledVector(c.n, 0.08);
      positions.set([p.x, p.y, p.z], k * 3);
      const big = rng() < 0.06;
      sizes[k] = big ? 0.35 + rng() * 0.3 : 0.07 + rng() * 0.12;
      seeds[k] = rng();
      const col = c.color;
      tints.set([col.r, col.g, col.b], k * 3);
      k++;
    }
  }
  const matGeo = new THREE.BufferGeometry();
  matGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  matGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  matGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  matGeo.setAttribute('aColor', new THREE.BufferAttribute(tints, 3));
  const matsPlaced = k;
  matGeo.setDrawRange(0, Math.min(matsPlaced, tier.spots));
  matGeo.computeBoundingSphere();
  const mats = new THREE.Points(matGeo, additive(matVertex, matFragment));
  mats.renderOrder = 3;

  function setQuality(next) {
    threads.count = Math.min(threadsPlaced, next.filaments);
    threads.boundingSphere = null;
    matGeo.setDrawRange(0, Math.min(matsPlaced, next.spots));
  }
  setQuality(tier);

  return {
    threads,
    mats,
    uniforms,
    setQuality,
  };
}
