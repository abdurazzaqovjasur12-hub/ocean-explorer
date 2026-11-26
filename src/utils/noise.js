/**
 * Value noise on the CPU, for procedural geometry (the vent field, the reef). The GPU shaders use the same
 * family, so shapes built here and detail added in the shaders agree.
 */
export function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// The lattice corners' hashes, remembered: while the reef is built, nearby samples ask for the same integer corners
// over and over, and the sine in hash2 was the biggest single cost of loading on a phone. A small direct-mapped
// cache (16 K slots, ~0.4 MB): a corner's value is exactly hash2's, so every shape stays the same; only repeats
// are skipped. Coordinates outside 32-bit integers simply go straight to hash2.
const CACHE_BITS = 14;
const cacheX = new Int32Array(1 << CACHE_BITS).fill(0x7fffffff);
const cacheY = new Int32Array(1 << CACHE_BITS);
const cacheV = new Float64Array(1 << CACHE_BITS);
function corner(ix, iy) {
  if ((ix | 0) !== ix || (iy | 0) !== iy) return hash2(ix, iy);
  const slot = (Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca6b)) >>> (32 - CACHE_BITS);
  if (cacheX[slot] === ix && cacheY[slot] === iy) return cacheV[slot];
  const v = hash2(ix, iy);
  cacheX[slot] = ix;
  cacheY[slot] = iy;
  cacheV[slot] = v;
  return v;
}

/** Smooth value noise, 0..1. */
export function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = corner(ix, iy);
  const b = corner(ix + 1, iy);
  const c = corner(ix, iy + 1);
  const d = corner(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal (fBm) value noise, roughly 0..1. */
export function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.3;
    amp *= 0.5;
  }
  return sum;
}
