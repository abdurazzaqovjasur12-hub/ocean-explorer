import * as THREE from 'three';
import { shaftVertex, shaftFragment } from './shaders';
import { buildShafts } from './shaftData';
import { nightAt } from './depthPalette';

const SUN = new THREE.Color(1.0, 0.96, 0.88);
const MOON = new THREE.Color(0.55, 0.68, 1.0);

/**
 * Soft beams of light hanging from the surface, shimmering as the waves move above them.
 * They fade in as the camera goes under, and fade out again in the dark.
 */
export function createLightShafts(scene, atmosphere, settings) {
  const uniforms = {
    uTime: atmosphere.uniforms.uTime,
    uDown: { value: new THREE.Vector3(0, -1, 0) },
    uStrength: { value: 0 },
    uLightColor: { value: SUN.clone() }, // sunlight by day, cool moonlight at night
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: shaftVertex,
    fragmentShader: shaftFragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false; // positions are computed in the vertex shader
  mesh.renderOrder = 2;
  mesh.visible = false;
  scene.add(mesh);

  function build(count) {
    const data = buildShafts(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('aBase', new THREE.BufferAttribute(data.base, 3));
    geometry.setAttribute('aParams', new THREE.BufferAttribute(data.params, 4));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }
  build(settings.underwater.shafts);

  return {
    mesh,
    /** under: 0 above water .. 1 underwater; meters: camera depth; rayDir: where the light comes from (unit, up). */
    update({ under, meters, rayDir }) {
      uniforms.uDown.value.copy(rayDir).negate();
      // brightest in the sunlit upper water, still visible a few hundred metres down
      const n = nightAt(meters);
      const strength = under * Math.min(1, 0.25 + 0.9 * Math.exp(-meters / 300)) * (1 - 0.6 * n);
      uniforms.uLightColor.value.copy(SUN).lerp(MOON, n);
      uniforms.uStrength.value = strength;
      mesh.visible = strength > 0.01 && meters < 900; // below that the beams have long since ended: skip the draw
    },
    setQuality(next) { build(next.underwater.shafts); },
  };
}
