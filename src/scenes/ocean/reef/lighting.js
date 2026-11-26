import * as THREE from 'three';

/*
 * The reef's lighting: the scene's own lights (scenes/ocean/lights.js: the daylight from above as a hemisphere
 * and a sun, both losing their colours with depth and turning to moonlight at night, and the explorer's lamp),
 * read once per frame into uniforms and evaluated per *vertex*, in the same units as three.js's Lambert
 * material. The rock covers much of the frame between the surface and ~800 m; lighting it per pixel with
 * three lights was its main cost. Per vertex, the fragment shader is left with the colour and the fog.
 * No light is added to the scene for the reef.
 */
export function createReefLighting(lights) {
  const uniforms = {
    uHemiSky: { value: new THREE.Color() },
    uHemiGround: { value: new THREE.Color() },
    uReefSun: { value: new THREE.Color() },
    uReefSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLampLight: { value: new THREE.Color() },
    uLampPos: { value: new THREE.Vector3() },
    uLampRange: { value: new THREE.Vector2(40, 2) }, // cut-off distance, decay
  };
  const { hemi, sun, lamp } = lights;
  return {
    uniforms,
    /** After lights.update(): copy what the lights are doing this frame. */
    update() {
      uniforms.uHemiSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);
      uniforms.uHemiGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
      uniforms.uReefSun.value.copy(sun.color).multiplyScalar(sun.intensity);
      uniforms.uReefSunDir.value.subVectors(sun.position, sun.target.position).normalize();
      uniforms.uLampLight.value.copy(lamp.color).multiplyScalar(lamp.intensity);
      uniforms.uLampPos.value.copy(lamp.position);
      uniforms.uLampRange.value.set(lamp.distance, lamp.decay);
    },
  };
}

/** GLSL: irradiance (already divided by pi, like three's Lambert BRDF) at a world point with a world normal. */
export const reefLightGlsl = /* glsl */ `
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform vec3 uReefSun;
uniform vec3 uReefSunDir;
uniform vec3 uLampLight;
uniform vec3 uLampPos;
uniform vec2 uLampRange;
vec3 reefLight(vec3 p, vec3 n) {
  vec3 irradiance = mix(uHemiGround, uHemiSky, 0.5 * n.y + 0.5);
  irradiance += uReefSun * max(dot(n, uReefSunDir), 0.0);
  vec3 toLamp = uLampPos - p;
  float d = max(length(toLamp), 1e-4);
  float falloff = 1.0 / max(pow(d, uLampRange.y), 0.01) * pow2(saturate(1.0 - pow4(d / uLampRange.x)));
  irradiance += uLampLight * falloff * max(dot(n, toLamp / d), 0.0);
  return irradiance * RECIPROCAL_PI;
}
`;
