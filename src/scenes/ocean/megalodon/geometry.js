import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '@/utils/random';

/*
 * The megalodon's body, built from code (no model file to download): one merged mesh per level of detail.
 *
 * Shark space: +x forward (the snout is at x = 8.6), +y up, z to the sides; 18.3 units from snout to tail tip
 * (index.js scales it to the length it is drawn at). The proportions follow the usual
 * reconstruction (a heavy lamniform shark: short blunt snout, deep body, tall first dorsal, long pectorals, a
 * crescent tail with keels on the tail stock); the true shape is not known (only teeth and vertebrae survive).
 *
 * Every vertex carries two attributes the skin shader reads:
 *   aPart  0 skin   1 fin   2 lower jaw   3 teeth   4 mouth (inside)   5 eye
 *   aJaw   0..1: how much of the jaw's opening moves it (the lower jaw and its teeth 1; the inside of the mouth
 *          stretches from the upper lip, 0, to the jaw, 1)
 * Swimming, the jaw and the turns are all bent in the vertex shader, so the CPU never touches a vertex.
 */
export const SNOUT_X = 8.6;
export const TAIL_X = -7.35; // where the body ends (the tail fin carries on behind it)
export const TAIL_TIP_X = -9.7; // the tip of the tail fin's upper lobe
export const MODEL_LENGTH = SNOUT_X - TAIL_TIP_X; // 18.3 model units, snout to tail tip
export const HINGE = new THREE.Vector2(6.15, -0.42); // the jaw's hinge (x, y), about the z axis

// The body's profile along its length: [x, half-height, half-width, centre height].
const PROFILE = [
  [8.6, 0.0, 0.0, 0.1], // a short, conical snout, wider than it is deep, the top of the head sloping back
  [8.48, 0.16, 0.24, 0.06],
  [8.15, 0.4, 0.58, 0.0],
  [7.6, 0.68, 0.9, -0.04],
  [6.8, 1.0, 1.2, -0.04],
  [5.6, 1.45, 1.48, 0.0],
  [3.8, 1.84, 1.66, 0.04],
  [2.0, 1.86, 1.6, 0.06],
  [0.2, 1.62, 1.38, 0.06],
  [-1.8, 1.26, 1.06, 0.06],
  [-3.6, 0.88, 0.74, 0.06],
  [-5.2, 0.55, 0.5, 0.06],
  [-6.3, 0.36, 0.42, 0.06], // the tail stock: narrow, wider than it is deep (the keels)
  [-7.0, 0.27, 0.3, 0.06],
  [-7.35, 0.0, 0.0, 0.06],
];
const hCurve = new THREE.SplineCurve(PROFILE.map(([x, ry]) => new THREE.Vector2(x, ry)));
const wCurve = new THREE.SplineCurve(PROFILE.map(([x, , rz]) => new THREE.Vector2(x, rz)));
const cCurve = new THREE.SplineCurve(PROFILE.map(([x, , , cy]) => new THREE.Vector2(x, cy)));
const tmp = new THREE.Vector2();
const LEN = PROFILE[0][0] - PROFILE[PROFILE.length - 1][0];

/** Profile at x: { ry, rz, cy }. The curves run from the snout (t = 0) to the tail (t = 1), nearly linear in x. */
function profileAt(x) {
  // The control points are not evenly spaced in x: find t by a few steps of bisection on the height curve's x.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (hCurve.getPoint(mid, tmp).x > x) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const ry = Math.max(0, hCurve.getPoint(t, tmp).y);
  const rz = Math.max(0, wCurve.getPoint(t, tmp).y);
  const cy = cCurve.getPoint(t, tmp).y;
  return { ry, rz, cy };
}

/**
 * A point on the body's surface at x and angle a (0 = the side at +z, pi/2 = the top, -pi/2 = the belly).
 * The cross-section is a rounded shape, a little flatter under the head, with the keels on the tail stock.
 */
