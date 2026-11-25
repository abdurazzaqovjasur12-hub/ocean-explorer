import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { QUALITY_LEVELS } from '@/config/quality';
import { depthToY } from '@/config/zones';
import { clamp, smoothstep } from '@/utils/math';

const SWIM_DEPTH = 1790; // metres: the middle of the whale chapter's drift
const BASE_Y = depthToY(SWIM_DEPTH);
const MAX_DUST = QUALITY_LEVELS.high.story.whale.dust;
const TAIL_X = -5.5; // where the flukes join the tail stock (whale space: +x is forward, +y up)

// The pass, in world space around the camera (which sits near x = 0, z = 0, looking down -z). Out of the fog
// ahead on the left, towards the camera, across in front of it at about 14 units, and on to the right, still
// side-on, into the fog. At this depth the fog hides anything beyond ~45 units and leaves ~80 % at 14, so the whale emerges
// slowly, is plainly there at its closest, and fades again as it leaves.
const SCALE = 1.35; // ~15.5 units long: at its closest it spans well over half the frame
const PATH = new THREE.CatmullRomCurve3(
  [
    [-30, 5, -62], [-20, 3, -40], [-10, 1.5, -22], [0, 0, -14],
    [12, -1, -15], [24, -2, -22], [36, -3.5, -34], [46, -5, -52],
  ].map(([x, y, z]) => new THREE.Vector3(x, BASE_Y + y, z)),
  false,
  'centripetal',
);

// ---------------------------------------------------------------------------------------------------------
// Geometry

/** A closed tube from a smooth profile: cross-sections are superellipses (round body, boxy head). */
function profileTube(keys, rings, sides) {
  // keys: [x, height radius, width radius, centre y, squareness]; Catmull-Rom between them, so the profile is smooth.
  const a = new THREE.CatmullRomCurve3(keys.map(([x, ry, rz]) => new THREE.Vector3(x, ry, rz)), false, 'centripetal');
  const b = new THREE.CatmullRomCurve3(keys.map(([x, , , cy, n]) => new THREE.Vector3(x, cy, n)), false, 'centripetal');
  const pos = [];
  const uv = [];
  const index = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    a.getPoint(t, p); // x, ry, rz
    b.getPoint(t, q); // x, cy, n
    const end = i === 0 || i === rings;
    const ry = end ? 0 : p.y;
    const rz = end ? 0 : p.z;
    const e = 2 / Math.max(2, q.z);
    for (let j = 0; j <= sides; j++) {
      const v = (j / sides) * Math.PI * 2;
      const s = Math.sin(v);
      const c = Math.cos(v);
      let y = Math.sign(s) * Math.pow(Math.abs(s), e) * ry;
      if (y < 0) y *= 0.9; // a slightly flatter belly
      pos.push(p.x, q.y + y, Math.sign(c) * Math.pow(Math.abs(c), e) * rz);
      uv.push(j / sides, t);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const k = i * (sides + 1) + j;
      const n = k + sides + 1;
      index.push(k, n, k + 1, k + 1, n, n + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** Sperm whale body: huge squarish head, lower jaw, small flippers, a dorsal hump and the knuckles behind it. */
function bodyGeometry({ rings, sides }) {
  const body = profileTube([
    [-5.65, 0.05, 0.03, 0.0, 2],
    [-5.25, 0.34, 0.13, 0.02, 2], // the tail stock: deep and narrow, it drives the stroke
    [-4.4, 0.56, 0.3, 0.05, 2],
    [-3.0, 0.8, 0.6, 0.06, 2],
    [-1.5, 0.95, 0.85, 0.04, 2],
    [0.0, 1.12, 0.98, 0.0, 2.1],
    [1.5, 1.2, 1.0, 0.04, 2.3],
    [3.0, 1.24, 0.96, 0.1, 2.8], // the head: boxier towards the front
    [4.4, 1.2, 0.88, 0.14, 3.0],
    [5.2, 1.06, 0.78, 0.16, 3.0],
    [5.55, 0.8, 0.6, 0.16, 2.6],
    [5.72, 0.3, 0.25, 0.16, 2.2],
    [5.75, 0.0, 0.0, 0.16, 2],
  ], rings, sides);

  // Dorsal hump and the row of knuckles towards the tail, raised out of the back.
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const top = Math.pow(Math.max(0, y) / (Math.abs(y) + Math.abs(z) + 1e-4), 4); // 1 along the spine
    const hump = 0.24 * Math.exp(-(((x + 2.2) / 0.55) ** 2));
    const knuckles = x < -2.8 && x > -4.6 ? 0.05 * Math.max(0, Math.sin((x + 2.8) * 9)) : 0;
    pos.setY(i, y + (hump + knuckles) * top);
  }

  const jaw = profileTube([
    [1.4, 0.03, 0.03, 0, 2],
    [2.0, 0.12, 0.16, 0, 2],
    [3.5, 0.13, 0.16, 0, 2],
    [4.8, 0.1, 0.12, 0, 2],
    [5.05, 0.05, 0.06, 0, 2],
  ], Math.round(rings / 3), Math.round(sides / 2));
  jaw.rotateZ(0.06);
  jaw.translate(0, -1.0, 0);

  const flipper = (side) => {
    const g = new THREE.SphereGeometry(1, 14, 8);
    g.scale(0.6, 0.06, 0.26);
    g.rotateY(side * 0.6);
    g.rotateX(side * -0.45);
    g.translate(2.0, -0.78, side * 0.98);
    g.deleteAttribute('normal'); // same attributes as the tubes; normals are rebuilt after the merge
    return g;
  };

  const parts = [body, jaw, flipper(1), flipper(-1)];
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** The flukes: broad, swept back, with the notch in the middle. Pivot at the tail stock. */
function flukeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.05, 0);
  s.bezierCurveTo(-0.2, 0.5, -0.85, 1.55, -1.7, 2.35); // leading edge out to the tip
  s.quadraticCurveTo(-1.25, 1.35, -1.55, 0.3); // trailing edge back towards the notch
  s.quadraticCurveTo(-1.45, 0.08, -1.35, 0);
  s.quadraticCurveTo(-1.45, -0.08, -1.55, -0.3);
  s.quadraticCurveTo(-1.25, -1.35, -1.7, -2.35);
  s.bezierCurveTo(-0.85, -1.55, -0.2, -0.5, 0.05, 0);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.04, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 14,
  });
  g.translate(0, 0, -0.02);
  g.rotateX(Math.PI / 2); // into the horizontal plane
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------
// Skin

