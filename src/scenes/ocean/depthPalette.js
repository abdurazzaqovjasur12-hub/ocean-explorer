import * as THREE from 'three';
import { lerp, smoothstep } from '@/utils/math';

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
  [11000, '#010616'], // still blue, not black: the deepest water keeps a trace of colour
].map(([meters, hex]) => ({ meters, color: new THREE.Color(hex) }));

// Day (0) .. night (1), set once per frame by the scene (from state.env.night, which GSAP eases between modes).
// Everything that depends on daylight reads it here, so the water, the fog, the lights, the beams, the
// particles and the sound of the depth all agree. Below ~2,500 m day and night look the same: no sunlight
// reaches that far anyway.
let night = 0;
export const setNightLevel = (n) => { night = Math.min(1, Math.max(0, n)); };
export const nightLevel = () => night;
/** How much the night shows at a depth: fully near the surface, not at all in the deep. */
export const nightAt = (meters) => night * (1 - smoothstep(600, 2500, meters));

// The moonlit water near the surface: a deep blue-black that still reads as water.
const NIGHT_TINT = new THREE.Color('#05142a');
const dayColor = new THREE.Color();

/** Water colour at a depth in metres (used for the background, the fog and the surface seen from below). */
export function sampleDepthColor(meters, target = new THREE.Color()) {
  dayColor.copy(STOPS[STOPS.length - 1].color);
  for (let i = 1; i < STOPS.length; i++) {
    if (meters <= STOPS[i].meters) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      dayColor.copy(a.color).lerp(b.color, (meters - a.meters) / (b.meters - a.meters));
      break;
    }
  }
  const n = nightAt(meters);
  if (n <= 0) return target.copy(dayColor);
  // At night: much darker, and pulled towards the moonlit blue-black (never darker than the deep itself).
  return target.copy(dayColor).multiplyScalar(0.28).lerp(NIGHT_TINT, 0.35).lerp(dayColor, 1 - n);
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

/** 1 at the surface, falling towards ~0 in the deep. At night only moonlight comes in: about a seventh. */
export const sunlightAt = (meters) => Math.max(0.04, Math.exp(-meters / 450) * lerp(1, 0.14, nightAt(meters)));

// Thickens further in the hadal deep: the abyss is mostly fog and darkness.
export const fogDensityAt = (meters) => lerp(0.022, 0.05, 1 - Math.exp(-meters / 1500)) + 0.014 * smoothstep(5000, 10000, meters);