export function bodyPoint(x, a, out = new THREE.Vector3()) {
  const { ry, rz, cy } = profileAt(x);
  const s = Math.sin(a);
  const c = Math.cos(a);
  let y = s * ry;
  if (s < 0) y *= 1 - 0.16 * smooth(3.5, 7.5, x); // a flatter underside to the head
  // The back is a little more ridged than the belly (sharks are not round): narrower near the top.
  let z = c * rz * (1 - 0.08 * Math.max(0, s));
  // Caudal keels: a horizontal ridge on each side of the tail stock.
  const keel = 0.12 * smooth(-5.4, -6.3, x) * (1 - smooth(-6.9, -7.3, x)) * Math.exp(-(s * s) / 0.04);
  z += Math.sign(c) * keel;
  return out.set(x, cy + y, z);
}
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function tag(g, part, jaw = 0) {
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
  if (!g.attributes.aJaw) g.setAttribute('aJaw', new THREE.Float32BufferAttribute(new Float32Array(n).fill(jaw), 1));
  return g;
}
/** Only position, normal and the two tags: every part must have the same attributes to be merged. */
function clean(g) {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'aPart', 'aJaw'].includes(name)) g.deleteAttribute(name);
  return g;
}

function bodyGeometry(rings, sides) {
  const pos = [];
  const index = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    // More rings near the snout and the tail, where the shape changes fastest.
    const u = i / rings;
    const k = 0.5 - 0.5 * Math.cos(u * Math.PI);
    const x = SNOUT_X - LEN * (0.35 * u + 0.65 * k);
    for (let j = 0; j <= sides; j++) {
      bodyPoint(x, (j / sides) * Math.PI * 2, p);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  // The seam (j = 0 and j = sides) and the tips have duplicate vertices: weld them for smooth normals.
  const welded = mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  return tag(welded, 0);
}

/** A fin from an outline in its own plane (x along the body, y along the span), thin with rounded edges. */
function finGeometry(shape, thickness, curveSegments) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.8, bevelSize: thickness * 0.9, bevelSegments: 2, curveSegments,
  });
  g.translate(0, 0, -thickness / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const welded = mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  g.dispose();
  return welded;
}

function dorsalShape() {
  const s = new THREE.Shape();
  s.moveTo(1.3, -0.3);
  s.bezierCurveTo(1.0, 0.7, 0.2, 1.65, -0.75, 2.15); // leading edge, up and back to the tip
  s.quadraticCurveTo(-0.62, 1.05, -1.25, -0.3); // trailing edge, concave
  s.lineTo(1.3, -0.3);
  return s;
}
function pectoralShape() {
  const s = new THREE.Shape();
  s.moveTo(0.8, -0.2);
  s.bezierCurveTo(0.75, 1.1, -0.35, 2.3, -1.55, 3.1); // a long, swept-back blade
  s.quadraticCurveTo(-1.0, 1.8, -0.85, -0.2);
  s.lineTo(0.8, -0.2);
  return s;
}
function caudalShape() {
  // Crescent tail (lunate, nearly symmetrical as in the mackerel sharks; the upper lobe a little longer).
  const s = new THREE.Shape();
  s.moveTo(0.45, 0.32);
  s.bezierCurveTo(-0.5, 1.2, -1.5, 2.25, -2.75, 3.0); // upper lobe, leading edge
  s.quadraticCurveTo(-1.75, 1.35, -1.25, 0.05); // trailing edge back to the fork
  s.quadraticCurveTo(-1.65, -1.15, -2.35, -2.45); // lower lobe, trailing edge
  s.bezierCurveTo(-1.35, -1.8, -0.5, -1.0, 0.45, -0.32); // lower lobe, leading edge
  s.lineTo(0.45, 0.32);
  return s;
}
function smallFinShape(base, height, sweep) {
  const s = new THREE.Shape();
  s.moveTo(base / 2, -0.12);
  s.quadraticCurveTo(base * 0.3, height * 0.6, -sweep, height);
  s.quadraticCurveTo(-base * 0.3, height * 0.35, -base / 2, -0.12);
  s.lineTo(base / 2, -0.12);
  return s;
}

