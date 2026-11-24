import * as THREE from 'three';
import { oceanVertex, oceanFragment } from './shaders';
import { buildPolarGrid } from './oceanGeometry';
import { createWaveData } from './waveData';

const OUTER_RADIUS = 4000;

/**
 * The sea: a camera-centred polar grid whose vertices carry the long Gerstner waves, while
 * the fragment shader adds the shorter waves, ripples, foam, reflections and haze per pixel.
 */
export function createOceanSurface(scene, atmosphere, settings) {
  const waves = createWaveData();

  const uniforms = {
    ...atmosphere.uniforms,
    uWaveA: { value: waves.A },
    uWaveB: { value: waves.B },
    uWaveAmp: { value: 0.6 }, // overall wave height; keep modest, the sea should feel calm and deep
    uChoppy: { value: 0.55 }, // how sharp the crests are (stays under 1 so waves never fold over)
    uFoam: { value: 1 },
    uHaze: { value: 0.00022 },
    uRadius: { value: OUTER_RADIUS },
    uGridStep: { value: 0.06 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: oceanVertex,
    fragmentShader: oceanFragment,
    uniforms,
    defines: {},
    side: THREE.DoubleSide, // the underside is shaded too (Snell's window)
    dithering: true,
  });

  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false; // displaced and camera-sized; always on screen
  scene.add(mesh);

  function apply(next) {
    const o = next.ocean;

    const grid = buildPolarGrid({ rings: o.rings, segments: o.segments, outerRadius: OUTER_RADIUS });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(grid.indices, 1));
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    uniforms.uGridStep.value = grid.gridStep;

    // Waves are sorted longest first, so a lower tier just uses the first N.
    uniforms.uWaveA.value = waves.A.slice(0, o.waves * 4);
    uniforms.uWaveB.value = waves.B.slice(0, o.waves * 4);
    material.defines.WAVE_COUNT = o.waves;
    material.defines.DETAIL_OCTAVES = o.detail;
    material.defines.REFLECT_CLOUD_OCT = o.reflectClouds;
    material.needsUpdate = true;
  }
  apply(settings);

  return { mesh, setQuality: apply };
}
