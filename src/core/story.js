import gsap from '@/core/gsap';
import { CHAPTERS, CHAPTER_STARTS, STORY_LENGTH, LEAD } from '@/config/story';

const at = (id) => {
  const i = CHAPTERS.findIndex((c) => c.id === id);
  return { s: CHAPTER_STARTS[i], L: CHAPTERS[i].length, c: CHAPTERS[i] };
};

/**
 * The whole expedition as one paused GSAP timeline, scrubbed by ScrollTrigger (see useStoryScroll).
 * Its time is measured in screens of scrolling (config/story.js), so the timeline and the page agree.
 *
 * It drives the dive parameter (`state.depth`), the scroll camera (`state.cam`: idle drift weight, heave,
 * extra fov, pitch, dolly), the dive effects (`state.fx`), the intro fading away, the depth gauge and the
 * cinematic text of each chapter. Every property is animated by one tween at a time (no two tweens on the
 * same property overlap), so scrubbing backwards retraces exactly the same path.
 *
 *   surface   0.00 - 0.70   intro on screen, slow idle drift; the intro lifts away as scrolling begins
 *   descent   0.70 - 1.70   look down, lower, lean in; one eased plunge through the surface to 150 m;
 *                           tilt up to watch the surface recede, level out; snow and gauge fade in
 *   shallows  1.70 - 2.60   220 -> 320 m among the light shafts
 *   glow      2.60 - 3.70   850 -> 1000 m among the jellyfish; slow push-in with a gentle pan
 *   whale     3.70 - 5.10   1700 -> 1850 m; the whale's pass is tied to the scroll (fx.whale), the camera follows it
 *   vents     5.10 - 6.30   2950 -> 3050 m: looks down onto the vent field, then a slow orbit and push across it
 *   abyss     6.30 - 7.50   9800 -> 10,900 m (Challenger Deep): sparse, dark, a floodlight and a distant light; a vast
 *                           silhouette glides across (fx.abyss); slow creep forward and pan; narrower lens
 *   return    7.50 - 9.10   the climb home with rising bubbles, a slow approach to the bright surface, breaking
 *                           through, settling on the swell; the end screen with Replay / Explore again
 */
