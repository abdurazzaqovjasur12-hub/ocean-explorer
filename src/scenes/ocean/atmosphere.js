import * as THREE from 'three';
import { WIND } from './waveData';
import { prefersReducedMotion } from '@/utils/motion';
import { smoothstep } from '@/utils/math';
import { sunlightAt } from './depthPalette';

// Where the sun sits relative to the camera's forward direction (radians). Slightly left, low.
const BASE_AZIMUTH = -0.28;
const BASE_ELEVATION = 0.17;
// The moon: a little higher and further right, so its silver path crosses the frame.
const MOON_AZIMUTH = -0.12;
const MOON_ELEVATION = 0.3;
const SUN_COLOR = [1.0, 0.72, 0.46];
const MOON_COLOR = [0.62, 0.7, 0.88];

/**
 * Where the sun appears from underwater. Light bends towards the vertical when it enters the water
 * (Snell's law, index 1.33). For a low sun that would put the beams almost 48 degrees off vertical, so
 * the angle is capped to keep them readable as shafts of light from above.
 */
export function refractedSun(sun, out) {
  const sinZenith = Math.sqrt(Math.max(0, 1 - sun.y * sun.y));
  const sinWater = Math.min(sinZenith / 1.33, Math.sin(0.66));
  const cosWater = Math.sqrt(1 - sinWater * sinWater);
  const h = Math.hypot(sun.x, sun.z) || 1;
  return out.set((sinWater * sun.x) / h, cosWater, (sinWater * sun.z) / h);
}

/**
 * Uniforms shared by the sky dome and the ocean surface, so both always agree on the sun,
 * the wind, the time and how far the camera is underwater.
 */
export function createAtmosphere() {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(WIND[0], WIND[1]) },
    uSunDir: { value: new THREE.Vector3(0, Math.sin(BASE_ELEVATION), -1) },
    uSunColor: { value: new THREE.Vector3(1.0, 0.72, 0.46) },
    uGlow: { value: 1 },
    uGust: { value: 0 },
    uWaterColor: { value: new THREE.Vector3(0.16, 0.65, 0.79) }, // sRGB, matches the scene fog
    uWaterFog: { value: 0.025 },
    uUnder: { value: 0 },
    uRayDir: { value: new THREE.Vector3(0, 1, 0) }, // towards the sun as seen from underwater (bent by the surface)
    uDepthLight: { value: 1 }, // how much sunlight is left at the camera's depth
    uMeters: { value: 0 }, // camera depth in metres
    uNight: { value: 0 }, // 0 day .. 1 moonlit night
    // Shooting stars (chosen in nightSky.js, drawn by the sky shader): start direction + progress (< 0: idle),
    // direction of travel + arc length.
    uMeteorA: { value: [new THREE.Vector4(0, 1, 0, -1), new THREE.Vector4(0, 1, 0, -1)] },
    uMeteorB: { value: [new THREE.Vector4(1, 0, 0, 0), new THREE.Vector4(1, 0, 0, 0)] },
  };
  const speed = prefersReducedMotion() ? 0.45 : 1;
  const rgb = { r: 0, g: 0, b: 0 };

  return {
    uniforms,
    /** pointer: { x, y } in -1..1 (smoothed) and energy 0..1 (how much the mouse has been moving). */
    update({ time, camera, pointer, waterColor, fogDensity, meters = 0, night = 0 }) {
      uniforms.uNight.value = night;
      uniforms.uTime.value = time * speed;

      // The pointer nudges the sun a few degrees and warms or cools the glow around it.
      const az = BASE_AZIMUTH + (MOON_AZIMUTH - BASE_AZIMUTH) * night + pointer.x * 0.06;
      const el = BASE_ELEVATION + (MOON_ELEVATION - BASE_ELEVATION) * night - pointer.y * 0.018;
      const ce = Math.cos(el);
      uniforms.uSunDir.value.set(ce * Math.sin(az), Math.sin(el), -ce * Math.cos(az));
      uniforms.uGlow.value = (1 - pointer.y * 0.18 + pointer.energy * 0.12) * (1 - 0.35 * night);
      uniforms.uSunColor.value.set(...SUN_COLOR.map((d, i) => d + (MOON_COLOR[i] - d) * night)); // glitter: gold -> silver
      uniforms.uGust.value = pointer.energy;

      waterColor.getRGB(rgb, THREE.SRGBColorSpace);
      uniforms.uWaterColor.value.set(rgb.r, rgb.g, rgb.b);
      uniforms.uWaterFog.value = fogDensity;
      uniforms.uMeters.value = meters;
      uniforms.uDepthLight.value = sunlightAt(meters);
      refractedSun(uniforms.uSunDir.value, uniforms.uRayDir.value);
      // Stays 0 until the camera is below nearly every wave trough; above that the surface still covers the sky.
      uniforms.uUnder.value = 1 - smoothstep(-2.0, -0.9, camera.position.y);
    },
  };
}
