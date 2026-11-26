import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { clamp, smoothstep } from '@/utils/math';
import { sharkGeometry, hitSpheres, MODEL_LENGTH, SNOUT_X } from './geometry';
import { skinUniforms, skinMaterial } from './skin';
import { createWake, createBurst } from './particles';

/*
 * The megalodon encounter: night mode only, in the dark of the twilight zone around the bioluminescence
 * chapter (~900 m). (A creative choice for the dive: the fossil record puts it mostly in warm coastal and open
 * surface seas; the information card says so.)
 *
 * The night restriction lives here, in one place: an encounter can only begin while the mode is 'night' and
 * the night has fully come in (state.env.night ~1), underwater, within ZONE metres. The moment any of that stops
 * being true (switching to day, scrolling away, surfacing) the encounter is called off: every event still to
 * come is dropped, the warning and hint go, the camera eases back, the sound fades, and the shark dissolves
 * into the dark water over about a second (mixed to the fog colour, no transparency). Then nothing of it is
 * drawn or updated. The audio engine checks the mode again before it plays anything of the encounter.
 *
 * The first encounter of a visit is the cinematic one (SCRIPTS.first): a shadow far off in the dark, a slow
 * approach, the warning, the face coming into the lamp's light, a sudden rush at the camera (shake, a push,
 * the edges blurring, a darkening, stirred-up sparks, the impact sound), then it turns broadside past the lens,
 * its tail sweeping, and swims off into the dark. Later ones are natural passes at a distance (SCRIPTS.passes).
 *
 * The shark's path is set relative to the camera (smoothed), so scrolling a little during the encounter does
 * not spoil it. The camera turns partway to follow it (`followYaw`, `followPitch`), like the whale chapter.
 *
 * Talks to the interface only through `state.encounter` (see appState.js): flags for the warning and the hint,
 * counters bumped for each sound / effect cue, `tension` for the low drone, and `card` when it is tapped.
 */
const ZONE = [700, 1300]; // metres: where it may be met
const CORE = [800, 1120]; // where an encounter may begin
const DWELL = 1.4; // seconds in CORE before it begins
const COOLDOWN = 35; // seconds between the end of one and the start of the next
// How big it is drawn. The scene has no single metric scale (the dive's depth is compressed about twenty to one to fit
// the scroll, and the jellyfish are large), so its size is set against what is around it: a 17 m animal (the
// published estimates for large adults are about 15 - 20 m) at 1.6 units per metre: ~27 units from snout to tail
// tip, half again the whale's length. The whole model scales evenly, so its proportions stay as they are.
const LENGTH_M = 17;
const UNITS_PER_M = 1.6;
const SCALE = (LENGTH_M * UNITS_PER_M) / MODEL_LENGTH;
const SNOUT = SNOUT_X * SCALE; // from its centre to the tip of its snout, in scene units
const FAR = 52; // the far level of detail beyond this distance (a silhouette in the fog)
const ABORT_FADE = 1.0; // seconds to dissolve when called off
const MAX_WAKE = QUALITY_LEVELS.high.story.megalodon.wake;
const MAX_BURST = QUALITY_LEVELS.high.story.megalodon.burst;

