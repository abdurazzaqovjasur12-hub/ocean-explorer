import * as THREE from 'three';
import { createRng } from '@/utils/random';
import { lerp } from '@/utils/math';

const BURST_LIFE = 4.5; // seconds
const FADE_IN = 0.25;
const FADE_OUT = 1.4;

function bubbleGeometry(count) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  return { geometry, positions, sizes, alphas };
}

/**
 * The plunge: a burst of bubbles around the camera as it breaks the surface.
 * They rise, wobble and fade out; afterwards the layer switches itself off.
 */
export function createBubbles(count, material) {
  const rng = createRng(33);
  const { geometry, positions, sizes, alphas } = bubbleGeometry(count);
  const rise = new Float32Array(count);
  const wobble = new Float32Array(count);
  const phase = new Float32Array(count);
  const delay = new Float32Array(count);
  const life = new Float32Array(count);
  const maxLife = new Float32Array(count);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  let alive = 0;

  return {
    points,
    /** Spawn the burst around `origin` (the camera): mostly below and ahead, then rising past it. */
    burst(origin) {
      for (let i = 0; i < count; i++) {
        const r = Math.sqrt(rng()) * 4.5;
        const a = rng() * Math.PI * 2;
        positions[i * 3] = origin.x + Math.cos(a) * r;
        positions[i * 3 + 1] = origin.y - 0.4 - rng() * 5;
        positions[i * 3 + 2] = origin.z - 1.5 - Math.abs(Math.sin(a)) * r * 2.2;
        sizes[i] = 0.07 + Math.pow(rng(), 2.5) * 0.2; // mostly small, a few large
        rise[i] = 1.2 + rng() * 2.6;
        wobble[i] = 0.15 + rng() * 0.4;
        phase[i] = rng() * Math.PI * 2;
        delay[i] = rng() * 0.6;
        maxLife[i] = BURST_LIFE * (0.7 + rng() * 0.6);
        life[i] = maxLife[i];
        alphas[i] = 0;
      }
      alive = count;
      points.visible = true;
    },
    update(dt, t) {
      if (!alive) return;
      let still = 0;
      for (let i = 0; i < count; i++) {
        if (life[i] <= 0) continue;
        if (delay[i] > 0) { delay[i] -= dt; still++; continue; }
        life[i] -= dt;
        if (life[i] <= 0) { alphas[i] = 0; continue; }
        still++;
        positions[i * 3 + 1] += rise[i] * dt;
        positions[i * 3] += Math.sin(t * 1.7 + phase[i]) * wobble[i] * dt;
        const age = maxLife[i] - life[i];
        alphas[i] = Math.min(1, age / FADE_IN) * Math.min(1, life[i] / FADE_OUT);
      }
      alive = still;
      points.visible = alive > 0;
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
    },
  };
}

const COLUMNS = 7;

/**
 * Bubbles that keep rising for as long as you are underwater: a few loose columns plus stray bubbles.
 * They live in world space (the camera sinks past them), grow slightly as they rise, wobble, and are
 * recycled below the camera once they leave the top of the view.
 */
export function createBubbleStreams(count, material) {
  const rng = createRng(77);
  const { geometry, positions, sizes, alphas } = bubbleGeometry(count);
  const columnX = new Float32Array(COLUMNS);
  const columnZ = new Float32Array(COLUMNS);
  for (let c = 0; c < COLUMNS; c++) {
    columnX[c] = lerp(-9, 9, (c + rng() * 0.8) / COLUMNS);
    columnZ[c] = -(4 + rng() * 12);
  }
  const ox = new Float32Array(count);
  const oz = new Float32Array(count);
  const speed = new Float32Array(count);
  const phase = new Float32Array(count);
  const size0 = new Float32Array(count);
  const born = new Float32Array(count); // height where this bubble started rising
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  let initialised = false;
  let limit = count; // the quality tier's share of the allocated bubbles
  let active = count;

  function respawn(i, cam, anywhere) {
    const stray = i % 3 === 0;
    const c = i % COLUMNS;
    ox[i] = stray ? lerp(-10, 10, rng()) : columnX[c] + (rng() - 0.5) * 1.8;
    oz[i] = stray ? -(2 + rng() * 14) : columnZ[c] + (rng() - 0.5) * 1.8;
    speed[i] = 0.45 + rng() * 0.9;
    phase[i] = rng() * Math.PI * 2;
    size0[i] = 0.08 + Math.pow(rng(), 2.2) * 0.22;
    const y = anywhere ? cam.y - 9 + rng() * 17 : cam.y - 9 - rng() * 3; // start anywhere in view, or just below it
    positions[i * 3 + 1] = y;
    born[i] = y;
  }

  return {
    points,
    setLimit(n) { limit = Math.min(count, Math.max(0, n)); },
    /** intensity 0..1: how many of the bubbles are active (0 hides the layer). */
    update(dt, t, cam, intensity) {
      points.visible = intensity > 0.01;
      if (!points.visible) return;
      if (!initialised) { for (let i = 0; i < count; i++) respawn(i, cam, true); initialised = true; }
      active = Math.floor(limit * Math.min(1, intensity));
      geometry.setDrawRange(0, active);
      for (let i = 0; i < active; i++) {
        let y = positions[i * 3 + 1] + speed[i] * dt;
        if (y > cam.y + 8 || y < cam.y - 14) { respawn(i, cam, false); y = positions[i * 3 + 1]; }
        positions[i * 3 + 1] = y;
        positions[i * 3] = cam.x + ox[i] + Math.sin(t * 1.3 + phase[i]) * 0.14;
        positions[i * 3 + 2] = cam.z + oz[i] + Math.cos(t * 1.1 + phase[i]) * 0.14;
        const risen = y - born[i];
        sizes[i] = size0[i] * (1 + 0.04 * risen); // bubbles expand as the pressure drops
        const edge = Math.min(1, (cam.y + 8 - y) / 2.5, (y - (cam.y - 14)) / 2.5); // soft in and out at the view limits
        alphas[i] = Math.max(0, edge) * 0.8;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
    },
  };
}
