import * as THREE from 'three';
import { lerp } from '@/utils/math';

// Water colour by metres below the surface: clear cyan-blue near the light, deepening to dark navy.
const STOPS = [
  [0, '#2c9fc8'],
  [30, '#1e86b8'],
  [100, '#146aa6'],
  [250, '#0e4f86'],
  [600, '#08325f'],
  [1200, '#051f40'],
  [3000, '#03112a'],
  [6000, '#020a18'],
  [11000, '#010409'],
].map(([meters, hex]) => ({ meters, color: new THREE.Color(hex) }));

/** Water colour at a depth in metres (used for the background, the fog and the surface seen from below). */
export function sampleDepthColor(meters, target = new THREE.Color()) {
  for (let i = 1; i < STOPS.length; i++) {
    if (meters <= STOPS[i].meters) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      return target.copy(a.color).lerp(b.color, (meters - a.meters) / (b.meters - a.meters));
    }
  }
  return target.copy(STOPS[STOPS.length - 1].color);
}

/**
 * How much of each colour of sunlight survives at a depth. Water takes red first (gone within a few
 * tens of metres), then green; blue lasts the longest. Normalised so the strongest channel is 1
 * (brightness is handled separately by sunlightAt).
 */
export function absorptionColor(meters, target = new THREE.Color()) {
  const r = Math.exp(-meters / 30);
  const g = Math.exp(-meters / 160);
  const b = Math.exp(-meters / 700);
  const m = Math.max(r, g, b);
  return target.setRGB(r / m, g / m, b / m);
}

/** 1 at the surface, falling towards ~0 in the deep. */
export const sunlightAt = (meters) => Math.max(0.04, Math.exp(-meters / 450));

export const fogDensityAt = (meters) => lerp(0.022, 0.05, 1 - Math.exp(-meters / 1500));