// Keyframes: [seconds, x, y, z] relative to the camera, world axes (the camera looks down -z). The shark's
// centre; its snout is SNOUT (~12.8) ahead of it, its tail tip ~14.4 behind. At the closest moment the snout stops
// ~1.8 from the lens (the head then fills nearly the whole frame) and the shark turns away about its centre, so
// its head swings aside instead of coming on; broadside, its flank passes ~9 away and fills the width of the
// screen. Nothing of it comes closer than about 1.6 units (measured with trackClearance in development).
const SCRIPTS = {
  first: {
    keys: [
      [0, 44, -12, -104],
      [4.5, 22, -6, -66], // a vast shadow far off
      [8, 7, -2.4, -40],
      [10, 1.6, -0.5, -29],
      [10.6, 1.5, 0.1, -21.2], // the rush, straight at the lens
      [11, 1.35, 0.25, -14.5], // the snout ~1.8 from the lens: the head fills nearly the whole frame
      [11.35, 0.5, 0.3, -14.3], // at the last moment it veers: the head swings aside (under the impact's darkening)
      [11.8, -3.8, 0.2, -13.6],
      [12.4, -8.8, 0, -12.2],
      [12.9, -12.6, -0.2, -11.4], // broadside: the flank ~9 away, the tail sweeping past in front of the lens
      [14.4, -24, -1.6, -13],
      [17, -36, -6, -29],
      [20, -44, -13, -46],
    ],
    events: [[6.8, 'warning'], [9.9, 'rush'], [11.0, 'impact'], [12.3, 'pass']],
    warnFor: 3.0,
    jaw: [[0, 0], [9.4, 0], [10.6, 0.6], [11.5, 0.5], [12.8, 0.05]],
    tension: [[0, 0], [3, 0.15], [6.5, 0.45], [10, 0.85], [11, 1], [13, 0.6], [17, 0.2], [20, 0]],
    follow: [[0, 0.2], [5, 0.5], [9.6, 0.5], [10.6, 0.15], [12, 0.6], [17, 0.55], [20, 0]],
    zoom: [[9.4, 0], [10.8, -7], [11.5, -7], [12.8, 0]], // the lens narrows a little as it rushes in: the head fills the frame
    hint: [12.6, 19.5],
    end: 20.5,
  },
  passes: [
    {
      keys: [[0, 62, -9, -82], [6, 30, -4, -50], [10, 6, -2.5, -35], [14, -20, -3.5, -35], [19, -46, -9, -45]],
      events: [[5, 'warning'], [10.2, 'pass']],
      warnFor: 2.6,
      jaw: [[0, 0]],
      tension: [[0, 0], [5, 0.35], [10, 0.55], [15, 0.3], [19, 0]],
      follow: [[0, 0.2], [6, 0.45], [15, 0.45], [19, 0]],
      hint: [6, 17],
      end: 19.5,
    },
    {
      keys: [[0, 42, -26, -82], [7, 16, -10, -40], [11, 0, -7, -26], [14.5, -19, -6, -28], [19, -44, -4, -44]],
      events: [[5.5, 'warning'], [11, 'pass']],
      warnFor: 2.6,
      jaw: [[0, 0]],
      tension: [[0, 0], [6, 0.35], [11, 0.6], [15, 0.3], [19, 0]],
      follow: [[0, 0.15], [7, 0.45], [15, 0.45], [19, 0]],
      hint: [7, 17],
      end: 19.5,
    },
  ],
};

