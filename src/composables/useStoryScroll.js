import { onBeforeUnmount } from 'vue';
import gsap, { ScrollTrigger } from '@/core/gsap';
import { appState } from '@/state/appState';
import { CHAPTERS, STORY_LENGTH, chapterIndexAt, chapterIndexById, chapterRestTime } from '@/config/story';
import { createStoryTimeline } from '@/core/story';
import { clamp } from '@/utils/math';
import { motionDuration, prefersReducedMotion } from '@/utils/motion';

const LAST = CHAPTERS.length - 1;

/**
 * Native page scrolling drives the story: a ScrollTrigger scrubs the story timeline across a spacer
 * (`track`) that is STORY_LENGTH screens taller than the viewport, while the scene and the interface stay
 * fixed on top. Scrolling is never hijacked: no snapping, no pinning, nothing preventDefault()ed. The scrub
 * lag (about a second) turns every wheel notch, flick and keyboard step into a smooth camera move.
 *
 * Also: chapter navigation (a smooth scroll for nearby chapters, a fade-to-black cut for far ones, so the
 * camera never rewinds the whole dive on screen), deep links (`#whale`) and the scroll lock while loading.
 */
export function useStoryScroll() {
  let tl = null;
  let st = null;
  let scrollTween = null;
  let cut = null;
  let veilEl = null;
  // Rotating a phone or resizing a window changes how tall the page is. The browser clamps the scroll offset
  // in pixels and ScrollTrigger re-measures, so the story would jump to another chapter (often back to the
  // surface). Keep our own record of where in the story the page was, freeze the trigger while the layout
  // settles (so the camera doesn't fly off meanwhile), then put the page back at the same point.
  let lastProgress = 0;
  let resizing = false;
  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  const progressNow = () => (st && st.end > st.start ? clamp((window.scrollY - st.start) / (st.end - st.start), 0, 1) : 0);
  const onScroll = () => { if (!resizing) lastProgress = progressNow(); };
  const onResize = () => {
    if (!st || window.innerWidth === lastWidth) return; // height only: mobile toolbars, ignored by ScrollTrigger too
    lastWidth = window.innerWidth;
    if (!resizing) {
      resizing = true;
      st.disable(false); // keep the timeline exactly where it is
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const keep = lastProgress;
      st.enable(false);
      ScrollTrigger.refresh();
      window.scrollTo(0, st.start + keep * (st.end - st.start));
      ScrollTrigger.update();
      st.getTween()?.progress(1);
      resizing = false;
      lastProgress = keep;
    }, 250);
  };

  const root = document.documentElement;
  root.classList.add('is-locked'); // no scrolling until the scene is ready

  const scrollFor = (time) => (st ? st.start + (clamp(time, 0, STORY_LENGTH) / STORY_LENGTH) * (st.end - st.start) : 0);

  function writeHash(index) {
    const url = index > 0 ? `#${CHAPTERS[index].id}` : window.location.pathname + window.location.search;
    try { history.replaceState(history.state, '', url); } catch { /* sandboxed iframes */ }
  }

  function sync() {
    const time = tl.time();
    appState.story.progress = Math.min(1, time / STORY_LENGTH);
    const index = chapterIndexAt(time);
    if (index !== appState.story.chapter) {
      appState.story.chapter = index;
      writeHash(index);
    }
  }

  /** Move the page instantly and bring the story straight there (no scrub catch-up). */
  function jump(y) {
    scrollTween?.kill();
    window.scrollTo(0, y);
    ScrollTrigger.update();
    const scrub = st.getTween();
    if (scrub) scrub.progress(1);
    else tl.progress(st.progress);
    sync();
  }

  /**
   * Fade to the deep, move, fade back in. `atBlack` runs while the screen is covered (reset things there);
   * `then` runs as the veil starts to lift.
   */
  function cutTo(y, { atBlack, then, hold = 0.2 } = {}) {
    if (!veilEl) {
      jump(y);
      atBlack?.();
      then?.();
      return;
    }
    cut?.kill();
    cut = gsap.timeline({ onComplete: () => { cut = null; } })
      .to(veilEl, { autoAlpha: 1, duration: motionDuration(0.55), ease: 'power1.in' })
      .add(() => { jump(y); atBlack?.(); })
      .to(veilEl, { autoAlpha: 0, duration: motionDuration(1.2), ease: 'power1.out' }, `+=${motionDuration(hold)}`)
      .add(() => then?.(), `<+=${motionDuration(0.3)}`);
  }

  /**
   * Go to a chapter's resting point. Nearby chapters scroll there smoothly (any user scroll takes over at
   * once); far ones, or going back from the return to the surface, cut through a fade.
   */
  function goTo(index, { duration, smooth } = {}) {
    if (!st) return;
    const to = clamp(index, 0, LAST);
    const from = appState.story.chapter;
    const y = scrollFor(chapterRestTime(to));
    const far = Math.abs(to - from) > 2 || (from === LAST && to < from);
    if (far && !smooth) return cutTo(y);

    scrollTween?.kill();
    const screens = Math.abs(y - window.scrollY) / window.innerHeight;
    scrollTween = gsap.to(window, {
      scrollTo: { y, autoKill: true },
      duration: motionDuration(duration ?? clamp(0.8 + screens * 0.9, 1, 3.5)),
      ease: 'power2.inOut',
      onComplete: () => { scrollTween = null; },
      onInterrupt: () => { scrollTween = null; },
    });
  }

  /** Builds the timeline and the trigger. Call once the scene is ready and the DOM is in place. */
  function init({ track, intro, gauge, beats, end, veil }) {
    veilEl = veil;
    if (veil) gsap.set(veil, { autoAlpha: 0 });
    if (gauge) gsap.set(gauge, { autoAlpha: 0 });

    tl = createStoryTimeline({ state: appState, intro, gauge, beats, end, blurTitles: !appState.device.isMobile });
    tl.eventCallback('onUpdate', sync);

    root.classList.remove('is-locked');
    const reduced = prefersReducedMotion();
    st = ScrollTrigger.create({
      trigger: track,
      start: 'top top',
      end: 'bottom bottom',
      animation: tl,
      scrub: reduced ? 0.3 : appState.device.isTouch ? 0.7 : 1,
    });
    ScrollTrigger.refresh();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    // Deep link or `?intro=0`: open at that chapter instead of the surface.
    const fromHash = chapterIndexById(decodeURIComponent(window.location.hash.slice(1)));
    const start = fromHash > 0 ? fromHash : appState.skipIntro ? chapterIndexById('descent') : 0;
    if (start > 0) jump(scrollFor(chapterRestTime(start)));
    else if (window.scrollY > 0) jump(0);
    appState.story.ready = true;
    sync();
  }

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    clearTimeout(resizeTimer);
    scrollTween?.kill();
    cut?.kill();
    st?.kill();
    tl?.kill();
    root.classList.remove('is-locked');
  });

  return {
    init,
    goTo,
    /**
     * Back to the very top through a fade, without reloading. `atBlack` resets whatever else should start
     * over while the screen is dark; `then` runs as it lifts (e.g. replay the intro, or start the dive).
     * Ignored while a cut is already under way (a double tap).
     */
    restart({ atBlack, then } = {}) {
      if (!st || cut) return;
      cutTo(0, { atBlack, then, hold: 0.45 });
    },
  };
}
