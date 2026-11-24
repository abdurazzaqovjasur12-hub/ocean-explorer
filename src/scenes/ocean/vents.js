import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { QUALITY_LEVELS } from '@/config/quality';
import { depthToY } from '@/config/zones';
import { createRng } from '@/utils/random';
import { smoothstep } from '@/utils/math';
import { createSprite } from './particles';

const FLOOR_Y = depthToY(3110); // the crest of the ridge, a little below the vent chapter's camera
// Chimneys: [x, z, height, radius]. Ahead of and below the camera path (which runs down x = 0, z = 0).
const VENTS = [
  [-6, -20, 6.5, 0.9],
  [-1.5, -27, 8.5, 1.1],
  [4.5, -18, 4.6, 0.75],
  [9.5, -29, 7.2, 1.0],
  [-12, -31, 5.2, 0.8],
];
const MAX_SMOKE = QUALITY_LEVELS.high.story.smoke;
const MAX_WORMS = QUALITY_LEVELS.high.story.worms;
// The field stops short of the camera path, so the camera never passes through it on the way down.
const FIELD = { width: 96, near: -4, far: -74 };

/** A ridge running across the view: a rough crest that falls away steeply towards the camera and beyond. */
function floorHeight(x, z) {
  const off = Math.max(0, Math.abs(z + 26) - 14);
  return Math.sin(x * 0.35) * Math.cos(z * 0.29) * 0.9 + Math.sin(x * 1.3 + z * 0.7) * 0.25 + Math.sin(x * 0.11 - z * 0.17) * 1.6 - off * off * 0.12;
}
const ventTop = ([x, z, h]) => new THREE.Vector3(x, FLOOR_Y + floorHeight(x, z) + h, z);

const smokeVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute float aVent;
attribute float aPhase;
attribute float aSeed;
uniform vec3 uMouths[${VENTS.length}];
uniform float uTime;
uniform float uScale;
varying float vHeat;
varying float vAlpha;