export function createStoryTimeline({ state, intro, gauge, beats, end: endScreen, blurTitles = true }) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'sine.inOut' } });
  const cam = state.cam;

  // ---- 1. Ocean surface: the intro lifts away and the idle drift winds down. ----
  if (intro) tl.to(intro, { autoAlpha: 0, y: -36, duration: 0.42, ease: 'power1.in' }, 0.16);
  tl.to(cam, { idle: 0, duration: 1, ease: 'power1.inOut' }, 0.3);

  // ---- 2. Descent: the old START EXPEDITION dive, now played by the scroll. ----
  tl.to(cam, { heave: -2.2, fov: 6, push: 2.2, duration: 0.6, ease: 'power2.inOut' }, 0.45);
  tl.to(cam, { pitch: -0.3, duration: 0.55, ease: 'power2.inOut' }, 0.45); // look at the water
  tl.to(state, { depth: 150, duration: 0.95, ease: 'power2.inOut' }, 0.6); // crosses the surface around 1.05
  tl.to(cam, { pitch: 0.28, duration: 0.35, ease: 'power2.inOut' }, 1.0); // look up at the receding surface
  tl.to(cam, { pitch: 0, duration: 0.4 }, 1.35);
  // The lowered camera comes back up while the descent is fastest, so the camera itself only ever sinks.
  tl.to(cam, { heave: 0, duration: 0.35 }, 1.1);
  tl.to(cam, { fov: 0, push: 0, duration: 0.5, ease: 'power2.inOut' }, 1.1);
  tl.to(state.fx, { snow: 1, duration: 0.4, ease: 'power1.inOut' }, 1.1);
  if (gauge) tl.to(gauge, { autoAlpha: 1, duration: 0.2, ease: 'power1.out' }, 1.1);

  // ---- 3-7. Underwater chapters: eased travel to each depth, then a slow drift while the text shows. ----
  for (const id of ['shallows', 'glow', 'whale', 'vents', 'abyss']) {
    const { s, L, c } = at(id);
    tl.to(state, { depth: c.depth[0], duration: L * 0.32 + LEAD, ease: 'power2.inOut' }, s - LEAD);
    tl.to(state, { depth: c.depth[1], duration: L * 0.68 - LEAD }, s + L * 0.32);
  }

  // Whale: its journey (out of the fog, across in front of the camera, away into the fog) is scrubbed by the
  // scroll; the scene adds the tail beat, the glide and the camera's turn to follow it. The lens lengthens a
  // little as it comes close, and opens again as it leaves, ready for the drop to the vents.
  {
    const { s, L } = at('whale');
    tl.to(state.fx, { whale: 1, duration: L - 0.15, ease: 'none' }, s + 0.05);
    tl.to(cam, { fov: -5, duration: L * 0.4 }, s + 0.25);
    tl.to(cam, { fov: 0, duration: L * 0.3 - 0.05 }, s + L * 0.7);
  }
  // Bioluminescence: a slow glide in among the jellyfish, panning gently to the right, then settling back
  // for the drop to the whale.
  {
    const { s, L } = at('glow');
    tl.to(cam, { push: 2.6, yaw: -0.1, duration: L - 0.25 }, s + 0.05);
    tl.to(cam, { push: 0, yaw: 0, duration: 0.3 }, s + L - 0.15);
  }
  // Vents: the glow below draws the eye down while the camera is still descending from the whale; it slides
  // sideways as it arrives, then glides across and in over the ridge, turning to keep the chimneys in frame
  // (an orbit), and lifts its gaze a little. Everything is back to neutral just before the drop to the abyss
  // passes the ridge (around s + L - 0.07), so the camera never ends up inside the rock.
  {
    const { s, L } = at('vents');
    tl.to(cam, { pitch: -0.27, duration: 0.4 }, s - 0.08);
    tl.to(cam, { pitch: -0.15, duration: L - 0.65 }, s + 0.4);
    tl.to(cam, { pitch: 0, duration: 0.3 }, s + L - 0.22);
    tl.to(cam, { x: -4, yaw: -0.13, duration: 0.42, ease: 'power1.inOut' }, s - 0.12);
    tl.to(cam, { x: 4, yaw: 0.13, duration: L - 0.55 }, s + 0.3);
    tl.to(cam, { x: 0, yaw: 0, duration: 0.33 }, s + L - 0.25);
    tl.to(cam, { push: 3, duration: L - 0.55, ease: 'power1.inOut' }, s + 0.1);
    tl.to(cam, { push: 0, duration: 0.3 }, s + L - 0.45);
  }
  // Abyss: a slightly longer lens, the world closing in. The snow thins out; the camera creeps forward and
  // pans very slowly after the giant crossing in front of the distant light (fx.abyss); then everything eases
  // back to neutral for the long climb home.
  {
    const { s, L } = at('abyss');
    tl.to(cam, { fov: -4, duration: 0.4 }, s);
    tl.to(cam, { fov: 0, duration: 0.3 }, s + L - 0.1);
    tl.to(state.fx, { snow: 0.35, duration: 0.4, ease: 'power1.inOut' }, s - 0.1);
    tl.to(state.fx, { snow: 1, duration: 0.3, ease: 'power1.inOut' }, s + L - 0.1);
    tl.to(state.fx, { abyss: 1, duration: L - 0.05, ease: 'none' }, s);
    tl.to(cam, { push: 3.5, duration: L - 0.4 }, s + 0.05);
    tl.to(cam, { push: 0, duration: 0.25 }, s + L - 0.3);
    tl.to(cam, { yaw: -0.12, duration: L - 0.4, ease: 'sine.inOut' }, s + 0.1);
    tl.to(cam, { yaw: 0, duration: 0.3 }, s + L - 0.3);
    tl.to(cam, { pitch: -0.06, duration: 0.4 }, s + 0.1);
    tl.to(cam, { pitch: 0, duration: 0.3 }, s + L - 0.35);
  }

  // ---- 8. Return to surface ----
  // A fast climb out of the deep with bubbles rising alongside; the sunlight comes back and the fog thins on
  // their own as the depth drops (depthPalette.js). From 300 m it slows: the camera looks up at the bright
  // window of the surface and rises towards it, gathering speed, breaks through (veil of light), bobs up and
  // settles on the swell, and the end screen comes up over the open sea.
  //
  //   s - 0.12 .. s + 0.55   10,900 -> 300 m, looking up; bubbles (fx.ascent)
  //   s + 0.55 .. s + 1.15   300 -> 0 m, slowly then faster, gazing at the light; breaks the surface ~s + 1.08
  //   s + 1.05 .. s + 1.55   levels out with the horizon, bobs, idle drift returns, depth counter goes
  //   s + 1.18 .. s + 1.58   end screen: "THE OCEAN IS STILL UNEXPLORED", letter by letter, then the buttons
  {
    const { s, L } = at('return');
    const end = s + L;
    tl.to(state, { depth: 300, duration: 0.55 + LEAD, ease: 'power2.inOut' }, s - LEAD);
    tl.to(state, { depth: 0, duration: 0.6, ease: 'power1.in' }, s + 0.55);
    tl.to(state.fx, { ascent: 1, duration: 0.3, ease: 'power1.out' }, s - 0.05);
    tl.to(state.fx, { ascent: 0, duration: 0.15, ease: 'power1.in' }, s + 0.95);
    tl.to(cam, { pitch: 0.3, duration: 0.4 }, s - 0.05);
    tl.to(cam, { pitch: 0.45, duration: 0.4 }, s + 0.55);
    tl.to(cam, { pitch: 0, duration: 0.35 }, s + 1.05);
    tl.to(cam, { heave: 0.5, duration: 0.17, ease: 'power2.out' }, s + 1.08);
    tl.to(cam, { heave: 0, duration: 0.3, ease: 'sine.inOut' }, s + 1.25);
    tl.to(cam, { idle: 1, duration: 0.45, ease: 'power1.inOut' }, s + 1.15);
    if (gauge) tl.to(gauge, { autoAlpha: 0, duration: 0.12 }, s + 1.1);

    if (endScreen) {
      const at0 = s + 1.18;
      const chars = endScreen.querySelectorAll('[data-end-char]');
      const parts = endScreen.querySelectorAll('[data-end-part]');
      const [kicker, ...rest] = parts;
      tl.set(endScreen, { autoAlpha: 1 }, at0);
      tl.fromTo(endScreen.querySelector('[data-end-scrim]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power1.out', immediateRender: false }, at0);
      tl.fromTo(kicker, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.1, ease: 'power2.out', immediateRender: false }, at0);
      tl.fromTo(chars, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.08, stagger: 0.006, ease: 'power2.out', immediateRender: false }, at0 + 0.05);
      tl.fromTo(endScreen.querySelector('[data-end-rule]'), { autoAlpha: 0, scaleX: 0 }, { autoAlpha: 1, scaleX: 1, duration: 0.12, ease: 'power2.inOut', immediateRender: false }, at0 + 0.2);
      tl.fromTo(rest, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.12, stagger: 0.04, ease: 'power2.out', immediateRender: false }, at0 + 0.24);
      if (at0 + 0.4 > end) throw new Error('end screen runs past the story'); // keep timeline time == screens scrolled
    }
  }

  // ---- Cinematic text: each chapter's lines rise into place, hold, and lift away before the next. ----
  CHAPTERS.forEach((c, i) => {
    const el = beats?.[c.id];
    if (!el) return;
    const s = CHAPTER_STARTS[i];
    const L = c.length;
    const lines = el.querySelectorAll('[data-line]');
    const title = el.querySelector('[data-title]');
    const inAt = s + L * (c.textAt ? c.textAt[0] : 0.22);
    const inDur = c.textAt ? 0.18 : L * 0.16;

    tl.set(el, { autoAlpha: 1 }, inAt);
    tl.fromTo(lines, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: inDur, stagger: inDur * 0.25, ease: 'power2.out', immediateRender: false }, inAt);
    if (title && blurTitles) {
      tl.fromTo(title, { filter: 'blur(10px)' }, { filter: 'blur(0px)', duration: inDur * 1.1, ease: 'power2.out', immediateRender: false }, inAt);
    }
    const outAt = c.textAt ? s + L * c.textAt[1] : s + L - 0.15;
    tl.to(lines, { autoAlpha: 0, y: -18, duration: 0.1, stagger: 0.012, ease: 'power1.in' }, outAt);
    tl.set(el, { autoAlpha: 0 }, outAt + 0.13);
  });

  tl.set({}, {}, STORY_LENGTH); // pad to the exact length, so timeline time == screens scrolled
  return tl;
}
