import * as THREE from 'three';
import { depthToY, metersBelowSurface } from '@/config/zones';
import { fbm } from '@/utils/noise';
import { lerp, smoothstep } from '@/utils/math';

/*
 * The shape of the reef the dive goes down beside: one rock face ahead and to the left of the camera (which
 * looks down -z and descends along x = 0, z = 0). Just right of the middle of the view the reef ends: its face
 * turns away into the distance, so the right of the frame stays open water, where the light shafts of the
 * shallows hang (a wall dive: rock on one side, the blue on the other, on wide screens and phones alike).
 *
 * Its cross-section (z, metres) runs from the reef flat far behind the crest, over the crest just below the
 * waves, down the slope where the kelp grows (it comes towards the camera as it deepens, so the kelp's upright
 * stipes stand clear of the rock above them), over the drop-off, and down a wall that leans back into the deep
 * and out of sight: at the jellyfish (~900 m) it is far enough back to leave them room, and by the whale it has
 * gone into the dark.
 *
 * Across the view (x) the face curves into a shallow cove and a spur on the left, turns away on the right, is
 * bent by broad noise, and is cut into buttresses,
 * gullies, rubble and, on the wall, ledges. Pure functions of (x, s), s being the distance along the
 * cross-section: the rock mesh, the plants and the glowing growths all use them, so everything sits on the rock.
 */
const PROFILE = [
  [-95, 26],
  [-62, 19],
  [-36, 16],
  [-25, 21],
  [-19, 34],
  [-13, 72],
  [-11, 200],
  [-13.5, 300],
  [-28, 560],
  [-50, 900],
  [-60, 1380],
  [-70, 1950],
].map(([z, m]) => new THREE.Vector2(z, depthToY(m)));

/** The rock mesh spans x from REEF_X[0] to REEF_X[1]; past REEF_END the face turns away into the distance. */
export const REEF_X = [-90, 24];
const REEF_END = -1;
const curve = new THREE.SplineCurve(PROFILE);
curve.arcLengthDivisions = 3000;
export const PROFILE_LENGTH = curve.getLength();

// Arc-length table of the cross-section: position and the outward normal (towards the water).
const STEPS = 1600;
const table = new Float32Array((STEPS + 1) * 4);
{
  const p = new THREE.Vector2();
  const t = new THREE.Vector2();
  for (let i = 0; i <= STEPS; i++) {
    curve.getPointAt(i / STEPS, p);
    curve.getTangentAt(i / STEPS, t);
    // Tangent runs from the reef flat towards the deep; turned a quarter: up on the flat, towards the camera on the wall.
    table.set([p.x, p.y, -t.y, t.x], i * 4);
  }
}
let crest = 0;
for (let i = 1; i <= STEPS; i++) if (table[i * 4 + 1] > table[crest * 4 + 1]) crest = i;

function base(s, out) {
  const f = Math.min(STEPS, Math.max(0, (s / PROFILE_LENGTH) * STEPS));
  const i = Math.min(STEPS - 1, Math.floor(f));
  const k = f - i;
  for (let c = 0; c < 4; c++) out[c] = table[i * 4 + c] + (table[i * 4 + 4 + c] - table[i * 4 + c]) * k;
  return out;
}

/** Distance along the cross-section where the (undisplaced) face reaches a depth, on the seaward side of the crest. */
export function sAtMeters(meters) {
  const y = depthToY(meters);
  let lo = crest;
  let hi = STEPS;
  if (y >= table[crest * 4 + 1]) return (crest / STEPS) * PROFILE_LENGTH;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid * 4 + 1] > y) lo = mid;
    else hi = mid;
  }
  return (hi / STEPS) * PROFILE_LENGTH;
}

// The crest stays below the troughs of the waves (the swell reaches down to about y = -1.5).
const TOP = depthToY(12);
const softMin = (a, b, k) => -Math.log(Math.exp(-a * k) + Math.exp(-b * k)) / k;

// Terraces on the wall: going down, the face leans back gently, then steps out again (a ledge facing up).
function ledges(s, x) {
  const f = s / 6 + fbm(x * 0.05, 7.3, 2) * 1.6;
  const k = f - Math.floor(f);
  return 0.9 * (k < 0.72 ? 1 - smoothstep(0, 0.72, k) : smoothstep(0.72, 1, k)) - 0.45;
}

const b = new Float32Array(4);

/** A point on the rock face. */
export function reefPoint(x, s, out = new THREE.Vector3()) {
  base(s, b);
  const [z0, y0, nz, ny] = b;
  const m = metersBelowSurface(y0);
  const deep = smoothstep(200, 700, m);
  const shallow = smoothstep(14, 40, m); // gentler relief on the crest
  const cove = (-3 * Math.exp(-((x / 14) ** 2)) + 10 * smoothstep(10, 36, -x)) * lerp(1, 0.3, deep);
  const turn = x > REEF_END ? -((x - REEF_END) ** 1.7) * 0.55 : 0; // the end of the reef, turning away
  const bend = (fbm(x * 0.025 + 3, 0.5, 2) - 0.5) * lerp(8, 5, deep);
  const big = ((fbm(x * 0.07, s * 0.05, 3) - 0.5) * lerp(2.2, 4.2, deep) + (fbm(x * 0.16 + 9, s * 0.025, 2) - 0.5) * 2.4) * lerp(0.35, 1, shallow); // buttresses, gullies
  const rock = (fbm(x * 0.3 + 5.2, s * 0.3 - 1.1, 3) - 0.5) * lerp(0.6, 1.2, shallow); // rubble
  const ledge = ledges(s, x) * smoothstep(50, 140, m);
  const d = big + rock + ledge;
  return out.set(x, softMin(y0 + ny * d, TOP, 6), z0 + cove + turn + bend + nz * d);
}

const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const pc = new THREE.Vector3();
/** The outward normal of the rock face at (x, s) (finite differences of reefPoint). */
export function reefNormal(x, s, out = new THREE.Vector3()) {
  reefPoint(x, s, pa);
  reefPoint(x + 0.15, s, pb).sub(pa);
  reefPoint(x, s + 0.15, pc).sub(pa);
  return out.crossVectors(pc, pb).normalize();
}

/**
 * The rows of the rock mesh: distances along the cross-section, close together where the camera can see the
 * rock up close (from the crest down to ~1,000 m), wider apart on the far reef flat and in the deep.
 */
export function reefRows(step) {
  const near = [sAtMeters(10) - 14, sAtMeters(1050)];
  const rows = [];
  for (let s = 0; s < PROFILE_LENGTH; ) {
    rows.push(s);
    s += s > near[0] && s < near[1] ? step : step * 3;
  }
  rows.push(PROFILE_LENGTH);
  return rows;
}

/** Is a point on the rock within the widest view from the dive (a 16:9 screen, plus the look-around)? */
export const inView = (p) => Math.abs(p.x) < -p.z * 1.15 + 5;