const skinUniforms = () => ({
  uSwim: { value: 0 },
  uAmp: { value: 0.6 },
  uSway: { value: 0.06 },
  uViewUp: { value: new THREE.Vector3(0, 1, 0) },
  uDown: { value: new THREE.Color(0.22, 0.38, 0.56) }, // the last of the light, from above
  uRim: { value: new THREE.Color(0.12, 0.26, 0.38) },
  uWake: { value: 0 }, // glowing plankton lighting the belly from below
});

/**
 * Standard (lit) material with: the swimming bend (body only), countershading, wrinkled skin (procedural
 * bump), pale scars on the head, and three soft lights of its own (downwelling, rim, glow from the wake), so
 * the whale reads against black water without adding scene lights (which would recompile every material).
 */
function skinMaterial(uniforms, bend) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `
uniform float uSwim;
uniform float uAmp;
uniform float uSway;
varying vec3 vObj;
varying vec3 vObjN;
${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vObj = position;
vObjN = normal;
#if ${bend ? 1 : 0}
  // Up-and-down stroke: nothing at the head, growing to the tail stock. The head bobs a little against it.
  float tail = clamp((1.2 - position.x) / 6.8, 0.0, 1.0);
  float head = clamp((position.x - 1.5) / 4.0, 0.0, 1.0);
  transformed.y += sin(position.x * 0.45 + uSwim) * tail * tail * uAmp - sin(uSwim + 1.2) * head * 0.05 * uAmp;
  transformed.z += sin(uSwim * 0.5 + position.x * 0.25) * tail * tail * uSway; // a slow sideways sway
#endif`,
    );
    shader.fragmentShader = `
uniform vec3 uViewUp;
uniform vec3 uDown;
uniform vec3 uRim;
uniform float uWake;
varying vec3 vObj;
varying vec3 vObjN;
vec3 skinBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
${shader.fragmentShader}`
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Countershading: dark grey-brown back, paler belly; pale lips; old scars on the head.
float backness = smoothstep(-0.35, 0.45, normalize(vObjN).y);
vec3 skin = mix(vec3(0.3, 0.29, 0.28), vec3(0.15, 0.14, 0.135), backness);
float scars = smoothstep(0.9, 0.97, sin(vObj.x * 5.0 + vObj.z * 9.0 + sin(vObj.y * 6.0)) * sin(vObj.y * 11.0 + vObj.x * 2.3));
skin = mix(skin, vec3(0.5, 0.5, 0.48), scars * smoothstep(1.8, 3.0, vObj.x) * 0.7);
skin = mix(skin, vec3(0.62, 0.6, 0.56), smoothstep(-0.92, -1.02, vObj.y) * step(1.3, vObj.x));
diffuseColor.rgb *= skin;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
// Wrinkled skin: ridges running round the body, broken up; faded out with distance (no shimmering).
float warp = sin(vObj.y * 2.3 + vObj.z * 1.7) * 1.3 + sin(vObj.x * 1.7 + vObj.z * 3.1) * 0.8;
float h = sin(vObj.x * 9.0 + warp) * sin(vObj.x * 2.1 + vObj.y * 4.0 + 1.3) * 0.5  // broken, wandering ridges
        + sin(vObj.x * 27.0 + vObj.y * 9.0 + warp * 2.0) * 0.12;
