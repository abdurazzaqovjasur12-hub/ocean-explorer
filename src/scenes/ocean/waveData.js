import { createRng } from '@/utils/random';

export const MAX_WAVES = 12;

/** Direction the wind blows towards, as an angle in the x/z plane (mostly +z, towards the camera). */
export const WIND_ANGLE = 1.25;
export const WIND = [Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE)];

const TAU = Math.PI * 2;

/**
 * Builds the Gerstner wave set as two flat vec4 arrays, ordered from longest to shortest
 * so a lower quality tier simply uses the first N.
 *   A = (dirX, dirZ, k, amplitude)       k = wave number (2*pi / wavelength)
 *   B = (omega, phase, 1 / (k*amplitude), wavelength)
 * Two long swell systems cross the wind sea at different angles, and wavelengths are
 * jittered so no ratio repeats.
 */
export function createWaveData(seed = 11) {
  const rng = createRng(seed);
  const A = new Float32Array(MAX_WAVES * 4);
  const B = new Float32Array(MAX_WAVES * 4);

  for (let i = 0; i < MAX_WAVES; i++) {
    const length = 46 * Math.pow(0.72, i) * (0.92 + rng() * 0.16);
    const k = TAU / length;

    let angle;
    if (i < 2) angle = WIND_ANGLE + 1.1 + (rng() - 0.5) * 0.25; // distant swell, crosses the wind
    else if (i === 2) angle = WIND_ANGLE - 0.5 + (rng() - 0.5) * 0.2; // second swell
    else angle = WIND_ANGLE + (rng() - 0.5) * (0.9 + i * 0.09); // wind sea, wider spread when short

    const steepness = 0.095 * Math.pow(0.94, i) * (0.85 + rng() * 0.3); // k * amplitude
    const amplitude = steepness / k;
    const omega = Math.sqrt(9.81 * k); // deep-water dispersion

    A.set([Math.cos(angle), Math.sin(angle), k, amplitude], i * 4);
    B.set([omega, rng() * TAU, 1 / steepness, length], i * 4);
  }
  return { A, B };
}