function fins(detail) {
  const seg = detail.finSegments;
  const parts = [];
  const top = (x) => { const { ry, cy } = profileAt(x); return cy + ry * 0.92; };
  const bottom = (x) => { const { ry, cy } = profileAt(x); return cy - ry * 0.9; };

  // First dorsal: tall, a little behind the pectorals.
  const dorsal = finGeometry(dorsalShape(), 0.1, seg);
  dorsal.translate(2.1, top(2.1), 0);
  parts.push(dorsal);

  // Second dorsal and anal fin: small, near the tail.
  const d2 = finGeometry(smallFinShape(0.55, 0.42, 0.25), 0.05, Math.max(4, seg >> 1));
  d2.translate(-5.35, top(-5.35), 0);
  parts.push(d2);
  const anal = finGeometry(smallFinShape(0.5, 0.38, 0.22), 0.05, Math.max(4, seg >> 1));
  anal.rotateX(Math.PI);
  anal.translate(-5.55, bottom(-5.55), 0);
  parts.push(anal);

  // Pectorals: long blades, swept back and angled down (anhedral), as a shark holds them when cruising.
  for (const side of [1, -1]) {
    const f = finGeometry(pectoralShape(), 0.12, seg);
    f.rotateX(side * (Math.PI / 2 + 0.42));
    const root = bodyPoint(4.3, side > 0 ? -0.62 : Math.PI + 0.62);
    f.translate(root.x, root.y + 0.08, root.z - side * 0.12);
    parts.push(f);
    // Pelvic fins: small, under the belly.
    const pv = finGeometry(smallFinShape(0.6, 0.75, 0.4), 0.06, Math.max(4, seg >> 1));
    pv.rotateX(side * (Math.PI / 2 + 0.75));
    const r2 = bodyPoint(-2.9, side > 0 ? -1.0 : Math.PI + 1.0);
    pv.translate(r2.x, r2.y + 0.05, r2.z - side * 0.05);
    parts.push(pv);
  }

  // Tail fin, in the vertical plane, on the end of the tail stock.
  const tail = finGeometry(caudalShape(), 0.1, seg + 4);
  tail.translate(-6.95, 0.06, 0);
  parts.push(tail);

  return parts.map((g) => tag(g, 1));
}

/** The curve of the mouth (underslung, a wide crescent): u -1 .. 1 from one corner round the chin to the other. */
function mouthPoint(u, out = new THREE.Vector3()) {
  const x = 7.6 - 1.4 * u * u;
  const a = -Math.PI / 2 + u * 0.85; // round the underside of the head, up towards the corners
  bodyPoint(x, a, out);
  return out;
}

/**
 * The lower jaw (a rounded band under the mouth line that swings down on the hinge), the inside of the mouth
 * (a dark curtain from the upper lip to the jaw that stretches as it opens) and the rows of teeth.
 */
