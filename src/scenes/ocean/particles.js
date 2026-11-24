import * as THREE from 'three';
import { createRng } from '@/utils/random';
import { lerp } from '@/utils/math';

// Particles live in a box around the camera and wrap around it (see `scale` below for the wider layer).
const X = [-22, 22];
const Y = [-22, 22];
const Z = [-40, 4];

export function createSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Keeps `v` inside [center+range[0], center+range[1]], wrapping from the other side. */
function wrap(v, center, [min, max]) {
  const rel = v - center;
  if (rel >= min && rel <= max) return v;
  const size = max - min;
  return center + ((((rel - min) % size) + size) % size) + min;
}

/**
 * Drifting particles (marine snow). `scale` stretches the box they live in, so a second, wider layer of
 * smaller, slower particles sits behind the first: nearer ones slide faster against the far ones when the camera moves.
 */
export function createMarineSnow(count, { scale = 1, size = 0.14, speed = 1, seed = 7 } = {}) {
  const rng = createRng(seed);
  const rx = [X[0] * scale, X[1] * scale];
  const ry = [Y[0] * scale, Y[1] * scale];
  const rz = [Z[0] * scale, Z[1] * scale];
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = lerp(rx[0], rx[1], rng());
    positions[i * 3 + 1] = lerp(ry[0], ry[1], rng());
    positions[i * 3 + 2] = lerp(rz[0], rz[1], rng());
    speeds[i] = (0.15 + rng() * 0.35) * speed;
    phases[i] = rng() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: createSprite(),
    color: 0xcff6ff,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions move relative to the camera

  let cap = count; // from the quality tier
  let density = 1; // 0..1, ramped up by the dive
  let active = count;
  let visibility = 1;
  let brightness = 1; // follows how much light is left at this depth
  const refresh = () => {
    active = Math.floor(Math.min(cap, count) * density);
    geometry.setDrawRange(0, active);
  };
  const applyOpacity = () => { material.opacity = 0.65 * visibility * brightness; };

  return {
    points,
    /** 0 hides the snow (camera above water), 1 shows it fully. */
    setVisibility(f) {
      visibility = f;
      points.visible = f > 0.01 && density > 0;
      applyOpacity();
    },
    /** Colour and brightness of the light on the particles at this depth. */
    setTint(color, light) {
      material.color.copy(color);
      brightness = 0.35 + 0.65 * light;
      applyOpacity();
    },
    /** Show at most `n` particles (cannot exceed what was allocated). */
    setCount(n) {
      cap = n;
      refresh();
    },
    /** Fraction of the snow that is switched on; the dive ramps this from 0 to 1. */
    setDensity(d) {
      density = Math.min(1, Math.max(0, d));
      refresh();
    },
    update(dt, t, cam) {
      for (let i = 0; i < active; i++) {
        const k = i * 3;
        const x = positions[k] + Math.sin(t * 0.4 + phases[i]) * 0.15 * dt;
        const y = positions[k + 1] - speeds[i] * dt;
        positions[k] = wrap(x, cam.x, rx);
        positions[k + 1] = wrap(y, cam.y, ry);
        positions[k + 2] = wrap(positions[k + 2], cam.z, rz);
      }
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
