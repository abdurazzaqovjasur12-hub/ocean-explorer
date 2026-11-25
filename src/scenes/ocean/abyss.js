import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { createRng } from '@/utils/random';
import { clamp, lerp, smoothstep } from '@/utils/math';

/*
 * The abyss (~10,000 m, the bottom of the Challenger Deep). Atmosphere over objects:
 *
 *   beam      the submersible's floodlight: a soft volumetric cone from just below and right of the lens,
 *             sweeping slowly, with particulate drifting through it
 *   motes     sparse specks around the camera, visible mostly where the beam catches them
 *   debris    a few tumbling flakes of sinking matter, lit by the explorer's lamp
 *   light     far away and below, a cold glow of unknown origin: a soft halo with slowly turning rays
 *   giant     a vast manta-like ray gliding across in front of that light: a dark silhouette, never close
 *
 * The water colour and the heavy fog come from the scene (depthPalette.js). Five draw calls, all animated on
 * the GPU except a handful of debris matrices, and all hidden above the hadal depths. Nothing jumps out:
 * the silhouette is distant, slow and only ever seen against the light.
 */

const MAX = QUALITY_LEVELS.high.story.abyss;
const BEAM = { length: 34, radius: 6, offset: new THREE.Vector3(1.8, 0.9, 0.6) }; // a lamp up on the right of the hull

