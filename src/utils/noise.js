/**
 * Value noise on the CPU, for procedural geometry (the vent field, the reef). The GPU shaders use the same
 * family, so shapes built here and detail added in the shaders agree.
 */
export function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Smooth value noise, 0..1. */
export function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
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