float bumpFade = smoothstep(40.0, 10.0, length(vViewPosition));
normal = skinBump(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)) * 0.28 * bumpFade, faceDirection);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float up = dot(normal, uViewUp);
float facing = abs(dot(normal, normalize(vViewPosition)));
totalEmissiveRadiance += diffuseColor.rgb * uDown * smoothstep(-0.3, 1.0, up);             // downwelling light on the back
totalEmissiveRadiance += uRim * pow(1.0 - facing, 2.6) * (0.35 + 0.65 * smoothstep(-0.6, 1.0, up)); // rim, strongest along the top
totalEmissiveRadiance += vec3(0.05, 0.22, 0.24) * uWake * smoothstep(0.1, -1.0, up) * diffuseColor.rgb * 3.0; // wake glow on the belly`,
      );
  };
  material.customProgramCacheKey = () => `whale-skin-${bend ? 1 : 0}`;
  return material;
}

// ---------------------------------------------------------------------------------------------------------
// Wake: glowing plankton and drifting particles stirred up along the body and trailing behind

const dustVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float uFlow;
uniform float uTime;
uniform float uScale;
uniform float uGlow;
varying float vAlpha;
varying float vPlankton;

void main() {
  float life = fract(uFlow * (0.8 + 0.5 * aSeed.w) + aSeed.x);
  float x = mix(4.5, -17.0, life);                       // from the head back along the body and into the wake
  float r = (1.3 + 3.2 * life * life) * (0.75 + 0.5 * aSeed.y);
  float a = aSeed.z * 6.2832 + life * 1.8;
  vec3 p = vec3(x, sin(a) * r * 0.85, cos(a) * r);
  p += 0.35 * vec3(sin(uTime * 0.7 + aSeed.y * 20.0), cos(uTime * 0.5 + aSeed.z * 17.0), sin(uTime * 0.6 + aSeed.w * 13.0));
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(-mvPosition.z, 0.1);
  vPlankton = step(0.3, aSeed.w);                         // most of it glows; the rest is plain drifting matter
  float flicker = 0.6 + 0.4 * sin(uTime * 3.0 + aSeed.w * 40.0);
  vAlpha = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.25, 1.0, life)) * uGlow * mix(0.35, flicker, vPlankton);
  gl_PointSize = clamp((0.07 + 0.09 * aSeed.y) * uScale / dist, 1.0, 22.0);
  #include <fog_vertex>
}
`;

const dustFragment = /* glsl */ `
#include <fog_pars_fragment>
varying float vAlpha;
varying float vPlankton;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.5) * vAlpha;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(0.35, 0.45, 0.55), vec3(0.3, 0.95, 0.9), vPlankton) * a;
  #ifdef USE_FOG
    col *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth); // light fades to black in the fog
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function createDust(count) {
  const seeds = new Float32Array(MAX_DUST * 4);
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DUST * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.setDrawRange(0, Math.min(MAX_DUST, count));
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uFlow: { value: 0 }, uTime: { value: 0 }, uScale: { value: 400 }, uGlow: { value: 1 } },
  ]);
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  }));
  points.frustumCulled = false;
  points.renderOrder = 3;
  return { points, uniforms, setCount: (n) => geometry.setDrawRange(0, Math.min(MAX_DUST, n)) };
}

// ---------------------------------------------------------------------------------------------------------

/**
 * The whale encounter. A procedural sperm whale (smooth body with its own swimming bend, separate flukes that
 * beat with it), three draw calls in all: body, flukes, wake. Its journey along PATH is tied to the scroll
 * (`progress` 0..1 from the story timeline); the tail beat, the glide and the wake run on their own and speed
 * up when it moves faster. It emerges from the fog far ahead, passes in front of the camera and dissolves
 * into the fog again; the scene fog does the fading, so there is no pop. The camera turns to follow it
 * (`followYaw`, `followPitch`, smoothed), keeping it a little ahead of the centre of the frame.
 */