void main() {
  vec3 m = uMouths[int(aVent + 0.5)];
  float life = fract(uTime * 0.075 * (0.8 + aSeed * 0.4) + aPhase);
  float spread = 0.2 + life * 2.4;
  vec3 p = m + vec3(
    cos(aSeed * 40.0 + life * 3.0) * spread * (0.4 + 0.6 * fract(aSeed * 7.3)),
    life * (13.0 + aSeed * 6.0),
    sin(aSeed * 23.0 + life * 2.0) * spread * (0.4 + 0.6 * fract(aSeed * 3.1))
  );
  p.x += life * life * 3.5; // the current bends the plume over
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min((1.0 + life * 5.5) * uScale / max(-mvPosition.z, 0.1), 160.0);
  vHeat = exp(-life * 10.0);
  vAlpha = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.45, 1.0, life));
  #include <fog_vertex>
}
`;

const smokeFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uSmoke;
uniform vec3 uHot;
uniform float uOpacity;
varying float vHeat;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(1.0 - smoothstep(0.0, 1.0, d), 2.2) * vAlpha * uOpacity; // soft puffs, no visible disc edge
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uSmoke, uHot, vHeat), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function chimneyGeometry(rng) {
  const parts = [];
  for (const vent of VENTS) {
    const [x, z, height, radius] = vent;
    const base = FLOOR_Y + floorHeight(x, z) - 1.2; // sunk into the floor: no gap at the foot
    const total = height + 1.2;
    const n = 5;
    let y = base;
    let r = radius * 1.5;
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < n; i++) {
      const h = (total / n) * (0.8 + rng() * 0.4);
      const top = i === n - 1 ? radius * 0.55 : r * (0.72 + rng() * 0.18);
      const g = new THREE.CylinderGeometry(top, r, h, 7, 1, false);
      const nx = ox + (rng() - 0.5) * 0.35;
      const nz = oz + (rng() - 0.5) * 0.35;
      g.translate(x + (ox + nx) / 2, y + h / 2, z + (oz + nz) / 2);
      // Heat: the upper part of the chimney glows faintly, the mouth most.
      const heat = new Float32Array(g.attributes.position.count);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) heat[k] = Math.pow(smoothstep(base, base + total, p.getY(k)), 6);
      g.setAttribute('aHeat', new THREE.BufferAttribute(heat, 1));
      parts.push(g.index ? g.toNonIndexed() : g);
      y += h * 0.92;
      r = top;
      ox = nx;
      oz = nz;
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

function floorGeometry(segments) {
  const depth = FIELD.near - FIELD.far;
  const g = new THREE.PlaneGeometry(FIELD.width, depth, segments, Math.round(segments * (depth / FIELD.width)));
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, (FIELD.near + FIELD.far) / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const basalt = new THREE.Color(0x2a2f33);
  const rust = new THREE.Color(0x6b4426);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, FLOOR_Y + floorHeight(x, z));
    // Mineral stains spread out around each vent.
    let stain = 0;
    for (const [vx, vz] of VENTS) stain = Math.max(stain, Math.exp(-Math.hypot(x - vx, z - vz) / 3.5));
    c.copy(basalt).lerp(rust, stain);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Tube worms: white tubes with blood-red plumes, in clumps around the chimney feet. One instanced mesh. */
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
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_WORMS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < MAX_WORMS; i++) {
    const [vx, vz, , vr] = VENTS[i % VENTS.length];
    const a = rng() * Math.PI * 2;
    const d = vr * 1.6 + rng() * 2.2;
    const x = vx + Math.cos(a) * d;
    const z = vz + Math.sin(a) * d;
    p.set(x, FLOOR_Y + floorHeight(x, z) - 0.05, z);
    e.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
    s.setScalar(0.7 + rng() * 0.9);
    mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * Hydrothermal vents on a ridge: mineral chimneys with glowing mouths, black smoke rising and bending in
 * the current, tube worms at their feet and a warm light that flickers on the rock. Only visible around
 * the vent chapter. The warm light is never removed or hidden (that would recompile every lit material);
 * its intensity drops to zero instead.
 */
export function createVents(scene, settings) {
  const rng = createRng(77);
  const group = new THREE.Group();
  group.visible = false;

  const floor = new THREE.Mesh(
    floorGeometry(settings.story.floor),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
  );
  group.add(floor);

  // Chimneys: dark sulphide rock whose upper part glows with the heat inside.
  const heatUniform = { value: 1 };
  const rock = new THREE.MeshStandardMaterial({ color: 0x23201d, roughness: 0.95, flatShading: true });
  rock.onBeforeCompile = (shader) => {
    shader.uniforms.uHeat = heatUniform;
    shader.vertexShader = `attribute float aHeat;\nvarying float vHeat;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvHeat = aHeat;',
    );
    shader.fragmentShader = `uniform float uHeat;\nvarying float vHeat;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.36, 0.08) * vHeat * uHeat * 1.6;',
    );
  };
  rock.customProgramCacheKey = () => 'vent-rock';
  group.add(new THREE.Mesh(chimneyGeometry(rng), rock));

  const worms = createWorms(rng);
  worms.count = settings.story.worms;
  group.add(worms);

  // Glowing mouths: soft additive sprites, one draw call.
  const mouths = VENTS.map(ventTop);
  const glowGeo = new THREE.BufferGeometry().setFromPoints(mouths);
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({
    size: 3.2,
    map: createSprite(),
    color: 0xff8a3d,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(glow);

  // Smoke: particles born at the mouths, rising, spreading and cooling from orange to grey.
  const vent = new Float32Array(MAX_SMOKE);
  const phase = new Float32Array(MAX_SMOKE);
  const seed = new Float32Array(MAX_SMOKE);
  for (let i = 0; i < MAX_SMOKE; i++) {
    vent[i] = i % VENTS.length;
    phase[i] = rng();
    seed[i] = rng();
  }
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SMOKE * 3), 3));
  smokeGeo.setAttribute('aVent', new THREE.BufferAttribute(vent, 1));
  smokeGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  smokeGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  smokeGeo.setDrawRange(0, settings.story.smoke);
  const smokeUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uMouths: { value: mouths },
      uTime: { value: 0 },
      uScale: { value: 400 },
      uSmoke: { value: new THREE.Color(0.075, 0.085, 0.1) },
      uHot: { value: new THREE.Color(1.0, 0.45, 0.15) },
      uOpacity: { value: 0.5 },
    },
  ]);
  const smoke = new THREE.Points(smokeGeo, new THREE.ShaderMaterial({
    vertexShader: smokeVertex,
    fragmentShader: smokeFragment,
    uniforms: smokeUniforms,
    transparent: true,
    depthWrite: false,
    fog: true,
  }));
  smoke.frustumCulled = false;
  smoke.renderOrder = 2;
  group.add(smoke);

  // Warm light from the vent field, lighting the rock, the worms and the smoke's roots.
  const light = new THREE.PointLight(0xff7a33, 0, 36, 2);
  light.position.set(0, FLOOR_Y + 3.5, -24);
  scene.add(light);
  scene.add(group);

  return {
    group,
    update(t, meters, viewportHeight) {
      const presence = smoothstep(2300, 2750, meters) * (1 - smoothstep(3150, 3250, meters));
      group.visible = presence > 0.001;
      light.intensity = group.visible ? presence * 85 * (0.88 + 0.12 * Math.sin(t * 7.3) * Math.sin(t * 2.1)) : 0;
      if (!group.visible) return;
      heatUniform.value = 0.85 + 0.15 * Math.sin(t * 5.1 + Math.sin(t * 1.7));
      smokeUniforms.uTime.value = t;
      smokeUniforms.uScale.value = viewportHeight * 0.5;
    },
    setQuality(next) {
      smokeGeo.setDrawRange(0, Math.min(MAX_SMOKE, next.story.smoke));
      worms.count = Math.min(MAX_WORMS, next.story.worms);
    },
  };
}