/** Piecewise-linear envelope [[t, v], ...]. */
function envelope(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const [t0, v0] = points[i - 1];
      const [t1, v1] = points[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

/** Position on the keyframes at time t: cubic Hermite in time (smooth speed through every key). */
function sampleKeys(keys, t, out) {
  const n = keys.length;
  const P = (i, c) => keys[clamp(i, 0, n - 1)][c + 1];
  const T = (i) => keys[clamp(i, 0, n - 1)][0];
  const tangent = (i, c) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    return (P(b, c) - P(a, c)) / (T(b) - T(a));
  };
  if (t >= T(n - 1)) {
    const dt = t - T(n - 1);
    return out.set(P(n - 1, 0) + tangent(n - 1, 0) * dt, P(n - 1, 1) + tangent(n - 1, 1) * dt, P(n - 1, 2) + tangent(n - 1, 2) * dt);
  }
  let i = 0;
  while (i < n - 2 && t > T(i + 1)) i++;
  const h = T(i + 1) - T(i);
  const s = clamp((t - T(i)) / h, 0, 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const v = [0, 1, 2].map((c) => h00 * P(i, c) + h10 * h * tangent(i, c) + h01 * P(i + 1, c) + h11 * h * tangent(i + 1, c));
  return out.set(v[0], v[1], v[2]);
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createMegalodon(scene, camera, renderer, state, settings) {
  let tier = settings.story.megalodon;
  const uniforms = skinUniforms();
  const material = skinMaterial(uniforms, tier.detail);
  const near = new THREE.Mesh(sharkGeometry(tier.near), material);
  const far = new THREE.Mesh(sharkGeometry(tier.far), material);
  for (const m of [near, far]) m.frustumCulled = false; // the tail's sweep leaves the bounding sphere
  const lod = new THREE.LOD();
  lod.addLevel(near, 0);
  lod.addLevel(far, FAR);
  const wake = createWake(MAX_WAKE, tier.wake);
  const group = new THREE.Group();
  group.rotation.order = 'YZX'; // heading, then nose up / down, then the roll
  group.scale.setScalar(SCALE);
  group.add(lod, wake.points);
  const burst = createBurst(MAX_BURST, tier.burst);
  scene.add(group, burst.points);

  // Drawn black into the bloom pass, so the glow of what is behind it does not shine through.
  const markOccluder = (mesh, glowLayer) => {
    mesh.onBeforeRender = (r, s, cam) => {
      const pass = cam.layers.mask === 1 << glowLayer ? 1 : 0;
      if (uniforms.uGlowPass.value !== pass) {
        uniforms.uGlowPass.value = pass;
        material.uniformsNeedUpdate = true;
      }
    };
  };

  const enc = state.encounter;
  const api = {
    group,
    glowing: [wake.points, burst.points],
    occluders: [near, far],
    followYaw: 0,
    followPitch: 0,
    fovKick: 0,
    markOccluder,
  };

  // ---- the running encounter ----
  let script = null;
  let time = 0;
  let aborting = 0; // > 0 while being called off (seconds since)
  let endFade = 0;
  let firstDone = false; // the cinematic one reached its rush
  let cooldown = 0;
  let dwell = 0;
  let passIndex = 0;
  let warnUntil = -1;
  let yaw = 0;
  let pitch = 0;
  let swim = 0;
  let flow = 0;
  let shake = 0;
  let impactAge = 99;
  let lastBaseY = 0;
  let zoomNow = 0;
  const anchor = new THREE.Vector3();
  const local = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const behind = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();

  function clearInterface() {
    enc.warning = false;
    enc.hint = false;
    enc.tension = 0;
    warnUntil = -1;
  }

  function start(kind) {
    script = kind === 'first' ? SCRIPTS.first : SCRIPTS.passes[passIndex++ % SCRIPTS.passes.length];
    time = 0;
    aborting = 0;
    endFade = 0;
    impactAge = 99;
    anchor.set(camera.position.x, lastBaseY, camera.position.z);
    sampleKeys(script.keys, 0, local);
    sampleKeys(script.keys, 0.1, vel).sub(local);
    yaw = Math.atan2(-vel.z, vel.x);
    pitch = 0;
    enc.active = true;
    enc.kind = kind;
    enc.count += 1;
  }

  function finish() {
    script = null;
    enc.active = false;
    enc.kind = null;
    enc.phase = 'idle';
    clearInterface();
    cooldown = COOLDOWN;
    group.visible = false;
    burst.points.visible = false;
    renderer.domElement.style.cursor = '';
  }

  /** Called off (day mode, scrolled away, surfaced): drop what is still to come and dissolve. */
  function abort() {
    if (!script || aborting > 0) return;
    aborting = 1e-4;
    clearInterface();
    enc.phase = 'leaving';
  }

  function fire(type) {
    if (type === 'warning') {
      enc.warning = true;
      enc.warningId += 1;
      warnUntil = time + script.warnFor;
    } else if (type === 'rush') enc.rushId += 1;
    else if (type === 'pass') enc.passId += 1;
    else if (type === 'impact') {
      enc.impactId += 1;
      firstDone = true;
      impactAge = 0;
      shake = 1;
      // Sparks and silt thrown up just in front of the lens, shoved the way the shark turns.
      camera.getWorldDirection(tmp);
      burst.uniforms.uOrigin.value.copy(camera.position).addScaledVector(tmp, 1.6);
      burst.uniforms.uPush.value.set(-1.6, 0.2, 0.6);
      burst.uniforms.uAge.value = 0;
      burst.points.visible = true;
    }
  }

  // Development: the nearest any vertex comes to the camera (the bend of the swim is left out: under 1 unit).
  const probe = new THREE.Vector3();
  function measureClearance() {
    group.updateMatrixWorld();
    const pos = near.geometry.attributes.position;
    let min = Infinity;
    for (let i = 0; i < pos.count; i++) min = Math.min(min, probe.fromBufferAttribute(pos, i).applyMatrix4(group.matrixWorld).distanceTo(camera.position));
    if (min < api.clearance.min) Object.assign(api.clearance, { min, at: time });
  }
  function inFrame() {
    group.updateMatrixWorld();
    for (const x of [6, 2, -2, -6]) {
      probe.set(x, 0, 0).applyMatrix4(group.matrixWorld).project(camera);
      if (Math.abs(probe.x) < 0.92 && Math.abs(probe.y) < 0.92 && probe.z < 1) return true;
    }
    return false;
  }
  api.clearance = { min: Infinity, at: 0 };
  api.trackClearance = false;
  api.frozen = false;

  // ---- tapping it opens the information card ----
  const spheres = hitSpheres();
  const ray = new THREE.Ray();
  const inv = new THREE.Matrix4();
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  function hits(clientX, clientY) {
    if (!script || aborting > 0 || uniforms.uVanish.value > 0.6 || !group.visible) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    group.updateMatrixWorld();
    inv.copy(group.matrixWorld).invert();
    ray.copy(raycaster.ray).applyMatrix4(inv);
    for (const s of spheres) {
      tmp.set(s.x, s.y, 0);
      if (ray.distanceSqToPoint(tmp) < s.r * s.r) return true;
    }
    return false;
  }
  let down = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved < 12 && quick && hits(e.clientX, e.clientY)) enc.card = true;
  };
  const onMove = (e) => {
    if (e.pointerType !== 'mouse') return;
    renderer.domElement.style.cursor = hits(e.clientX, e.clientY) ? 'pointer' : '';
  };
  const el = renderer.domElement;
  el.addEventListener('pointerdown', onDown, { passive: true });
  el.addEventListener('pointerup', onUp, { passive: true });
  el.addEventListener('pointermove', onMove, { passive: true });

  return Object.assign(api, {
    setQuality(next) {
      const old = tier;
      tier = next.story.megalodon;
      wake.setCount(tier.wake);
      burst.setCount(tier.burst);
      if (material.defines.SKIN_DETAIL !== (tier.detail ? 1 : 0)) {
        material.defines.SKIN_DETAIL = tier.detail ? 1 : 0;
        material.needsUpdate = true;
      }
      if (old.near.rings !== tier.near.rings || old.near.teeth !== tier.near.teeth) {
        near.geometry.dispose();
        near.geometry = sharkGeometry(tier.near);
      }
      if (old.far.rings !== tier.far.rings) {
        far.geometry.dispose();
        far.geometry = sharkGeometry(tier.far);
      }
    },

    /**
     * meters / under: the camera's depth and how far under it is; night: state.env.night (eased);
     * baseY: the camera's height without its hand-held wobble.
     */
    update(dt, t, { meters, under, night, baseY, viewportHeight }) {
      const isNight = state.mode === 'night' && night > 0.98;
      const allowed = state.mode === 'night' && night > 0.5 && under > 0.6 && meters >= ZONE[0] && meters <= ZONE[1];
      const calm = !!state.calmMotion;
      lastBaseY = baseY;

      if (!script) {
        group.visible = false; // nothing of it is drawn between encounters (and never by day)
        cooldown = Math.max(0, cooldown - dt);
        const ready = isNight && allowed && meters >= CORE[0] && meters <= CORE[1] && cooldown <= 0;
        dwell = ready ? dwell + dt : 0;
        if (dwell >= DWELL) { dwell = 0; start(firstDone ? 'pass' : 'first'); }
      }
      if (script && !allowed) abort();

      // Camera effects ease out whatever happens.
      shake *= Math.exp(-dt * 5.5);
      impactAge += dt;
      const kick = impactAge < 3 ? Math.exp(-impactAge * 3.2) * Math.min(1, impactAge * 18) : 0;
      const zoom = script?.zoom && aborting === 0 ? envelope(script.zoom, time) : 0;
      zoomNow += (zoom * (calm ? 0.5 : 1) - zoomNow) * (1 - Math.exp(-dt * 4));
      api.fovKick = (calm ? 0 : kick * 5) + zoomNow;
      api.kick = calm ? 0 : kick;
      api.shake = calm ? 0 : shake;

      if (burst.points.visible) {
        burst.uniforms.uAge.value += dt;
        burst.uniforms.uScale.value = viewportHeight * 0.5;
        if (burst.uniforms.uAge.value > 2.2) burst.points.visible = false;
      }

      let yawTarget = 0;
      let pitchTarget = 0;
      if (script) {
        const prev = time;
        if (!api.frozen) time += dt; // frozen: development screenshots only
        if (aborting > 0) aborting += dt;
        else {
          for (const [at, type] of script.events) if (prev < at && time >= at) fire(type);
          if (warnUntil > 0 && time >= warnUntil) { enc.warning = false; warnUntil = -1; }
          enc.tension = Math.round(envelope(script.tension, time) * 50) / 50; // in steps: the drone needs no more
          enc.phase = time < 6.5 ? 'shadow' : time < 10 ? 'approach' : time < 12 ? 'close' : 'leaving';
        }

        // Follow the camera, smoothly (its drift and a little scrolling).
        const k = 1 - Math.exp(-dt * 1.5);
        anchor.x += (camera.position.x - anchor.x) * k;
        anchor.z += (camera.position.z - anchor.z) * k;
        anchor.y += (baseY - anchor.y) * (1 - Math.exp(-dt * 3));

        sampleKeys(script.keys, time, local);
        group.position.copy(anchor).add(local);
        sampleKeys(script.keys, time + 0.05, ahead);
        sampleKeys(script.keys, time - 0.05, behind);
        vel.subVectors(ahead, behind).divideScalar(0.1);
        const speed = vel.length();

        // Heading: along its path, eased; the body curves into turns and banks a little.
        const targetYaw = Math.atan2(-vel.z, vel.x);
        const dYaw = wrap(targetYaw - yaw) * (1 - Math.exp(-dt * 6));
        yaw = wrap(yaw + dYaw);
        const yawRate = dt > 0 ? dYaw / dt : 0;
        const targetPitch = Math.asin(clamp(vel.y / Math.max(speed, 1e-3), -0.6, 0.6));
        pitch += (targetPitch - pitch) * (1 - Math.exp(-dt * 3));
        // A big animal beats its tail slowly: the rate follows its speed in body lengths, not in units.
        swim += dt * (1.0 + 0.2 * Math.min(speed / SCALE, 12));
        group.rotation.set(clamp(-yawRate * 0.22, -0.35, 0.35) + Math.sin(t * 0.3) * 0.03, yaw, pitch + Math.sin(swim + 1.1) * 0.012);
        uniforms.uSwim.value = swim;
        uniforms.uAmp.value = 0.3 + 0.02 * Math.min(speed / SCALE, 12);
        uniforms.uTurn.value += (clamp(-yawRate * 1.1, -1.2, 1.2) - uniforms.uTurn.value) * (1 - Math.exp(-dt * 4));
        uniforms.uJaw.value = envelope(script.jaw, time);

        const dist = group.position.distanceTo(camera.position);
        const headDist = Math.max(0, dist - SNOUT * 0.8); // roughly, when it comes head-on
        // Dissolving: at the end of the script, when called off, and with the night (day mode never shows it).
        if (time > script.end - 2.5) endFade = smoothstep(script.end - 2.5, script.end, time);
        const abortFade = aborting > 0 ? smoothstep(0, ABORT_FADE, aborting) : 0;
        const vanish = Math.max(endFade, abortFade, 1 - smoothstep(0.55, 0.95, night));
        uniforms.uVanish.value = vanish;
        uniforms.uEyeShine.value = smoothstep(24, 7, headDist) * (1 - vanish);
        camera.updateMatrixWorld();
        uniforms.uViewUp.value.copy(up).transformDirection(camera.matrixWorldInverse);

        flow += dt * (0.04 + 0.006 * Math.min(speed, 14));
        wake.uniforms.uFlow.value = flow;
        wake.uniforms.uTime.value = t;
        wake.uniforms.uScale.value = viewportHeight * 0.5;
        wake.uniforms.uGlow.value = (0.45 + 0.55 * smoothstep(60, 18, dist)) * (0.3 + 0.7 * smoothstep(8, 18, dist)) * (1 - vanish);
        group.visible = vanish < 0.999;
        if (api.trackClearance && group.visible) measureClearance();
        // "Tap the megalodon" only while some of it is really in the frame (a phone's narrow view loses it sooner).
        enc.hint = aborting === 0 && time >= script.hint[0] && time <= script.hint[1] && vanish < 0.6 && inFrame();

        // The camera turns partway to keep it in frame (never fully: it leads the frame, as with the whale).
        if (aborting === 0) {
          tmp.subVectors(group.position, camera.position);
          const w = envelope(script.follow, time) * (calm ? 0.5 : 1) * (camera.aspect < 1 ? 1.4 : 1);
          yawTarget = clamp(Math.atan2(-tmp.x, -tmp.z), -1.0, 1.0) * w;
          pitchTarget = clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.3, 0.3) * 0.5 * w;
        }

        if ((aborting > 0 && aborting >= ABORT_FADE) || time >= script.end) finish();
      }
      const kf = 1 - Math.exp(-dt * 1.6);
      api.followYaw += (yawTarget - api.followYaw) * kf;
      api.followPitch += (pitchTarget - api.followPitch) * kf;
    },

    /** After the camera rig has placed the camera: the shake and the push of the impact (none with calm motion). */
    applyCamera(t) {
      const s = api.shake;
      const k = api.kick;
      if (s < 0.002 && k < 0.002) return;
      camera.position.x += (Math.sin(t * 37.0) * 0.6 + Math.sin(t * 23.0 + 1.3) * 0.4) * 0.16 * s;
      camera.position.y += (Math.sin(t * 31.0 + 0.7) * 0.6 + Math.sin(t * 19.0) * 0.4) * 0.12 * s;
      camera.position.z += 0.45 * k; // knocked back
      camera.rotation.x += (Math.sin(t * 29.0 + 2.1) * 0.022 * s) + 0.035 * k;
      camera.rotation.z += Math.sin(t * 27.0 + 0.4) * 0.02 * s;
    },

    // Development / tests (window.__ocean.megalodon): start an encounter or jump inside the current one.
    debugStart(kind = 'first') { start(kind); },
    debugSeek(seconds) { if (script) time = seconds; },
    debugInfo() { return { time, aborting, kind: enc.kind, vanish: uniforms.uVanish.value, visible: group.visible, firstDone, cooldown }; },

    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
    },
  });
}
