import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { createRng } from '@/utils/random';
import { prefersReducedMotion } from '@/utils/motion';
import { noiseChunk, cloudChunk } from './shaders/chunks';

/*
 * The night sky's stars and shooting stars. (The Milky Way's glow, the aurora and the moon are part of the sky
 * shader itself, shaders/chunks.js, so they also appear in the reflections on the sea.)
 *
 *   stars     one Points draw call: thousands of stars on a sphere around the camera, most of them faint and a
 *             few bright, white, blue-white, warm and the odd orange; a share of them crowd along the Milky Way.
 *             Each twinkles at its own pace, more strongly near the horizon (the air is thicker there). They
 *             fade into the horizon haze, behind clouds and in the moon's glare, and are hidden by day and
 *             underwater (nothing is drawn: the whole layer is switched off). Count per tier (`night.stars`).
 *   meteors  now and then (every 6 - 20 s, never constantly) a shooting star crosses the sky: chosen here, drawn
 *            by the sky shader from two small uniform arrays (uMeteorA / uMeteorB in atmosphere.js). Only at night,
 *            above the water.
 */
const MAX = QUALITY_LEVELS.high.night.stars;
const RADIUS = 40; // inside the sky dome (50)
const GAL_N = new THREE.Vector3(-0.5794, 0.599, 0.5527); // the galactic plane's normal, as in the sky shader

const vertex = /* glsl */ `
attribute float aMag;
attribute vec3 aColor;
attribute float aSeed;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uSunDir;
uniform float uUnder;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
${noiseChunk}
${cloudChunk}
void main() {
  vec3 dir = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + dir * ${RADIUS.toFixed(1)}, 1.0);
  float h = dir.y;
  float horizon = smoothstep(0.015, 0.17, h);
  float clouds = 1.0 - 0.92 * cloudDensity(dir, uTime, uWind, CLOUD_OCT);
  float glare = 1.0 - 0.9 * smoothstep(0.95, 0.9995, dot(dir, normalize(uSunDir)));
  // Twinkling: two slow beats per star, deeper near the horizon.
  float depth = mix(0.6, 0.18, smoothstep(0.05, 0.6, h));
  float s1 = 0.5 + 0.5 * sin(uTime * (1.6 + 4.5 * fract(aSeed * 7.31)) + aSeed * 61.0);
  float s2 = 0.5 + 0.5 * sin(uTime * (0.5 + 1.2 * fract(aSeed * 3.17)) + aSeed * 17.0);
  float twinkle = 1.0 - depth * s1 * s2;
  vAlpha = aMag * twinkle * horizon * clouds * glare * uNight * (1.0 - uUnder);
  vColor = aColor;
  gl_PointSize = vAlpha < 0.004 ? 0.0 : (1.1 + 2.4 * aMag) * uScale;
}`;

const fragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float light = exp(-r2 * 7.0) + 0.22 * exp(-r2 * 1.8); // a sharp core in a soft glow
  gl_FragColor = vec4(vColor * light * vAlpha * 1.5, 1.0);
}`;

const COLORS = [
  [0.7, new THREE.Color(0.95, 0.97, 1.0)], // white
  [0.18, new THREE.Color(0.72, 0.82, 1.0)], // blue-white
  [0.1, new THREE.Color(1.0, 0.9, 0.74)], // warm
  [0.02, new THREE.Color(1.0, 0.72, 0.5)], // orange
];

function buildStars() {
  const rng = createRng(4242);
  const pos = new Float32Array(MAX * 3);
  const mag = new Float32Array(MAX);
  const col = new Float32Array(MAX * 3);
  const seed = new Float32Array(MAX);
  // A basis of the galactic plane, to crowd stars along the Milky Way.
  const ga = new THREE.Vector3(1, 0, 0).cross(GAL_N).normalize();
  const gb = GAL_N.clone().cross(ga).normalize();
  const d = new THREE.Vector3();
  let i = 0;
  while (i < MAX) {
    if (rng() < 0.42) {
      const th = rng() * Math.PI * 2;
      const off = (rng() + rng() + rng() - 1.5) * 0.16; // roughly Gaussian across the band
      d.copy(ga).multiplyScalar(Math.cos(th)).addScaledVector(gb, Math.sin(th)).addScaledVector(GAL_N, off).normalize();
    } else {
      const y = -0.03 + rng() * 1.03; // uniform over the visible cap of the sphere
      const r = Math.sqrt(1 - y * y);
      const th = rng() * Math.PI * 2;
      d.set(Math.cos(th) * r, y, Math.sin(th) * r);
    }
    if (d.y < -0.03) continue;
    pos.set([d.x, d.y, d.z], i * 3);
    // Brightness: most stars faint, a few bright (a steep power law), a handful very bright.
    const u = rng();
    mag[i] = u > 0.992 ? 1.2 + rng() * 0.5 : 0.16 + 0.84 * Math.pow(rng(), 4);
    let pick = rng();
    let c = COLORS[0][1];
    for (const [p, colr] of COLORS) { if (pick < p) { c = colr; break; } pick -= p; }
    col.set([c.r, c.g, c.b], i * 3);
    seed[i] = rng();
    i++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  return g;
}

export function createNightSky(scene, atmosphere, settings) {
  const u = atmosphere.uniforms;
  const uniforms = {
    uTime: u.uTime,
    uWind: u.uWind,
    uSunDir: u.uSunDir,
    uUnder: u.uUnder,
    uNight: u.uNight,
    uScale: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    defines: { CLOUD_OCT: Math.min(2, settings.ocean.skyClouds) },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const geometry = buildStars();
  geometry.setDrawRange(0, settings.night.stars);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // placed around the camera in the shader
  points.renderOrder = -900; // straight after the sky dome among the transparent things
  points.visible = false;
  scene.add(points);

  // Shooting stars.
  const reduced = prefersReducedMotion();
  const meteors = [0, 1].map(() => ({ progress: -1, duration: 1 }));
  let wait = 5;
  const start = new THREE.Vector3();
  const east = new THREE.Vector3();
  const down = new THREE.Vector3();
  const travel = new THREE.Vector3();
  function spawn(slot) {
    // Somewhere in front of the camera (it looks down -z), well up in the sky.
    const az = (Math.random() - 0.5) * 1.8;
    const el = 0.3 + Math.random() * 0.45;
    start.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    east.set(Math.cos(az), 0, Math.sin(az)); // along the horizon, to the right
    down.crossVectors(start, east).normalize(); // along the sky, towards the horizon
    if (down.y > 0) down.negate();
    const ang = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.9); // down to the left or right
    travel.copy(east).multiplyScalar(Math.sin(ang)).addScaledVector(down, Math.cos(ang)).normalize();
    const m = meteors[slot];
    m.progress = 0;
    m.duration = 0.6 + Math.random() * 0.7;
    u.uMeteorA.value[slot].set(start.x, start.y, start.z, 0);
    u.uMeteorB.value[slot].set(travel.x, travel.y, travel.z, 0.22 + Math.random() * 0.3);
  }

  return {
    points,
    /** night: 0..1 (eased); under: 0 above the water .. 1 below; viewportHeight: drawing-buffer height in pixels. */
    update(dt, night, under, viewportHeight) {
      points.visible = night > 0.002 && under < 0.999;
      uniforms.uScale.value = Math.min(2.6, Math.max(0.8, viewportHeight / 820));

      const canSpawn = night > 0.9 && under < 0.05;
      if (canSpawn) {
        wait -= dt;
        if (wait <= 0) {
          const free = meteors.findIndex((m) => m.progress < 0);
          if (free >= 0) spawn(free);
          // Rare by design: a quiet sky with an occasional surprise (now and then two close together).
          wait = Math.random() < 0.15 ? 1 + Math.random() * 2 : (reduced ? 14 : 6) + Math.random() * 14;
        }
      }
      meteors.forEach((m, i) => {
        if (m.progress < 0) return;
        m.progress += dt / m.duration;
        if (m.progress >= 1 || !(night > 0.5)) m.progress = -1;
        u.uMeteorA.value[i].w = m.progress;
      });
    },
    setQuality(next) {
      geometry.setDrawRange(0, Math.min(MAX, next.night.stars));
      material.defines.CLOUD_OCT = Math.min(2, next.ocean.skyClouds);
      material.needsUpdate = true;
    },
  };
}
