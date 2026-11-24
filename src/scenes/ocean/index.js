import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { metersBelowSurface } from '@/config/zones';
import { sampleDepthColor, fogDensityAt, absorptionColor, sunlightAt } from './depthPalette';
import { createLights } from './lights';
import { createEnvironment } from './environment';
import { createMarineSnow } from './particles';
import { createBubbles, createBubbleStreams } from './bubbles';
import { createBubbleMaterial } from './bubbleMaterial';
import { createLightShafts } from './createLightShafts';
import { createCameraRig } from './cameraRig';
import { createAtmosphere } from './atmosphere';
import { createSky } from './createSky';
import { createOceanSurface } from './createOceanSurface';
import { createBioluminescence } from './bioluminescence';
import { createWhale } from './whale';
import { createVents } from './vents';
import { createJellyfish } from './jellyfish';
import { createBloom } from './bloom';
import { smoothstep } from '@/utils/math';

const pause = () => new Promise((resolve) => setTimeout(resolve, 0)); // lets the loading UI repaint
const MAX_STREAMS = QUALITY_LEVELS.high.underwater.streams;
const MAX_PLANKTON = QUALITY_LEVELS.high.underwater.plankton;
const BURST_GAP = 1.2; // seconds: scrubbing back and forth across the waterline doesn't fire a burst every frame

/**
 * Scene factory used by <ThreeScene>. Receives { scene, camera, renderer, settings, state, report }
 * and returns { update, setQuality, dispose }. Anything added to `scene` is disposed
 * automatically; only non-scene resources (listeners, etc.) need dispose().
 *
 * Everything that depends on depth reads `state.meters`: how far under the surface the *camera* is,
 * worked out here every frame from its position (so the sky, fog, light, particles and the on-screen
 * counter all agree during the dive, not only once it is over).
 *
 * The camera is directed by two sets of GSAP values, added together here: `state.cam` (scrubbed by the
 * scroll story) and `state.shot` (the time-based arrival after loading).
 *
 * Bloom (post-processing) is mixed in with depth: none in the sunlit water, full where the living light is.
 */
