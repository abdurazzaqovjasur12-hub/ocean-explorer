import { createRng } from '@/utils/random';

/**
 * Geometry data for `count` light shafts. Each shaft is one quad (4 vertices); the vertex shader stretches
 * it along the light direction and turns it to face the camera.
 *   position  = (side -1 | +1, along 0..1, 0)
 *   aBase     = where the shaft meets the surface
 *   aParams   = (width, length, intensity, seed)
 * Pure typed arrays, so it can be tested without three.js.
 */
export function buildShafts(count, seed = 5) {
  const rng = createRng(seed);
  const positions = new Float32Array(count * 4 * 3);
  const base = new Float32Array(count * 4 * 3);
  const params = new Float32Array(count * 4 * 4);
  const index = new Uint16Array(count * 6);
  const corners = [[-1, 0], [1, 0], [-1, 1], [1, 1]];

  for (let s = 0; s < count; s++) {
    // A disc of water around and ahead of the camera (it looks down -z). Close enough that the beams fall
    // from overhead and pass by into the depths, instead of hanging far off near the horizon.
    const r = 3 + 27 * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = -13 + Math.sin(a) * r;
    const width = 1.2 + 2.2 * rng();
    const length = 28 + 18 * rng(); // long enough to reach well below the camera in the sunlit zone
    const intensity = 0.45 + 0.55 * rng();
    const shaftSeed = rng();
    for (let c = 0; c < 4; c++) {
      const v = s * 4 + c;
      positions.set([corners[c][0], corners[c][1], 0], v * 3);
      base.set([x, 0, z], v * 3);
      params.set([width, length, intensity, shaftSeed], v * 4);
    }
    index.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
  }
  return { positions, base, params, index };
}