const glslNoise = /* glsl */ `
float ah12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float an(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ah12(i), ah12(i + vec2(1.0, 0.0)), u.x), mix(ah12(i + vec2(0.0, 1.0)), ah12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// ---------------------------------------------------------------------------------------------------------
// The distant light: a camera-facing quad with a halo and slowly turning rays.

const lightVertex = /* glsl */ `
uniform vec3 uCentre;
uniform float uSize;
varying vec2 vUv;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = uCentre + (right * position.x + up * position.y) * uSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vUv = uv;
}
`;
const lightFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
${glslNoise}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float edge = 1.0 - smoothstep(0.45, 1.0, r);                     // nothing left at the quad's edge: no visible disc
  float core = exp(-r * r * 160.0);
  float halo = exp(-r * 4.2) * edge;
  // Rays: angular noise (periodic, no seam), turning very slowly, fading outwards.
  vec2 dir = p / max(r, 1e-3);
  float rays = 0.0;
  float amp = 0.6;
  vec2 q = dir * 2.6 + vec2(uTime * 0.012, -uTime * 0.009);
  for (int i = 0; i < RAY_OCTAVES; i++) { rays += amp * an(q); q = q * 2.1 + 5.3; amp *= 0.5; }
  rays = pow(clamp(rays, 0.0, 1.0), 3.0) * exp(-r * 2.6) * smoothstep(0.03, 0.25, r) * edge;
  float breathe = 0.88 + 0.12 * sin(uTime * 0.21) * sin(uTime * 0.13 + 1.0);
  vec3 col = uColor * (core * 1.1 + halo * 0.26 + rays * 0.45) * uIntensity * breathe;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------------------
// The floodlight beam: a cone whose brightness stands in for the light scattered along each view ray.

const beamVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAlong;
void main() {
  vAlong = -position.z;                                 // 0 at the lamp .. 1 at the far end (cone built along -z)
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const beamFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uOrigin;
uniform vec3 uDir;
uniform float uLength;
uniform float uRadius;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAlong;
${glslNoise}
void main() {
  // The cone is only where the light is drawn. Its brightness comes from where this view ray passes closest
  // to the beam's axis, against the beam's radius there: a soft round profile, with no hard edges from the
  // cone's surface.
  vec3 rd = normalize(vWorld - cameraPosition);
  vec3 w0 = cameraPosition - uOrigin;
  float b = dot(rd, uDir);
  float d = dot(rd, w0);
  float e = dot(uDir, w0);
  float denom = max(1.0 - b * b, 1e-4);
  float sRay = (b * e - d) / denom;
  float tAxis = clamp((e - b * d) / denom, 0.0, uLength);
  float miss = length(w0 + rd * max(sRay, 0.0) - uDir * tAxis);
  float along = tAxis / uLength;
  float coneR = max(uRadius * along, 0.15);
  float profile = exp(-pow(miss / coneR, 2.0) * 3.0);
  float fall = pow(1.0 - along, 1.7) * smoothstep(0.0, 0.08, along);
  fall *= smoothstep(1.5, 9.0, max(sRay, 0.0));                    // fades out close to the lens
  float dust = 0.75 + 0.5 * an(vec2(along * 9.0 - uTime * 0.25, miss * 0.8 + uTime * 0.05));
  vec3 col = vec3(0.78, 0.88, 1.0) * profile * fall * dust * uIntensity * 0.5; // front and back faces both add
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------------------
// Motes: specks around the camera, lit where the beam passes.

const moteVertex = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uScale;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uOrigin;
uniform vec3 uDir;
uniform float uLength;
uniform float uRadius;
varying float vLit;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.07 + aSeed.x * 30.0) * 0.6, -uTime * (0.03 + 0.04 * aSeed.y), cos(uTime * 0.06 + aSeed.z * 20.0) * 0.6);
  vec3 c = uCam + vec3(0.0, 0.0, -uBox.z * 0.3);
  vec3 rel = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(e.x, max(e.y, e.z)));
  vec3 w = c + rel;
  // In the beam? Distance along it and from its axis, against the cone's radius there.
  vec3 d = w - uOrigin;
  float t = dot(d, uDir);
  float radial = length(d - uDir * t);
  float coneR = max(uRadius * t / uLength, 0.05);
  float inBeam = step(0.0, t) * (1.0 - smoothstep(coneR * 0.55, coneR, radial)) * pow(1.0 - clamp(t / uLength, 0.0, 1.0), 1.3);
  float nearLamp = exp(-length(w - uCam) / 5.0);
  vLit = edge * (0.05 + inBeam * 1.2 + nearLamp * 0.35) * (0.5 + 0.5 * aSeed.w);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.035 + 0.05 * aSeed.y) * uScale / max(-mv.z, 0.1), 1.0, 7.0);
}
`;
const moteFragment = /* glsl */ `
varying float vLit;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * vLit;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.8, 0.88, 1.0) * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------------------
// The giant: a manta-like ray, a vast dark shape gliding in front of the distant light.

function mantaGeometry(spanSegs, chordSegs) {
  // Planform: u across the span (-1..1), v from leading to trailing edge. Swept, pointed wings; a long thin tail.
  const pos = [];
  const index = [];
  const row = spanSegs + 1;
  for (let j = 0; j <= chordSegs; j++) {
    const v = j / chordSegs;
    for (let i = 0; i <= spanSegs; i++) {
      const u = (i / spanSegs) * 2 - 1;
      const a = Math.abs(u);
      const lead = 0.55 - Math.pow(a, 1.25) * 0.75;                        // leading edge, swept back
      const chord = 1.0 * Math.pow(1 - Math.pow(a, 1.7), 0.9) + 0.04;     // narrowing to the wing tips
      const z = lead - chord * v;
      const y = 0.09 * (1 - smoothstep(0, 0.35, a)) * Math.sin(Math.PI * v); // the body's low hump
      pos.push(u * 1.0, y, z);
    }
  }
  for (let j = 0; j < chordSegs; j++) {
    for (let i = 0; i < spanSegs; i++) {
      const k = j * row + i;
      index.push(k, k + row, k + 1, k + 1, k + row, k + row + 1);
    }
  }
  // Tail: a thin tapering strip behind the body.
  const base = pos.length / 3;
  const tailSegs = 10;
  for (let s = 0; s <= tailSegs; s++) {
    const t = s / tailSegs;
    const w = 0.025 * (1 - t) + 0.004;
    const z = -0.45 - t * 0.9;
    pos.push(-w, 0, z, w, 0, z);
    if (s < tailSegs) {
      const k = base + s * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const mantaVertex = /* glsl */ `
