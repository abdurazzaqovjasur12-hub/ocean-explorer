import * as THREE from 'three';
import { hash2 } from '@/utils/noise';

/*
 * Noise for the rock's shader, baked once into a small tiling texture: a few texture reads per pixel instead of
 * some twenty hashes of procedural noise (the rock can cover the whole frame, and that arithmetic was most of
 * its cost). 256 x 256 RGBA (256 KB, mipmapped), four independent channels:
 *
 *   r  value noise, 32 cells across     (fine patches)
 *   g  value noise, 16 cells across     (broad patches)
 *   b  fBm, 3 octaves from 16 cells     (the grain of the rock; 0 .. 0.875)
 *   a  value noise, 64 cells across     (fine grain, up close)
 *
 * Each channel tiles (its lattice wraps), so the texture repeats without a seam; NOISE_CELLS gives the cells
 * per tile of each, for scaling lookups.
 */
const SIZE = 256;
export const NOISE_CELLS = { r: 32, g: 16, b: 16, a: 64 };

function tiled(x, y, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const w = (i) => ((i % period) + period) % period;
  const h = (i, j) => hash2(w(i) + seed * 131, w(j) + seed * 71);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function createNoiseTexture() {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const fbm = 0.5 * tiled(u * 16, v * 16, 16, 3) + 0.25 * tiled(u * 32, v * 32, 32, 4) + 0.125 * tiled(u * 64, v * 64, 64, 5);
      const i = (y * SIZE + x) * 4;
      data[i] = tiled(u * 32, v * 32, 32, 1) * 255;
      data[i + 1] = tiled(u * 16, v * 16, 16, 2) * 255;
      data[i + 2] = fbm * 255; // 0 .. 0.875
      data[i + 3] = tiled(u * 64, v * 64, 64, 6) * 255;
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
