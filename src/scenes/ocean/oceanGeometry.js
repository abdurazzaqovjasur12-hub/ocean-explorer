/**
 * Polar grid for the ocean: rings are spaced geometrically, so vertices are dense near the
 * camera and sparse towards the horizon, with a single centre point (no hole under the camera).
 * Pure typed-array code, no three.js, so it can be tested on its own.
 */
export function buildPolarGrid({ rings, segments, outerRadius, innerRadius = 0.9 }) {
  const growth = Math.pow(outerRadius / innerRadius, 1 / (rings - 2));
  const positions = new Float32Array(rings * segments * 3);
  const indices = new Uint32Array((rings - 1) * segments * 6);

  for (let j = 0; j < rings; j++) {
    const radius = j === 0 ? 0 : innerRadius * Math.pow(growth, j - 1);
    for (let i = 0; i < segments; i++) {
      const phi = (i / segments) * Math.PI * 2;
      const v = (j * segments + i) * 3;
      positions[v] = Math.cos(phi) * radius;
      positions[v + 1] = 0;
      positions[v + 2] = Math.sin(phi) * radius;
    }
  }

  let n = 0;
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const i1 = (i + 1) % segments;
      const a = j * segments + i;
      const b = j * segments + i1;
      const c = (j + 1) * segments + i;
      const d = (j + 1) * segments + i1;
      indices[n++] = a; indices[n++] = b; indices[n++] = c; // counter-clockwise seen from above
      indices[n++] = b; indices[n++] = d; indices[n++] = c;
    }
  }

  return { positions, indices, gridStep: growth - 1 };
}
