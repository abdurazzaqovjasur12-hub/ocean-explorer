import { cameraYAtDepth, SURFACE_BLEND } from '@/config/zones';
import { prefersReducedMotion } from '@/utils/motion';
import { lerp, smoothstep } from '@/utils/math';

const NO_SHOT = { idle: 0, heave: 0, fov: 0, pitch: 0, push: 0, yaw: 0, x: 0 };

/**
 * Places the camera from the current depth: a low, cinematic view across the water at the surface
 * that becomes the underwater view as the dive begins. Adds gentle swell motion, slow underwater drift
 * and pointer parallax. After each update `baseY` is the camera's intended height without the hand-held
 * wobble: the depth counter reads it.
 * `shot` ({ idle, heave, fov, pitch, push, yaw, x: sideways truck }) is the direction from the GSAP timelines (scroll story plus arrival).
 * `atmosphere` (smoothed pointer plus movement energy) is shared with the sky and water shaders.
 */
export function createCameraRig(camera, { enablePointer = true } = {}) {
  const pointer = { x: 0, y: 0 };
  const atmosphere = { x: 0, y: 0, energy: 0 };
  const sway = prefersReducedMotion() ? 0 : 1;
  let last = null;
  const rig = { atmosphere, baseY: 0 };

  const onMove = (e) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    if (last) atmosphere.energy = Math.min(1, atmosphere.energy + Math.hypot(nx - last.x, ny - last.y) * 6);
    last = { x: nx, y: ny };
    pointer.x = nx;
    pointer.y = ny;
  };
  if (enablePointer) window.addEventListener('pointermove', onMove, { passive: true });

  return Object.assign(rig, {
    update(dt, t, depth, shot = NO_SHOT) {
      const k = Math.min(1, dt * 3);
      atmosphere.x += (pointer.x - atmosphere.x) * k;
      atmosphere.y += (pointer.y - atmosphere.y) * k;
      atmosphere.energy *= Math.exp(-dt * 1.6);

      // Above water the horizon sits about 38% from the top of the frame; underwater the view tips up
      // a little so the bright window to the sky is visible, then settles level as the light fades.
      const blend = smoothstep(0, SURFACE_BLEND, depth);
      const baseFov = camera.aspect < 1 ? 72 : 58; // same rule as SceneManager.resize
      const halfFov = Math.tan((baseFov * Math.PI) / 360);
      const abovePitch = -Math.atan(0.24 * halfFov);
      // Underwater the view tips up a little so the beams and the surface stay in frame, easing level with depth.
      const belowPitch = -0.02 + 0.28 * Math.exp(-depth / 160);
      const pitch = lerp(abovePitch, belowPitch, blend);

      // Idle drift: several slow, unrelated sine waves so the shot never visibly repeats.
      const w = shot.idle * sway;
      const driftX = (Math.sin(t * 0.07) * 1.6 + Math.sin(t * 0.031 + 1.3) * 0.9) * w;
      const driftY = Math.sin(t * 0.11) * 0.28 * w;
      const driftZ = -(1 + Math.sin(t * 0.05)) * 1.6 * w; // slow push in and out
      const driftYaw = Math.sin(t * 0.045 + 0.6) * 0.045 * w;
      const driftPitch = Math.sin(t * 0.06) * 0.012 * w;
      const driftRoll = Math.sin(t * 0.08) * 0.01 * w;

      // Where the camera is meant to be, and how far under the water that puts it (same rule as the shaders and audio).
      const baseY = cameraYAtDepth(depth) + shot.heave;
      rig.baseY = baseY;
      const under = 1 - smoothstep(-2.0, -0.9, baseY);

      // Underwater drift: a diver hanging in the water. Slow, unrelated sines, so it never visibly repeats.
      const u = under * sway;
      const dvX = (Math.sin(t * 0.09) * 0.55 + Math.sin(t * 0.037 + 2.0) * 0.35) * u;
      const dvY = (Math.sin(t * 0.13 + 1.0) * 0.05 + Math.sin(t * 0.052) * 0.03) * u;
      const dvZ = Math.sin(t * 0.061 + 0.5) * 0.4 * u;
      const dvYaw = Math.sin(t * 0.05 + 0.8) * 0.028 * u;
      const dvPitch = Math.sin(t * 0.071 + 2.2) * 0.01 * u;
      const dvRoll = Math.sin(t * 0.066) * 0.012 * u;
      // Parallax: with a mouse the camera itself shifts a little, so near and far things slide past each other.
      const parX = atmosphere.x * 0.55 * under;
      const parY = -atmosphere.y * 0.22 * under;
      const bob = 0.08 * (1 - 0.6 * under); // the swell bob calms down underwater

      camera.position.set(
        Math.sin(t * 0.2) * 0.35 * sway + driftX + dvX + parX + (shot.x || 0),
        baseY + Math.sin(t * 0.5) * bob * sway + driftY + dvY + parY,
        driftZ - shot.push + dvZ,
      );
      camera.rotation.set(
        pitch + shot.pitch + driftPitch + dvPitch - atmosphere.y * 0.03,
        -atmosphere.x * 0.06 + driftYaw + dvYaw + (shot.yaw || 0),
        Math.sin(t * 0.23) * 0.004 * sway * (1 - blend) + driftRoll + dvRoll,
      );

      const fov = baseFov + shot.fov;
      if (Math.abs(camera.fov - fov) > 1e-3) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    dispose() {
      window.removeEventListener('pointermove', onMove);
    },
  });
}