#include <fog_pars_vertex>
uniform float uFlap;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 p = position;
  float a = abs(p.x);
  // The wingbeat: a slow wave travelling out along each wing, and a little down the tail.
  p.y += sin(uFlap - a * 2.4) * pow(a, 1.5) * 0.26;
  p.y += sin(uFlap * 1.3 + p.z * 4.0) * smoothstep(-0.45, -1.35, p.z) * 0.05;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mvPosition.xyz);
  #include <fog_vertex>
}
`;
const mantaFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uRimColor;
uniform float uPresence;
varying vec3 vN;
varying vec3 vV;
void main() {
  // Darker than the water around it, so it always reads as a shape, with the faintest rim from the light behind.
  vec3 col = fogColor * 0.35;
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  col += uRimColor * rim * 0.25;
  col = mix(fogColor, col, uPresence);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------------------

export function createAbyss(scene, camera, settings) {
  const rng = createRng(404);
  const tier = settings.story.abyss;
  const group = new THREE.Group();
  group.visible = false;
  const time = { value: 0 };

  // Distant light.
  const lightUniforms = {
    uTime: time,
    uIntensity: { value: 0 },
    uColor: { value: new THREE.Color(0.22, 0.55, 0.78) },
    uCentre: { value: new THREE.Vector3() },
    uSize: { value: 70 },
  };
  const light = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: lightVertex,
    fragmentShader: lightFragment,
    uniforms: lightUniforms,
    defines: { RAY_OCTAVES: tier.rays },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  light.frustumCulled = false;
  light.renderOrder = 1;

  // The giant, in front of the light. Opaque, so it hides the light behind it.
  const mantaUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uFlap: { value: 0 },
    uRimColor: { value: lightUniforms.uColor.value.clone() },
    uPresence: { value: 1 },
  }]);
  const manta = new THREE.Mesh(mantaGeometry(tier.manta[0], tier.manta[1]), new THREE.ShaderMaterial({
    vertexShader: mantaVertex,
    fragmentShader: mantaFragment,
    uniforms: mantaUniforms,
    side: THREE.DoubleSide,
    fog: true,
  }));
  manta.frustumCulled = false;
  manta.rotation.order = 'YXZ';
  manta.scale.setScalar(16); // ~32 units across the wings

  // Floodlight.
  const cone = new THREE.ConeGeometry(1, 1, 28, 8, true);
  cone.translate(0, -0.5, 0); // apex at the origin
  cone.rotateX(Math.PI / 2); // pointing down -z
  const beamDir = new THREE.Vector3();
  const beamOrigin = new THREE.Vector3();
  const beamUniforms = {
    uTime: time,
    uIntensity: { value: 0 },
    uOrigin: { value: beamOrigin },
    uDir: { value: beamDir },
    uLength: { value: BEAM.length },
    uRadius: { value: BEAM.radius },
  };
  const beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: beamUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }));
  beam.frustumCulled = false;
  beam.renderOrder = 4;
  beam.scale.set(BEAM.radius, BEAM.radius, BEAM.length);

  // Motes.
  const box = new THREE.Vector3(36, 26, 46);
  const motePos = new Float32Array(MAX.motes * 3);
  const moteSeed = new Float32Array(MAX.motes * 4);
  for (let i = 0; i < MAX.motes; i++) {
    motePos.set([(rng() - 0.5) * box.x, (rng() - 0.5) * box.y, (rng() - 0.5) * box.z], i * 3);
    moteSeed.set([rng(), rng(), rng(), rng()], i * 4);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(moteSeed, 4));
  moteGeo.setDrawRange(0, Math.min(MAX.motes, tier.motes));
  const moteUniforms = {
    uTime: time,
    uScale: { value: 400 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: box },
    uOrigin: { value: beamOrigin },
    uDir: { value: beamDir },
    uLength: { value: BEAM.length },
    uRadius: { value: BEAM.radius },
  };
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({
    vertexShader: moteVertex,
    fragmentShader: moteFragment,
    uniforms: moteUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  motes.frustumCulled = false;
  motes.renderOrder = 3;

  // Debris: a few flakes of sinking matter, tumbling slowly around the camera, lit by the lamp.
  const flake = new THREE.IcosahedronGeometry(1, 0);
  flake.scale(1, 0.25, 0.7);
  const debris = new THREE.InstancedMesh(flake, new THREE.MeshStandardMaterial({ color: 0x5d6670, roughness: 0.9, flatShading: true }), MAX.debris);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debris.frustumCulled = false;
  const flakes = Array.from({ length: MAX.debris }, () => ({
    p: new THREE.Vector3((rng() - 0.5) * 24, (rng() - 0.5) * 16, -2 - rng() * 22),
    r: new THREE.Euler(rng() * 6, rng() * 6, rng() * 6),
    spin: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.5),
    size: 0.05 + Math.pow(rng(), 2) * 0.2,
    sink: 0.05 + rng() * 0.08,
  }));
  debris.count = Math.min(MAX.debris, tier.debris);

  group.add(light, manta, beam, motes, debris);
  scene.add(group);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const aim = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const local = new THREE.Vector3();
  let flap = 0;

  return {
    group,
    glowing: [light],
    setQuality(next) {
      const a = next.story.abyss;
      moteGeo.setDrawRange(0, Math.min(MAX.motes, a.motes));
      debris.count = Math.min(MAX.debris, a.debris);
      if (light.material.defines.RAY_OCTAVES !== a.rays) {
        light.material.defines.RAY_OCTAVES = a.rays;
        light.material.needsUpdate = true;
      }
    },
    /** progress: 0..1 through the abyss chapter (scroll); baseY: the camera's height without its wobble. */
    update(dt, t, meters, under, progress, baseY, viewportHeight) {
      const presence = smoothstep(8200, 9600, meters) * under;
      group.visible = presence > 0.003;
      if (!group.visible) return;
      time.value = t;
      const p = clamp(progress, 0, 1);

      // Distant light: far ahead, below the camera's level, drifting a touch with the scroll.
      lightUniforms.uCentre.value.set(-8 + p * 6, baseY - 14 - p * 3, -125);
      lightUniforms.uIntensity.value = presence * 0.5;

      // The giant crosses in front of the light, banking so its wings show, wings beating slowly.
      flap += dt * 0.55;
      mantaUniforms.uFlap.value = flap;
      const x = lerp(-95, 80, p) + Math.sin(t * 0.05) * 2;
      manta.position.set(x, baseY - 10 + Math.sin(p * Math.PI) * 4 + Math.sin(t * 0.09) * 0.8, -88 + Math.sin(p * Math.PI) * 6);
      manta.rotation.set(0.35 + Math.sin(t * 0.07) * 0.04, Math.PI / 2 - 0.15 * Math.cos(p * Math.PI), 0.55 + Math.sin(t * 0.11) * 0.05);
      mantaUniforms.uPresence.value = presence;

      // Floodlight: just below and right of the lens, aimed ahead and slightly down, sweeping slowly.
      local.copy(BEAM.offset).applyQuaternion(camera.quaternion);
      beam.position.copy(camera.position).add(local);
      e.set(-0.2 + Math.sin(t * 0.083) * 0.05, 0.12 + Math.sin(t * 0.061) * 0.12, 0); // ahead, down and across to the left
      aim.setFromEuler(e);
      beam.quaternion.copy(camera.quaternion).multiply(aim);
      beamUniforms.uIntensity.value = presence * 0.14;
      beamOrigin.copy(beam.position);
      beamDir.set(0, 0, -1).applyQuaternion(beam.quaternion);

      moteUniforms.uCam.value.copy(camera.position);
      moteUniforms.uScale.value = viewportHeight * 0.5;

      // Debris: sink, tumble, and wrap around the camera (a dozen or so matrices).
      for (let i = 0; i < debris.count; i++) {
        const f = flakes[i];
        f.p.y -= f.sink * dt;
        f.r.x += f.spin.x * dt;
        f.r.y += f.spin.y * dt;
        f.r.z += f.spin.z * dt;
        const rel = f.p;
        if (rel.y < -8) rel.y += 16;
        s3.set(camera.position.x + rel.x, camera.position.y + rel.y, camera.position.z + rel.z);
        q.setFromEuler(f.r);
        debris.setMatrixAt(i, m4.compose(s3, q, local.setScalar(f.size)));
      }
      debris.instanceMatrix.needsUpdate = true;
    },
  };
}
