import * as THREE from 'three';
import { skyVertex, skyFragment } from './shaders';

/** Procedural sky dome centred on the camera. Drawn first, ignores depth. */
export function createSky(scene, atmosphere, settings) {
  const material = new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: { ...atmosphere.uniforms },
    defines: { SKY_CLOUD_OCT: settings.ocean.skyClouds, MILKY_OCT: settings.night.milky, AURORA_LAYERS: settings.night.aurora, AURORA_RAY_LAYERS: settings.night.rays },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    dithering: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    update(camera) {
      mesh.position.copy(camera.position);
    },
    setQuality(next) {
      material.defines.SKY_CLOUD_OCT = next.ocean.skyClouds;
      material.defines.MILKY_OCT = next.night.milky;
      material.defines.AURORA_LAYERS = next.night.aurora;
      material.defines.AURORA_RAY_LAYERS = next.night.rays;
      material.needsUpdate = true;
    },
  };
}
