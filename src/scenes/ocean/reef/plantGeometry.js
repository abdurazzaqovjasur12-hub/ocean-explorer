import * as THREE from 'three';
import { createRng } from '@/utils/random';

/*
 * Plant shapes, procedural, in "unit" space: the root at the origin, growing up +y to about 1. The instance
 * matrix scales each one to size. Every vertex carries
 *   aBend     0 at the root .. 1 at the top: how far it is carried by the swell (the shader bends by aBend²)
 *   aFlutter  0 on stems .. 1 at the tips of leaves and blades: the quicker, smaller flutter on top of the sway
 * Leaves are flat strips, drawn double-sided.
 */

function builder() {
  const pos = [];
  const nor = [];
  const bend = [];
  const flutter = [];
  const index = [];
  const v = new THREE.Vector3();
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  return {
    /**
     * A strip along `path` (Vector3s), `side` across it (unit), `width(f)` for f = 0..1 along it,
     * `bendAt(f)` and `flutterAt(f)`.
     */
    strip(path, side, width, bendAt, flutterAt) {
      const first = pos.length / 3;
      path.forEach((p, k) => {
        const f = k / (path.length - 1);
        t.copy(path[Math.min(k + 1, path.length - 1)]).sub(path[Math.max(k - 1, 0)]).normalize();
        n.crossVectors(t, side).normalize();
        const w = width(f) / 2;
        for (const sgn of [-1, 1]) {
          v.copy(side).multiplyScalar(sgn * w).add(p);
          pos.push(v.x, v.y, v.z);
          nor.push(n.x, n.y, n.z);
          bend.push(bendAt(f));
          flutter.push(flutterAt(f));
        }
      });
      for (let k = 0; k < path.length - 1; k++) {
        const a = first + k * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('aBend', new THREE.Float32BufferAttribute(bend, 1));
      g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(flutter, 1));
      g.setIndex(index);
      g.computeBoundingSphere();
      return g;
    },
  };
}

/** Points along a curve that leaves `from` heading `dir` and droops (or lifts) by `curl` per unit length. */
function arc(from, dir, length, segments, curl) {
  const pts = [];
  const p = from.clone();
  const d = dir.clone().normalize();
  const step = length / segments;
  for (let k = 0; k <= segments; k++) {
    pts.push(p.clone());
    p.addScaledVector(d, step);
    d.y += curl * step;
    d.normalize();
  }
  return pts;
}

const UP = new THREE.Vector3(0, 1, 0);
const outward = (az, tilt) => new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
const sideOf = (dir) => {
  const s = new THREE.Vector3().crossVectors(dir, UP);
  return s.lengthSq() > 1e-8 ? s.normalize() : new THREE.Vector3(1, 0, 0);
};

/** Seagrass: a tuft of long, narrow blades, arching out a little. */
export function seagrassGeometry(blades = 7, segments = 4) {
  const rng = createRng(3);
  const b = builder();
  for (let i = 0; i < blades; i++) {
    const az = (i / blades) * Math.PI * 2 + rng() * 0.6;
    const root = new THREE.Vector3(Math.cos(az) * 0.06 * rng(), 0, Math.sin(az) * 0.06 * rng());
    const dir = outward(az, 0.08 + rng() * 0.3);
    const len = 0.7 + rng() * 0.32;
    const path = arc(root, dir, len, segments, -0.35 - rng() * 0.3);
    const side = sideOf(dir);
    side.applyAxisAngle(dir, (rng() - 0.5) * 0.8); // blades twist a little
    b.strip(path, side, (f) => 0.11 * (1 - f * 0.75), (f) => f * len, (f) => f * f * 0.6);
  }
  return b.build();
}

/** Leafy algae (sea lettuce, wrack): a clump of broad, ruffled leaves fanning up and out. */
export function leafyGeometry(leaves = 7, segments = 4) {
  const rng = createRng(5);
  const b = builder();
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * Math.PI * 2 + rng() * 0.8;
    const dir = outward(az, 0.3 + rng() * 0.7);
    const len = 0.55 + rng() * 0.4;
    const path = arc(new THREE.Vector3(), dir, len, segments, -0.6 - rng() * 0.5);
    const side = sideOf(dir).applyAxisAngle(dir, (rng() - 0.5) * 1.2);
    b.strip(path, side, (f) => 0.32 * Math.sin(Math.PI * Math.min(1, 0.12 + f * 0.95)), (f) => f * len, (f) => f);
  }
  return b.build();
}