export async function createOceanScene({ scene, camera, renderer, settings, state, report }) {
  report(0.08, 'Filling the water');
  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0x2c9fc8, 0.03);
  await pause();

  report(0.18, 'Painting the sky');
  const atmosphere = createAtmosphere();
  const sky = createSky(scene, atmosphere, settings);
  await pause();

  report(0.34, 'Raising the swell');
  const surface = createOceanSurface(scene, atmosphere, settings);
  await pause();

  report(0.5, 'Letting the light in');
  const shafts = createLightShafts(scene, atmosphere, settings);
  const lights = createLights(scene);
  await pause();

  report(0.64, 'Shaping the seabed');
  const environment = createEnvironment(scene, settings);
  await pause();

  report(0.78, 'Releasing marine snow');
  const snow = createMarineSnow(settings.particleCount);
  // A wider, finer, slower layer behind the main one: depth for the parallax.
  const plankton = createMarineSnow(Math.round(QUALITY_LEVELS.high.particleCount * MAX_PLANKTON), { scale: 2.2, size: 0.09, speed: 0.5, seed: 19 });
  plankton.setCount(Math.round(settings.particleCount * settings.underwater.plankton));
  scene.add(snow.points, plankton.points);
  await pause();

  report(0.9, 'Gathering bubbles');
  const bubbleFx = createBubbleMaterial();
  const burst = createBubbles(Math.round(settings.particleCount * 0.12), bubbleFx.material);
  const streams = createBubbleStreams(MAX_STREAMS, bubbleFx.material);
  streams.setLimit(settings.underwater.streams);
  scene.add(burst.points, streams.points);
  await pause();

  report(0.93, 'Waking the deep');
  const glow = createBioluminescence(settings.story.glow);
  scene.add(glow.points);
  const whale = createWhale(scene);
  const vents = createVents(scene, settings);
  const jellies = createJellyfish(scene, camera, settings);
  const bloom = createBloom(renderer, scene, camera, settings);
  // Story scenery starts visible so the shader compile after loading includes it (update() hides what is
  // out of range on the first frame): no hitch the first time the dive reaches it.
  for (const o of [glow.points, whale.mesh, vents.group, jellies.group]) o.visible = true;
  await pause();

  const rig = createCameraRig(camera, { enablePointer: !state.device.isTouch });
  const water = new THREE.Color();
  const absorb = new THREE.Color();
  const snowTint = new THREE.Color();
  const bubbleTint = new THREE.Color();
  let lastBurst = state.fx.burstId;
  const shot = { idle: 0, heave: 0, fov: 0, pitch: 0, push: 0, yaw: 0 };
  let wasUnder = false;
  let lastCross = -Infinity;
  let lastY = null;
  let speed = 0;
  let bloomAmount = 0;
  // Development only: `__ocean` in the console exposes the scene, camera and layers for inspection.
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__ocean = { scene, camera, renderer, state, shafts, snow, plankton, streams, burst, atmosphere, glow, whale, vents, jellies, bloom };

  return {
    update(dt, t) {
      const a = state.shot;
      const b = state.cam;
      shot.idle = a.idle * b.idle;
      shot.heave = a.heave + b.heave;
      shot.fov = a.fov + b.fov;
      shot.pitch = a.pitch + b.pitch;
      shot.push = a.push + b.push;
      shot.yaw = (b.yaw ?? 0) + whale.followYaw;
      rig.update(dt, t, state.depth, shot);
      const meters = metersBelowSurface(rig.baseY);
      state.meters = meters;
      // How fast the camera travels (scene units / s), smoothed: fast travel stirs up the bioluminescence.
      if (lastY !== null && dt > 0) speed += (Math.abs(rig.baseY - lastY) / dt - speed) * Math.min(1, dt * 4);
      lastY = rig.baseY;

      sampleDepthColor(meters, water);
      scene.background.copy(water);
      scene.fog.color.copy(water);
      scene.fog.density = fogDensityAt(meters);

      atmosphere.update({
        time: t,
        camera,
        pointer: rig.atmosphere,
        waterColor: water,
        fogDensity: scene.fog.density,
        meters,
      });
      const u = atmosphere.uniforms;
      const under = u.uUnder.value;
      const light = sunlightAt(meters);
      absorptionColor(meters, absorb);

      sky.update(camera);
      lights.update(meters, camera.position);
      environment.update(dt);
      shafts.update({ under, meters, rayDir: u.uRayDir.value });

      // Floating particles and bubbles take the colour of the light left at this depth.
      snowTint.setRGB(0.81 * absorb.r, 0.96 * absorb.g, absorb.b);
      for (const layer of [snow, plankton]) {
        layer.setVisibility(under); // no floating dust above the waves
        layer.setTint(snowTint, light);
        layer.setDensity(state.fx.snow);
        layer.update(dt, t, camera.position);
      }
      bubbleTint.setRGB(0.8 * absorb.r, 0.95 * absorb.g, absorb.b).multiplyScalar(0.35 + 0.65 * light);
      bubbleFx.update(renderer?.domElement?.height ?? 720, bubbleTint);
      // Crossing the waterline. Going under: a burst of bubbles (and, in the app, a splash and a veil of light).
      // Coming back up: only the veil of light (bubbles would hang in the air).
      const isUnder = under > 0.5;
      if (isUnder !== wasUnder) {
        wasUnder = isUnder;
        if (t - lastCross > BURST_GAP) {
          if (isUnder) state.fx.burstId += 1;
          else state.fx.breachId += 1;
        }
        lastCross = t;
      }
      if (state.fx.burstId !== lastBurst) {
        lastBurst = state.fx.burstId;
        burst.burst(camera.position); // the plunge: a burst of bubbles around the camera
      }
      burst.update(dt, t);
      streams.update(dt, t, camera.position, under * state.fx.snow);

      const vh = renderer?.domElement?.height ?? 720;
      glow.update(t, meters, camera.position, vh, speed, under);
      whale.update(dt, t, state.fx.whale, meters, camera.position);
      vents.update(t, meters, vh);
      jellies.update(dt, t, meters, under);
      bloomAmount = smoothstep(250, 650, meters) * under;
    },
    render() {
      bloom.render(bloomAmount);
    },
    resize(width, height, pixelRatio) {
      bloom.setSize(width, height, pixelRatio);
    },
    warm() {
      bloom.warm();
    },
    setQuality(next) {
      snow.setCount(next.particleCount);
      plankton.setCount(Math.round(next.particleCount * next.underwater.plankton));
      streams.setLimit(next.underwater.streams);
      shafts.setQuality(next);
      sky.setQuality(next);
      surface.setQuality(next);
      glow.setCount(next.story.glow);
      vents.setQuality(next);
      jellies.setQuality(next);
      bloom.setQuality(next);
    },
    dispose() {
      rig.dispose();
      jellies.dispose();
      bloom.dispose();
    },
  };
}