export function createWhale(scene, camera, settings) {
  const uniforms = skinUniforms();
  const detail = settings.story.whale;
  const group = new THREE.Group();
  group.rotation.order = 'YZX'; // heading, then nose up/down, then roll about the body
  group.scale.setScalar(SCALE);
  group.visible = false;

  const body = new THREE.Mesh(bodyGeometry(detail), skinMaterial(uniforms, true));
  body.frustumCulled = false; // the stroke bends the tail outside the bounding sphere
  const flukes = new THREE.Mesh(flukeGeometry(), skinMaterial(uniforms, false));
  const dust = createDust(detail.dust);
  group.add(body, flukes, dust.points);
  scene.add(group);

  const api = { mesh: group, glowing: [dust.points], followYaw: 0, followPitch: 0 };
  const tangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const last = new THREE.Vector3();
  let hasLast = false;
  let speed = 0;
  let swim = 0;
  let flow = 0;

  /** The body's stroke at x (whale space), the same formula as the vertex shader. */
  const tailAt = (x) => clamp((1.2 - x) / 6.8, 0, 1);
  const bendY = (x, amp) => Math.sin(x * 0.45 + swim) * tailAt(x) ** 2 * amp;
  const bendZ = (x) => Math.sin(swim * 0.5 + x * 0.25) * tailAt(x) ** 2 * uniforms.uSway.value;

  return Object.assign(api, {
    setQuality(next) {
      dust.setCount(next.story.whale.dust);
    },
    /** progress: 0..1 along the pass (scroll); meters: camera depth; under: 0..1 underwater. */
    update(dt, t, progress, meters, under, viewportHeight) {
      const p = clamp(progress, 0, 1);
      const inRange = meters > 1100 && meters < 2700 && under > 0.5;
      group.visible = inRange && p > 0.001 && p < 0.999;

      let yawTarget = 0;
      let pitchTarget = 0;
      if (group.visible) {
        PATH.getPointAt(p, group.position);
        PATH.getTangentAt(p, tangent);
        group.position.y += Math.sin(t * 0.17) * 0.35; // a slow glide on top of the path

        // Speed (units / s), smoothed: the stroke quickens and deepens when it travels faster.
        if (hasLast && dt > 0) speed += (group.position.distanceTo(last) / dt - speed) * Math.min(1, dt * 2);
        last.copy(group.position);
        hasLast = true;
        const effort = Math.min(1, speed / 25);
        swim += dt * (0.95 + 1.3 * effort); // a stroke every ~6 s when hanging still
        const amp = 0.5 + 0.3 * effort;
        uniforms.uSwim.value = swim;
        uniforms.uAmp.value = amp;

        // Face along the path; nose follows the climb, a slow roll as it glides.
        group.rotation.set(
          Math.sin(t * 0.21) * 0.06,
          Math.atan2(-tangent.z, tangent.x),
          Math.asin(clamp(tangent.y, -1, 1)) + Math.sin(swim + 1.2) * 0.015,
        );

        // Flukes ride on the end of the bending tail stock, angled with it and pitching a little further,
        // a beat behind (that is what makes the stroke look like it pushes water).
        const slope = (bendY(TAIL_X + 0.01, amp) - bendY(TAIL_X - 0.01, amp)) / 0.02;
        flukes.position.set(TAIL_X, bendY(TAIL_X, amp), bendZ(TAIL_X));
        flukes.rotation.set(0, 0, Math.atan(slope) * 1.25 - Math.cos(swim + TAIL_X * 0.45 - 0.7) * 0.18 * amp);

        // Wake: flows faster with speed; the glow is strongest while it is near the camera.
        flow += dt * (0.05 + 0.004 * Math.min(speed, 30));
        const near = smoothstep(0.1, 0.4, p) * (1 - smoothstep(0.6, 0.9, p));
        dust.uniforms.uFlow.value = flow;
        dust.uniforms.uTime.value = t;
        dust.uniforms.uScale.value = viewportHeight * 0.5;
        dust.uniforms.uGlow.value = 0.45 + 0.55 * near;
        uniforms.uWake.value = 0.6 * near;

        // Lights in view space for the skin shader.
        camera.updateMatrixWorld();
        uniforms.uViewUp.value.copy(up).transformDirection(camera.matrixWorldInverse);

        // Where the camera should look: towards the whale, but only part of the way, so it leads the frame.
        // A narrow (portrait) frame has less room to the side, so it follows more closely there.
        const dx = group.position.x - camera.position.x;
        const dy = group.position.y - camera.position.y;
        const dz = group.position.z - camera.position.z;
        const w = smoothstep(0.06, 0.3, p) * (1 - smoothstep(0.7, 0.94, p));
        const follow = camera.aspect < 1 ? 0.85 : 0.55;
        yawTarget = clamp(Math.atan2(-dx, -dz), -1.0, 1.0) * follow * w;
        pitchTarget = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.3, 0.3) * 0.5 * w;
      } else {
        hasLast = false;
      }
      // Ease the camera there (and back to straight ahead once it has gone): never a jump.
      const k = 1 - Math.exp(-dt * 1.6);
      api.followYaw += (yawTarget - api.followYaw) * k;
      api.followPitch += (pitchTarget - api.followPitch) * k;
    },
  });
}
