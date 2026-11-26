import * as THREE from 'three';
import { hash2 } from '@/utils/noise';

/*
 * Noise for the rock's shader (and the megalodon's skin), baked once into a small tiling texture: a few texture
 * reads per pixel instead of some twenty hashes of procedural noise (the rock can cover the whole frame, and that
 * arithmetic was most of its cost). 256 x 256 RGBA (256 KB, mipmapped), four independent channels:
 *
 *   r  value noise, 32 cells across     (fine patches)
 *   g  value noise, 16 cells across     (broad patches)
 *   b  fBm, 3 octaves from 16 cells     (the grain of the rock; 0 .. 0.875)
 *   a  value noise, 64 cells across     (fine grain, up close)
 *
 * Each channel tiles (its lattice wraps), so the texture repeats without a seam; NOISE_CELLS gives the cells
 * per tile of each, for scaling lookups.
 *
 * Built once and shared (getNoiseTexture). The hash of every lattice corner is worked out first, a few thousand
 * values, and the pixels only interpolate them: the same texture, byte for byte, as hashing at every pixel (some
 * 1.5 million sines, which used to be the single biggest piece of work while loading on a phone).
 */
const SIZE = 256;
export const NOISE_CELLS = { r: 32, g: 16, b: 16, a: 64 };

/** The wrapped lattice of one channel: hash2 at each of its period x period corners. */
function lattice(period, seed) {
  const table = new Float64Array(period * period);
  for (let j = 0; j < period; j++) for (let i = 0; i < period; i++) table[j * period + i] = hash2(i + seed * 131, j + seed * 71);
  return { period, table };
}

/** Tiling value noise at (x, y) in cells, from a lattice. */
function tiled(L, x, y) {
  const { period, table } = L;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = table[y0 * period + x0];
  const b = table[y0 * period + x1];
  const c = table[y1 * period + x0];
  const d = table[y1 * period + x1];
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function createNoiseTexture() {
  const L1 = lattice(32, 1);
  const L2 = lattice(16, 2);
  const L3 = lattice(16, 3);
  const L4 = lattice(32, 4);
  const L5 = lattice(64, 5);
  const L6 = lattice(64, 6);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const fbm = 0.5 * tiled(L3, u * 16, v * 16) + 0.25 * tiled(L4, u * 32, v * 32) + 0.125 * tiled(L5, u * 64, v * 64);
      const i = (y * SIZE + x) * 4;
      data[i] = tiled(L1, u * 32, v * 32) * 255;
      data[i + 1] = tiled(L2, u * 16, v * 16) * 255;
      data[i + 2] = fbm * 255; // 0 .. 0.875
      data[i + 3] = tiled(L6, u * 64, v * 64) * 255;
    }
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

let shared = null;
/** The one noise texture everything shares (the reef's rock, the megalodon's skin). */
export function getNoiseTexture() {
  if (!shared) shared = createNoiseTexture();
  return shared;
}