function mouth(detail) {
  const n = detail.mouthSegments;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const centre = new THREE.Vector3();

  // Lower jaw: a tube along the mouth curve, sitting a little below and inside the lip.
  const jawPos = [];
  const jawIdx = [];
  const ringN = 8;
  for (let i = 0; i <= n; i++) {
    const u = -1 + (2 * i) / n;
    mouthPoint(u, p);
    centre.set(0, profileAt(p.x).cy, 0);
    const inward = new THREE.Vector3(0, centre.y - p.y, -p.z).normalize(); // towards the body's axis
    const fade = 1 - 0.55 * Math.abs(u) ** 3; // thinner at the corners
    const c = p.clone().addScaledVector(inward, 0.12).add(new THREE.Vector3(0, -0.1 * fade, 0));
    for (let j = 0; j <= ringN; j++) {
      const a = (j / ringN) * Math.PI * 2;
      q.copy(c)
        .addScaledVector(inward, Math.cos(a) * 0.2 * fade)
        .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(a) * 0.16 * fade);
      jawPos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < ringN; j++) {
      const a = i * (ringN + 1) + j;
      const b = a + ringN + 1;
      jawIdx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  let jaw = new THREE.BufferGeometry();
  jaw.setAttribute('position', new THREE.Float32BufferAttribute(jawPos, 3));
  jaw.setIndex(jawIdx);
  jaw = mergeVertices(jaw, 1e-4);
  jaw.computeVertexNormals();
  tag(jaw, 2, 1);

  // Inside of the mouth: two rows along the lip, the lower one moving with the jaw.
  const inPos = [];
  const inJaw = [];
  const inIdx = [];
  for (let i = 0; i <= n; i++) {
    const u = -1 + (2 * i) / n;
    mouthPoint(u, p);
    const inward = new THREE.Vector3(0, profileAt(p.x).cy - p.y, -p.z).normalize();
    const back = p.clone().addScaledVector(inward, 0.22).add(new THREE.Vector3(-0.15, 0.02, 0));
    inPos.push(back.x, back.y, back.z, back.x - 0.05, back.y - 0.02, back.z);
    inJaw.push(0, 1);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    inIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const inside = new THREE.BufferGeometry();
  inside.setAttribute('position', new THREE.Float32BufferAttribute(inPos, 3));
  inside.setAttribute('aJaw', new THREE.Float32BufferAttribute(inJaw, 1));
  inside.setIndex(inIdx);
  inside.computeVertexNormals();
  tag(inside, 4);

  // Teeth: broad triangles (four-sided cones, flattened), largest at the front, smaller towards the corners.
  const teeth = [];
  const count = detail.teeth;
  if (count > 0) {
    const rng = createRng(17);
    const proto = new THREE.ConeGeometry(0.075, 0.24, 4, 1);
    proto.deleteAttribute('uv');
    proto.scale(1, 1, 0.38);
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    for (const row of ['upper', 'lower']) {
      for (let i = 0; i < count; i++) {
        const u = -0.94 + (1.88 * (i + 0.5)) / count;
        mouthPoint(u, p);
        const inward = new THREE.Vector3(0, profileAt(p.x).cy - p.y, -p.z).normalize();
        const size = (1 - 0.5 * Math.abs(u)) * (0.85 + 0.3 * rng());
        const g = proto.clone();
        g.scale(size, size, size);
        // Point the tooth down (upper row) or up (lower row), facing out along the mouth curve.
        const up = row === 'upper' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
        const tangent = new THREE.Vector3().subVectors(mouthPoint(Math.min(1, u + 0.01), q), p);
        tangent.addScaledVector(up, -tangent.dot(up)).normalize(); // square to the tooth's axis
        const forward = new THREE.Vector3().crossVectors(tangent, up).normalize();
        m.makeBasis(tangent, up, forward);
        quat.setFromRotationMatrix(m);
        g.applyQuaternion(quat);
        const lip = p.clone().addScaledVector(inward, 0.1);
        if (row === 'upper') g.translate(lip.x, lip.y - 0.08 * size, lip.z);
        else g.translate(lip.x - 0.05, lip.y - 0.12 + 0.05 * size, lip.z);
        teeth.push(tag(g, 3, row === 'lower' ? 1 : 0));
      }
    }
    proto.dispose();
  }
  return [jaw, inside, ...teeth];
}

function eyes() {
  return [1, -1].map((side) => {
    const g = new THREE.SphereGeometry(0.075, 10, 8);
    g.deleteAttribute('uv');
    const p = bodyPoint(7.0, side > 0 ? 0.3 : Math.PI - 0.3);
    g.translate(p.x, p.y - 0.01, p.z - Math.sign(p.z) * 0.04); // set into the head, not on it
    return tag(g, 5);
  });
}

/**
 * One level of detail. `detail`: { rings, sides, finSegments, mouthSegments, teeth } (teeth 0: no mouth parts,
 * for the far level, which only ever shows a silhouette).
 */
export function sharkGeometry(detail) {
  const parts = [bodyGeometry(detail.rings, detail.sides), ...fins(detail), ...eyes()];
  if (detail.teeth > 0) parts.push(...mouth(detail));
  const merged = mergeGeometries(parts.map(clean), false);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/** The body's radius along its length, for tapping it (a few spheres along the spine). */
export function hitSpheres() {
  const out = [];
  for (let x = 7.8; x >= -6.4; x -= 1.3) {
    const { ry, rz, cy } = profileAt(x);
    out.push({ x, y: cy, r: Math.max(ry, rz) * 1.1 + 0.25 });
  }
  return out;
}