/**
 * Kelp: a thin stipe (two crossed strips, so it reads from every side) with long blades along it, more of them
 * and more spread out near the top, where they make the canopy. `detail` 'near' or 'far' (the distant forest:
 * fewer segments and blades, a quarter of the vertices).
 */
export function kelpGeometry(detail = 'near') {
  const near = detail === 'near';
  const rng = createRng(near ? 8 : 9);
  const b = builder();
  const segs = near ? 14 : 5;
  const stipe = [];
  for (let k = 0; k <= segs; k++) {
    const y = k / segs;
    stipe.push(new THREE.Vector3(Math.sin(y * 3.1) * 0.025, y, Math.cos(y * 2.3) * 0.02));
  }
  const bendStem = (f) => f;
  b.strip(stipe, new THREE.Vector3(1, 0, 0), () => 0.022, bendStem, () => 0);
  b.strip(stipe, new THREE.Vector3(0, 0, 1), () => 0.022, bendStem, () => 0);

  const blades = near ? 22 : 9;
  const bladeSegs = near ? 3 : 1;
  for (let i = 0; i < blades; i++) {
    const f = 0.14 + 0.86 * Math.pow(i / (blades - 1), 0.8);
    const at = new THREE.Vector3(Math.sin(f * 3.1) * 0.025, f, Math.cos(f * 2.3) * 0.02);
    const az = i * 2.4 + rng() * 0.5; // golden angle: blades all round the stipe
    const tilt = 0.45 + f * 0.6 + rng() * 0.2; // lower blades point up, the top ones spread out
    const dir = outward(az, tilt);
    const len = (0.2 + rng() * 0.1) * (near ? 1 : 1.15);
    const path = arc(at, dir, len, bladeSegs, -1.3);
    const side = sideOf(dir).applyAxisAngle(dir, (rng() - 0.5) * 0.9);
    b.strip(path, side, (g) => 0.11 * Math.sin(Math.PI * Math.min(1, 0.15 + g * 0.9)), (g) => f + g * len * 0.5, (g) => 0.25 + g * 0.75);
  }
  // The crown: a few blades lying out flat at the top, where the stipe reaches the light.
  const crown = near ? 6 : 3;
  for (let i = 0; i < crown; i++) {
    const az = (i / crown) * Math.PI * 2 + rng();
    const dir = outward(az, 1.25 + rng() * 0.2);
    const top = stipe[stipe.length - 1];
    const path = arc(top, dir, 0.3 + rng() * 0.1, bladeSegs + 1, -0.6);
    const side = sideOf(dir);
    b.strip(path, side, (g) => 0.12 * Math.sin(Math.PI * Math.min(1, 0.15 + g * 0.9)), () => 1, (g) => 0.4 + g * 0.6);
  }
  return b.build();
}

/**
 * Red algae: an upright bush of broad blades, narrow at the base and rounded at the tip, rising in a loose V
 * from one holdfast (two crossed fans, so it has body from every side). `detail` 'near' or 'far'.
 */
export function redAlgaeGeometry(detail = 'near') {
  const near = detail === 'near';
  const rng = createRng(near ? 12 : 13);
  const b = builder();
  const blades = near ? 5 : 3;
  for (const fan of [0, 1.4]) {
    for (let i = 0; i < blades; i++) {
      const spread = ((i + 0.5) / blades - 0.5) * 1.1 + (rng() - 0.5) * 0.2;
      const dir = new THREE.Vector3(Math.sin(spread) * Math.cos(fan), Math.cos(spread), Math.sin(spread) * Math.sin(fan));
      const len = 0.75 + rng() * 0.3 - Math.abs(spread) * 0.25;
      const path = arc(new THREE.Vector3(), dir, len, near ? 4 : 2, 0.15);
      const side = sideOf(dir).applyAxisAngle(dir, (rng() - 0.5) * 0.6);
      b.strip(path, side, (f) => 0.04 + 0.22 * Math.sin(Math.PI * Math.min(1, 0.1 + f * 0.75)), (f) => f * len, (f) => f * 0.6);
    }
  }
  return b.build();
}
