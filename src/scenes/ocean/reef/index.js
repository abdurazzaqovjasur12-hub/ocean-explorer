import * as THREE from 'three';
import { smoothstep } from '@/utils/math';
import { BANDS, REEF_SHOW, ROCK_SHOW } from './bands';
import { reefRockGeometry, reefRockMaterial, createBoulders, markGlowPass } from './rock';
import { createReefLighting } from './lighting';
import { GLOW_LAYER } from '../bloom';
import { createPlants } from './plants';
import { createLuminous } from './luminous';

/*
 * The reef the dive goes down beside, from the waves to the edge of the deep (see shape.js for its form and
 * bands.js for what grows where):
 *
 *   rock       one mesh, lit by the scene's lights, coloured by depth; boulders on the crest and slope (instanced)
 *   seagrass   0 - 20 m     instanced tufts on the crest
 *   leafy      12 - 32 m    instanced clumps of green and brown algae
 *   kelp       30 - 72 m    the forest, instanced in two levels of detail (full near the dive, a quarter of the
 *                           vertices in the distance), canopy at 16 - 26 m
 *   red algae  70 - 200 m   instanced fans, two levels of detail
 *   luminous   200 - 1300 m glowing threads (instanced) and mats of light (points); additive, on the bloom layer
 *
 * At most ten draw calls, and only those whose band can be in frame from the camera's depth: everything
 * else is hidden (and costs nothing). All the motion is in the vertex shaders (one time uniform, the current,
 * and how much the camera's movement stirs the water): no per-plant work on the CPU. No lights of its own:
 * the plants and rock use the scene's daylight and the explorer's lamp (evaluated per vertex: reef/lighting.js),
 * and the glow is emitted light.
 * Densities per tier in config/quality.js (`story.reef`).
 */
export function createReef(scene, atmosphere, lights, settings) {
  let tier = settings.story.reef;
  const lighting = createReefLighting(lights);
  const shared = {
    ...lighting.uniforms,
    uTime: atmosphere.uniforms.uTime,
    uRayDir: atmosphere.uniforms.uRayDir,
    uCurrent: { value: new THREE.Vector2(0.9, 0.3) },
    uStir: { value: 0 },
    uBackLight: { value: new THREE.Color() },
    uAmbient: { value: new THREE.Color() },
  };
  const group = new THREE.Group();

  let rockColumns = tier.wall;
  const glow = { value: 0 }; // 0..1: how strongly everything below 200 m glows (darker water: more)
  const fade = { value: 0 }; // the rock dissolving into the water below the depths it can be seen from
  const rock = new THREE.Mesh(reefRockGeometry(rockColumns), reefRockMaterial({ time: atmosphere.uniforms.uTime, glow, fade, light: lighting.uniforms }));
  rock.material.userData.detail.value = tier.detail ? 1 : 0;
  rock.frustumCulled = false; // it spans the whole view whenever it is shown
  const boulders = createBoulders(rock.material);
  markGlowPass(rock, GLOW_LAYER); // both: they share the material, and only the rock is drawn into the bloom
  markGlowPass(boulders, GLOW_LAYER);
  boulders.count = Math.min(boulders.userData.placed, tier.boulders);
  const plants = createPlants(shared);
  plants.setQuality(tier);
  const luminous = createLuminous(shared, tier, glow);
  group.add(rock, boulders, ...Object.values(plants.meshes), luminous.threads, luminous.mats);
  scene.add(group);

  // Each layer is drawn only while the camera is within its band's `show` range.
  const layers = [
    ...Object.entries(plants.meshes).map(([k, mesh]) => ({ mesh, show: BANDS[plants.bands[k]].show })),
    { mesh: boulders, show: [0, 600] },
    { mesh: luminous.threads, show: BANDS.luminous.show },
    { mesh: luminous.mats, show: BANDS.luminous.show },
  ];
  const sunColor = new THREE.Color();

  return {
    group,
    glowing: [rock, luminous.threads, luminous.mats], // the rock is there to hide the glow behind it
    /**
     * meters: camera depth; under: 0 above water .. 1 below; light: sunlight left (night included);
     * absorb: colour of what is left of it; stir: 0.. how much the camera's travel and the pointer stir the water.
     */
    update({ t, meters, under, light, absorb, stir, viewportHeight }) {
      group.visible = under > 0.001 && meters < REEF_SHOW;
      if (!group.visible) return;
      lighting.update();
      for (const { mesh, show } of layers) mesh.visible = meters >= show[0] && meters <= show[1];
      // Deeper than ~850 m the wall is too far off and too dark to see (the glowing threads and mats on it carry
      // on): fade it into the water, then skip drawing it, since it would otherwise cover the whole frame.
      fade.value = smoothstep(560, ROCK_SHOW, meters);
      rock.visible = fade.value < 0.999;
      shared.uStir.value = stir;
      shared.uCurrent.value.set(Math.cos(t * 0.05) * 0.9 + 0.3, Math.sin(t * 0.04) * 0.4 + 0.25).normalize();
      // Light through the leaves: the colour of the sun (or moon, from the atmosphere) as it is at this depth.
      const sc = atmosphere.uniforms.uSunColor.value;
      sunColor.setRGB(sc.x, sc.y, sc.z).multiply(absorb).multiplyScalar(light * 1.3);
      shared.uBackLight.value.copy(sunColor);
      shared.uAmbient.value.copy(absorb).multiplyScalar(light * 0.4); // the light scattered in the water itself
      // The glow shows as the water around the camera darkens, and is gone again below the wall.
      glow.value = smoothstep(0.75, 0.18, light) * (1 - smoothstep(1250, REEF_SHOW, meters));
      luminous.uniforms.uScale.value = viewportHeight * 0.5;
    },
    setQuality(next) {
      tier = next.story.reef;
      plants.setQuality(tier);
      luminous.setQuality(tier);
      boulders.count = Math.min(boulders.userData.placed, tier.boulders);
      boulders.boundingSphere = null;
      if (tier.wall !== rockColumns) {
        rockColumns = tier.wall;
        rock.geometry.dispose();
        rock.geometry = reefRockGeometry(rockColumns);
      }
      rock.material.userData.detail.value = tier.detail ? 1 : 0;
    },
  };
}
