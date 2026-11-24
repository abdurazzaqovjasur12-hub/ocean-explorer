import gsap from '@/core/gsap';

/**
 * The camera settles into the idle frame after the loading screen lifts. It animates `state.shot`, which
 * the scene adds on top of the scroll camera (`state.cam`), so scrolling during the arrival never fights it.
 * The dive itself is part of the scroll story now (src/core/story.js).
 */
export function createArrivalTimeline(state) {
  const tl = gsap.timeline();
  tl.to(state.shot, { heave: 0, fov: 0, duration: 6, ease: 'power3.out' }, 0);
  return tl;
}
