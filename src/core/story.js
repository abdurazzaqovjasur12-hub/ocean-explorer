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
 *   whale     3.70 - 4.80   1700 -> 1850 m; the whale's swim across the frame is tied to the scroll (fx.whale)
 *   vents     4.80 - 5.70   2950 -> 3050 m, the camera tips down onto the vent field
 *   abyss     5.70 - 6.60   5200 -> 5600 m, narrower lens
 *   return    6.60 - 7.70   one long ascent to the surface, looking up at the light, back above the waves
 */
export function createStoryTimeline({ state, intro, gauge, beats, blurTitles = true }) {
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

  // Whale: its swim from left to right is scrubbed by the scroll (the scene adds the tail beat and the glide).
  {
    const { s, L } = at('whale');
    tl.to(state.fx, { whale: 1, duration: L - 0.18, ease: 'none' }, s + 0.1);
  }
  // Bioluminescence: a slow glide in among the jellyfish, panning gently to the right, then settling back
  // for the drop to the whale.
  {
    const { s, L } = at('glow');
    tl.to(cam, { push: 2.6, yaw: -0.1, duration: L - 0.25 }, s + 0.05);
    tl.to(cam, { push: 0, yaw: 0, duration: 0.3 }, s + L - 0.15);
  }
  // Vents: tip the camera down onto the vent field, then level out for the long drop to the abyss.
  {
    const { s, L } = at('vents');
    tl.to(cam, { pitch: -0.24, duration: 0.35 }, s);
    tl.to(cam, { pitch: 0, duration: 0.3 }, s + L - 0.2);
  }
  // Abyss: a slightly longer lens, the world closing in.
  {
    const { s, L } = at('abyss');
    tl.to(cam, { fov: -4, duration: 0.4 }, s);
    tl.to(cam, { fov: 0, duration: 0.3 }, s + L - 0.1);
  }

  // ---- 8. Return to surface: one long ascent, looking up at the light, then the drift above the waves. ----
  {
    const { s, L } = at('return');
    const end = s + L;
    tl.to(state, { depth: 0, duration: L * 0.75 + LEAD, ease: 'power2.inOut' }, s - LEAD);
    tl.to(cam, { pitch: 0.3, duration: 0.4 }, s - 0.05);
    tl.to(cam, { pitch: 0, duration: 0.35 }, s + 0.55);
    tl.to(cam, { idle: 1, duration: 0.45, ease: 'power1.inOut' }, end - 0.5);
    if (gauge) tl.to(gauge, { autoAlpha: 0, duration: 0.15 }, end - 0.35);
  }

  // ---- Cinematic text: each chapter's lines rise into place, hold, and lift away before the next. ----
  CHAPTERS.forEach((c, i) => {
    const el = beats?.[c.id];
    if (!el) return;
    const s = CHAPTER_STARTS[i];
    const L = c.length;
    const lines = el.querySelectorAll('[data-line]');
    const title = el.querySelector('[data-title]');
    // (the final block lands before the end: the timeline must not run past STORY_LENGTH)
    const inAt = c.final ? s + L * 0.68 : s + L * 0.22;
    const inDur = c.final ? 0.15 : L * 0.16;

    tl.set(el, { autoAlpha: 1 }, inAt);
    tl.fromTo(lines, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: inDur, stagger: inDur * 0.25, ease: 'power2.out', immediateRender: false }, inAt);
    if (title && blurTitles) {
      tl.fromTo(title, { filter: 'blur(10px)' }, { filter: 'blur(0px)', duration: inDur * 1.1, ease: 'power2.out', immediateRender: false }, inAt);
    }
    if (c.final) return; // the last words stay

    const outAt = s + L - 0.15;
    tl.to(lines, { autoAlpha: 0, y: -18, duration: 0.1, stagger: 0.012, ease: 'power1.in' }, outAt);
    tl.set(el, { autoAlpha: 0 }, outAt + 0.13);
  });

  tl.set({}, {}, STORY_LENGTH); // pad to the exact length, so timeline time == screens scrolled
  return tl;
}
