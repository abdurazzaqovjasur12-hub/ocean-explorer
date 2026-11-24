export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Use for GSAP durations: collapses animation to near-instant when the user asks for less motion. */
export const motionDuration = (seconds) => (prefersReducedMotion() ? 0.01 : seconds);
