import * as THREE from 'three';
import { bubbleVertex, bubbleFragment } from './shaders';

/** One bubble material shared by the plunge burst and the rising streams. */
export function createBubbleMaterial() {
  const uniforms = {
    uScale: { value: 400 },
    uTint: { value: new THREE.Color(0.8, 0.95, 1) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: bubbleVertex,
    fragmentShader: bubbleFragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return {
    material,
    /** viewportHeight: drawing-buffer height in pixels; tint: the light colour at this depth. */
    update(viewportHeight, tint) {
      uniforms.uScale.value = viewportHeight * 0.5;
      uniforms.uTint.value.copy(tint);
    },
  };
}
