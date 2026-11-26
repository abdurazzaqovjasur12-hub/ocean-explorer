export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// "Less motion": the visitor's own choice (no camera shake, no flashes or blur in the megalodon encounter).
// Remembered; until it is chosen it follows the system's reduced-motion setting.
const CALM_KEY = 'ocean-explorer.calm-motion';
export function storedCalmMotion() {
  try {
    const v = localStorage.getItem(CALM_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}
export function saveCalmMotion(on) {
  try {
    localStorage.setItem(CALM_KEY, on ? '1' : '0');
  } catch {
    /* not remembered, still applied */
  }
}

/** Use for GSAP durations: collapses animation to near-instant when the user asks for less motion. */
export const motionDuration = (seconds) => (prefersReducedMotion() ? 0.01 : seconds);
