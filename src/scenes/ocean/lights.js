import * as THREE from 'three';
import { sunlightAt, absorptionColor, nightAt } from './depthPalette';

const MOON_TINT = new THREE.Color(0.6, 0.72, 1.0);

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0x9fe6f5, 0x06202e, 1);
  const sun = new THREE.DirectionalLight(0xcff6ff, 2.2);
  // The explorer's own lamp takes over as daylight fades.
  const lamp = new THREE.PointLight(0xa8dcff, 0, 40, 2);
  scene.add(hemi, sun, sun.target, lamp);

  const hemiBase = hemi.color.clone();
  const sunBase = sun.color.clone();
  const absorb = new THREE.Color();

  return {
    hemi,
    sun,
    lamp,
    /** `meters`: how far below the surface the camera is. Light dims and loses its red, then green, with depth. */
    update(meters, camPos) {
      const light = sunlightAt(meters);
      absorptionColor(meters, absorb);
      hemi.color.copy(hemiBase).multiply(absorb);
      sun.color.copy(sunBase).multiply(absorb);
      const n = nightAt(meters);
      if (n > 0) {
        hemi.color.lerp(MOON_TINT, n * 0.5);
        sun.color.lerp(MOON_TINT, n * 0.7);
      }
      hemi.intensity = 0.12 + 0.9 * light;
      sun.intensity = 2.2 * light;
      sun.position.set(6, camPos.y + 30, 4);
      sun.target.position.set(0, camPos.y, 0);
      lamp.intensity = 120 * (1 - light);
      lamp.position.set(camPos.x, camPos.y + 0.5, camPos.z);
    },
  };
}
