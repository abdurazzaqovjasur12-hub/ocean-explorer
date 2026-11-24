import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { depthToY } from '@/config/zones';
import { createRng } from '@/utils/random';
import { smoothstep } from '@/utils/math';

const MAX_JELLIES = QUALITY_LEVELS.high.story.jellies;
const ORAL_ARMS = 4;
const COLORS = [
  new THREE.Color(0.25, 0.9, 1.0), // cyan
  new THREE.Color(0.68, 0.45, 1.0), // violet
  new THREE.Color(0.3, 0.52, 1.0), // blue
];
// Where they drift: around the bioluminescence chapter (850 -> 1000 m), at many distances from the camera.
const DEPTHS = [820, 1100];
const TOUCH_LINGER = 1.2; // seconds a touch keeps "pointing" after the finger lifts
const REACH = 3.2; // scene units: how close the cursor ray has to pass for a jellyfish to notice

/** The swim stroke, shared by the CPU (thrust) and the GPU (bell shape): a quick squeeze, a slow relax. */
const contraction = (clock) => {
  const p = clock - Math.floor(clock);
  return smoothstep(0, 0.18, p) * (1 - smoothstep(0.18, 0.95, p));
};

const glsl = {
  contraction: /* glsl */ `
float contraction(float clock) {
  float p = fract(clock);
  return smoothstep(0.0, 0.18, p) * (1.0 - smoothstep(0.18, 0.95, p));
}`,
  // Additive light should fade to black in the fog, not to the fog colour.
  fog: /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    col *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    col *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif`,
};

const bellVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute float aClock;   // per jellyfish: its own swim clock (speeds up when startled)
attribute float aPhase;
attribute float aExcite;
attribute vec3 aColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec2 vUv;
varying float vY;
varying vec3 vColor;
varying float vExcite;
varying float vPulse;
varying float vPhase;
uniform float uTime;
${glsl.contraction}

void main() {
  float c = contraction(aClock);
  vec3 p = position;
  float rimW = 1.0 - smoothstep(-0.2, 0.5, p.y);      // the rim moves, the crown barely
  float squeeze = 1.0 - 0.22 * c * rimW;
  float ang = atan(p.z, p.x);
  squeeze *= 1.0 + 0.035 * rimW * sin(ang * 8.0 + uTime * 1.6 + aPhase * 6.2832); // soft ripple round the edge
  p.xz *= squeeze;
  p.y *= 1.0 + 0.1 * c;
  vec3 n = normal;
  n.xz /= max(squeeze, 0.5);

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vNormalV = normalize(normalMatrix * (mat3(instanceMatrix) * normalize(n)));
  vViewDir = normalize(-mvPosition.xyz);
  vUv = uv;
  vY = position.y;
  vColor = aColor;
  vExcite = aExcite;
  vPulse = c;
  vPhase = aPhase;
  #include <fog_vertex>
}
`;

const bellFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform float uPresence;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec2 vUv;
varying float vY;
varying vec3 vColor;
varying float vExcite;
varying float vPulse;
varying float vPhase;

void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float rim = pow(1.0 - facing, 2.2);                                    // glassy edges, clear middle
  float canals = pow(abs(sin(vUv.x * 3.14159 * 8.0)), 28.0) * smoothstep(0.55, -0.1, vY);
  float gonads = exp(-pow((vY - 0.26) * 9.0, 2.0)) * (0.5 + 0.5 * sin(vUv.x * 6.2832 * 4.0));
  float sweep = exp(-pow((vY - mix(0.62, -0.25, fract(uTime * 0.21 + vPhase))) * 7.0, 2.0)); // light running crown -> rim
  float edge = smoothstep(-0.04, -0.2, vY);
  float breathe = 0.5 + 0.5 * sin(uTime * 0.8 + vPhase * 6.2832);      // the slow glow pulse

  float I = 0.03 + rim * 0.95 + canals * 0.22 + gonads * 0.32 + sweep * 0.4 * breathe + edge * 0.45;
  I *= (0.45 + 0.55 * breathe + 0.4 * vPulse) * (1.0 + vExcite * 0.9);
  vec3 col = vColor * I * uPresence * 0.36;
  ${glsl.fog}
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const tentacleVertex = /* glsl */ `
#include <fog_pars_vertex>
attribute float aS;      // 0 at the bell .. 1 at the tip
attribute float aSide;   // -1 / 1: the two edges of the ribbon
attribute float aAngle;  // where on the rim it hangs from
attribute float aKind;   // 0 tentacle, 1 oral arm
attribute float aSeed;
attribute float aClock;
attribute float aPhase;
attribute float aExcite;
attribute vec3 aColor;
uniform float uTime;
varying float vAlong;
varying float vAcross;
varying float vThin;
varying float vKind;
varying float vPhase;
varying float vExcite;
varying vec3 vColor;
${glsl.contraction}

// The whole tentacle is an analytic curve of (s, time): no simulation, nothing on the CPU.
vec3 tentacle(float s) {
  float sc = max(s, 0.0);
  float c = contraction(aClock - sc * 0.45);                // the stroke ripples down behind the bell
  float rimR = mix(0.9, 0.22, aKind) * (1.0 - 0.2 * c * (1.0 - aKind));
  float len = mix(3.4, 1.5, aKind) * (0.7 + 0.6 * aSeed);
  vec3 p = vec3(cos(aAngle) * rimR, mix(-0.17, -0.08, aKind), sin(aAngle) * rimR);
  p.xz *= 1.0 - sc * mix(0.35, 0.05, aKind);                 // drawn in towards the axis
  p.y -= sc * len;
  float sw = pow(sc, 1.4);
  float ph = aPhase * 6.2832 + aSeed * 12.0;
  p.x += (sin(sc * 3.2 - uTime * 0.9 + ph) * 0.35 + sin(sc * 7.0 - uTime * 1.7 + ph * 2.0) * 0.06) * sw;
  p.z += (cos(sc * 2.7 - uTime * 0.75 + ph * 1.3) * 0.35 + cos(sc * 6.0 - uTime * 1.4 + ph) * 0.05) * sw;
  p.xz *= 1.0 + 0.28 * c * sc;                               // flare out with the stroke
  float twist = aAngle + sc * 4.0 + uTime * 0.3;             // oral arms curl round each other
  p.xz += vec2(cos(twist), sin(twist)) * 0.16 * sc * aKind;
  return p;
}

void main() {
  vec3 p = tentacle(aS);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec3 a = (modelMatrix * instanceMatrix * vec4(tentacle(aS - 0.015), 1.0)).xyz;
  vec3 b = (modelMatrix * instanceMatrix * vec4(tentacle(aS + 0.015), 1.0)).xyz;
  vec3 tangent = normalize(b - a);
  vec3 toCam = cameraPosition - w.xyz;
  float dist = length(toCam);
  vec3 side = normalize(cross(tangent, toCam / dist));        // a ribbon that always faces the camera

  float scale = length(instanceMatrix[0].xyz);
  float width = mix(0.02, 0.075, aKind) * (1.0 - 0.75 * aS) * scale;
  float minWidth = dist * 0.0016;                              // never thinner than about a pixel...
  float used = max(width, minWidth);
  w.xyz += side * aSide * used;

  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  vAlong = aS;
  vAcross = aSide;
  vThin = width / used;                                       // ...but fainter instead, so it doesn't shimmer
  vKind = aKind;
  vPhase = aPhase;
  vExcite = aExcite;
  vColor = aColor;
  #include <fog_vertex>
}
`;

const tentacleFragment = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform float uPresence;
varying float vAlong;
varying float vAcross;
varying float vThin;
varying float vKind;
varying float vPhase;
varying float vExcite;
varying vec3 vColor;

void main() {
  float core = 1.0 - abs(vAcross);
  core *= core;
  float runner = exp(-pow((vAlong - fract(uTime * 0.32 + vPhase)) * 9.0, 2.0)); // beads of light running down
  float I = core * (0.32 + 0.9 * runner) * (1.0 - vAlong * 0.65) * mix(0.55, 0.85, vKind);
  I *= vThin * (1.0 + vExcite * 0.9);
  vec3 col = mix(vColor, vec3(0.85, 0.95, 1.0), 0.25 * runner) * I * uPresence * 0.6;
  ${glsl.fog}
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A soft dome with a rim that curls in: one lathe, shared by every jellyfish. */
function bellGeometry() {
  const profile = [
    [0, 0.55], [0.22, 0.535], [0.45, 0.47], [0.64, 0.36], [0.8, 0.21], [0.91, 0.05], [0.98, -0.09], [1.0, -0.16], [0.95, -0.2],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const curve = new THREE.SplineCurve(profile);
  return new THREE.LatheGeometry(curve.getPoints(16), 36);
}

/** Every tentacle and oral arm of one jellyfish as camera-facing ribbons; the shader shapes them. */
function tentacleGeometry(tentacles, segments, rng) {
  const strands = tentacles + ORAL_ARMS;
  const verts = strands * (segments + 1) * 2;
  const s = new Float32Array(verts);
  const side = new Float32Array(verts);
  const angle = new Float32Array(verts);
  const kind = new Float32Array(verts);
  const seed = new Float32Array(verts);
  const index = [];
  let v = 0;
  for (let k = 0; k < strands; k++) {
    const oral = k >= tentacles;
    const a = oral ? ((k - tentacles) / ORAL_ARMS) * Math.PI * 2 + 0.4 : (k / tentacles) * Math.PI * 2 + (rng() - 0.5) * 0.2;
    const sd = rng();
    for (let i = 0; i <= segments; i++) {
      for (const e of [-1, 1]) {
        s[v] = i / segments;
        side[v] = e;
        angle[v] = a;
        kind[v] = oral ? 1 : 0;
        seed[v] = sd;
        v++;
      }
      if (i < segments) {
        const base = v - 2;
        index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3)); // unused, the shader builds positions
  g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setIndex(index);
  return g;
}

function material(vertexShader, fragmentShader, uniforms, side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    fog: true,
  });
}

/**
 * Glowing jellyfish for the bioluminescence chapter: instanced, so every bell is one draw call and every
 * tentacle another, whatever the count. Bells squeeze and relax (the stroke pushes them upwards), light
 * sweeps from crown to rim and beads run down the tentacles, which ripple with the stroke and the current.
 * They drift at many distances, tilt as they move, and shy away (and flare) when the cursor or a finger
 * comes near. Hidden outside the twilight zone.
 */
export function createJellyfish(scene, camera, settings, { pointerTarget = window } = {}) {
  const rng = createRng(91);
  const uniforms = { uTime: { value: 0 }, uPresence: { value: 0 } };
  const bellMat = material(bellVertex, bellFragment, uniforms, THREE.DoubleSide);
  const tentMat = material(tentacleVertex, tentacleFragment, uniforms, THREE.DoubleSide);
  // UniformsUtils.merge clones: point both materials at the same time and presence.
  for (const m of [bellMat, tentMat]) {
    m.uniforms.uTime = uniforms.uTime;
    m.uniforms.uPresence = uniforms.uPresence;
  }

  // Per-jellyfish attributes, shared by the bell and the tentacles.
  const clock = new THREE.InstancedBufferAttribute(new Float32Array(MAX_JELLIES), 1).setUsage(THREE.DynamicDrawUsage);
  const excite = new THREE.InstancedBufferAttribute(new Float32Array(MAX_JELLIES), 1).setUsage(THREE.DynamicDrawUsage);
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(MAX_JELLIES), 1);
  const color = new THREE.InstancedBufferAttribute(new Float32Array(MAX_JELLIES * 3), 3);

  const jellies = [];
  for (let i = 0; i < MAX_JELLIES; i++) {
    // The first few are near; later ones fill the distance (so lower tiers keep a range of distances).
    const near = i % 3 === 0;
    const z = near ? -(7 + rng() * 6) : -(12 + rng() * 26);
    const sideSign = i % 2 ? -1 : 1; // alternate sides so they never bunch up on one
    const y = depthToY(DEPTHS[0] + rng() * (DEPTHS[1] - DEPTHS[0]));
    const j = {
      // Sideways position as a fraction of the visible half-width at its distance, so portrait phones and
      // wide screens both get a full frame (and the middle, where the camera travels, stays clear).
      u: sideSign * (0.2 + rng() * 0.72),
      home: new THREE.Vector3(0, y, z),
      pos: new THREE.Vector3(0, y, z),
      vel: new THREE.Vector3(),
      scale: (near ? 0.75 + rng() * 0.45 : 1.0 + rng() * 1.1),
      rate: 0.32 + rng() * 0.2, // strokes per second
      clock: rng(),
      ph: rng(),
      spin: (rng() - 0.5) * 0.12,
      yaw: rng() * Math.PI * 2,
      excite: 0,
    };
    jellies.push(j);
    phase.setX(i, j.ph);
    const c = COLORS[i % COLORS.length];
    color.setXYZ(i, c.r, c.g, c.b);
  }

  const bellGeo = bellGeometry();
  let tentGeo = null;
  const bells = new THREE.InstancedMesh(bellGeo, bellMat, MAX_JELLIES);
  const tentacles = new THREE.InstancedMesh(new THREE.BufferGeometry(), tentMat, MAX_JELLIES);
  tentacles.instanceMatrix = bells.instanceMatrix; // same transforms, uploaded once
  bells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (const [name, attr] of Object.entries({ aClock: clock, aExcite: excite, aPhase: phase, aColor: color })) bellGeo.setAttribute(name, attr);

  function buildTentacles(next) {
    tentGeo?.dispose();
    tentGeo = tentacleGeometry(next.story.tentacles, next.story.segments, createRng(13));
    for (const [name, attr] of Object.entries({ aClock: clock, aExcite: excite, aPhase: phase, aColor: color })) tentGeo.setAttribute(name, attr);
    tentacles.geometry = tentGeo;
  }
  function setCount(n) {
    bells.count = tentacles.count = Math.min(MAX_JELLIES, n);
  }
  buildTentacles(settings);
  setCount(settings.story.jellies);

  for (const m of [bells, tentacles]) {
    m.frustumCulled = false; // shapes come from the vertex shader
    m.renderOrder = 3;
  }
  tentacles.renderOrder = 2; // behind the bells' glassy shell
  const group = new THREE.Group();
  group.add(tentacles, bells);
  scene.add(group);

  // ---- cursor / touch: a ray from the camera through the pointer ----
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const pointer = { active: false, touch: false, until: 0, now: 0 };
  const setNdc = (e) => ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  const onMove = (e) => {
    if (e.pointerType !== 'mouse' && e.buttons === 0) return; // a finger hovering does nothing
    setNdc(e);
    pointer.active = true;
    pointer.touch = e.pointerType !== 'mouse';
  };
  const onDown = (e) => {
    setNdc(e);
    pointer.until = 0;
    pointer.active = true;
    pointer.touch = e.pointerType !== 'mouse';
  };
  const onUp = (e) => {
    if (e.pointerType !== 'mouse') pointer.until = pointer.now + TOUCH_LINGER;
  };
  const onLeave = () => { pointer.active = false; };
  const opts = { passive: true }; // never blocks scrolling
  pointerTarget.addEventListener('pointermove', onMove, opts);
  pointerTarget.addEventListener('pointerdown', onDown, opts);
  pointerTarget.addEventListener('pointerup', onUp, opts);
  pointerTarget.addEventListener('pointercancel', onUp, opts);
  document.documentElement.addEventListener('pointerleave', onLeave);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s3 = new THREE.Vector3();
  const target = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const away = new THREE.Vector3();
  let shown = false;

  return {
    group,
    setQuality(next) {
      buildTentacles(next);
      setCount(next.story.jellies);
    },
    update(dt, t, meters, under) {
      pointer.now = t;
      const presence = smoothstep(480, 760, meters) * (1 - smoothstep(1300, 1550, meters)) * under;
      uniforms.uPresence.value = presence;
      const appearing = !shown;
      shown = group.visible = presence > 0.003;
      if (!group.visible) return;
      uniforms.uTime.value = t;
      const halfW = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;

      // A touch counts while the finger is down and for a moment after it lifts.
      const touchOver = pointer.touch && pointer.until > 0 && t > pointer.until;
      if (touchOver) { pointer.active = false; pointer.until = 0; }
      if (pointer.active) raycaster.setFromCamera(ndc, camera);

      const n = bells.count;
      const k = Math.min(1, dt);
      for (let i = 0; i < n; i++) {
        const j = jellies[i];
        // Startled: strokes come faster for a while.
        j.clock += dt * j.rate * (1 + j.excite * 1.2);
        const c = contraction(j.clock);

        // Wander around home, slowly, each on its own course.
        j.home.x = j.u * halfW * -j.home.z;
        target.set(
          j.home.x + Math.sin(t * 0.05 + j.ph * 6.3) * 1.6,
          j.home.y + Math.sin(t * 0.04 + j.ph * 9.1) * 0.9,
          j.home.z + Math.cos(t * 0.045 + j.ph * 4.7) * 1.4,
        );
        if (appearing) { j.pos.copy(target); j.vel.set(0, 0, 0); } // start in place, don't glide in from x = 0
        j.vel.addScaledVector(target.sub(j.pos), 0.12 * k);
        // Thrust along the bell's axis on every stroke, against a gentle sink.
        s3.set(0, 1, 0).applyEuler(e.set(j.tiltX ?? 0, 0, j.tiltZ ?? 0));
        j.vel.addScaledVector(s3, c * 0.9 * k);
        j.vel.y -= 0.12 * k;

        // Shy of the cursor: drift away from the ray and flare up.
        let want = 0;
        if (pointer.active) {
          raycaster.ray.closestPointToPoint(j.pos, closest);
          const reach = REACH * j.scale;
          const d = closest.distanceTo(j.pos);
          if (d < reach) {
            want = 1 - d / reach;
            away.subVectors(j.pos, closest).normalize();
            j.vel.addScaledVector(away, want * 1.4 * k);
          }
        }
        j.excite += (want - j.excite) * Math.min(1, dt * (want > j.excite ? 5 : 0.9));

        j.vel.multiplyScalar(Math.exp(-dt * 0.9));
        j.pos.addScaledVector(j.vel, dt);

        // Lean into the motion, sway, and turn slowly about the axis.
        j.tiltZ = -j.vel.x * 0.35 + Math.sin(t * 0.31 + j.ph * 7.0) * 0.14;
        j.tiltX = j.vel.z * 0.35 + Math.cos(t * 0.27 + j.ph * 5.0) * 0.12;
        j.yaw += j.spin * dt;
        q.setFromEuler(e.set(j.tiltX, j.yaw, j.tiltZ));
        bells.setMatrixAt(i, m4.compose(j.pos, q, s3.setScalar(j.scale)));
        clock.setX(i, j.clock);
        excite.setX(i, j.excite);
      }
      bells.instanceMatrix.needsUpdate = true;
      clock.needsUpdate = true;
      excite.needsUpdate = true;
    },
    dispose() {
      pointerTarget.removeEventListener('pointermove', onMove);
      pointerTarget.removeEventListener('pointerdown', onDown);
      pointerTarget.removeEventListener('pointerup', onUp);
      pointerTarget.removeEventListener('pointercancel', onUp);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    },
  };
}
