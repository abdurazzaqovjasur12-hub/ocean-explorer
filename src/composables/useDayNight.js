import { onMounted } from 'vue';
import gsap from '@/core/gsap';
import { appState } from '@/state/appState';
import { saveMode } from '@/utils/mode';
import { motionDuration } from '@/utils/motion';

const TRANSITION = 2.6; // seconds: the sky, the sea and the light ease from one to the other

function markDocument(mode) {
  document.documentElement.dataset.mode = mode; // for the few interface touches that differ (vignette)
}

/**
 * Day and night. One scene for both: `appState.env.night` (0 day .. 1 night) is eased by GSAP and every
 * part of the ocean reads it (sky, sea, light, beams, particles). Switching changes nothing else: the scroll,
 * the story timeline, the camera, sound, quality and language carry on. The choice is remembered.
 */
export function useDayNight() {
  let tween = null;

  function setMode(mode) {
    if (mode !== 'day' && mode !== 'night') return;
    if (mode === appState.mode) return;
    appState.mode = mode;
    saveMode(mode);
    markDocument(mode);
    tween?.kill();
    tween = gsap.to(appState.env, {
      night: mode === 'night' ? 1 : 0,
      duration: motionDuration(TRANSITION),
      ease: 'sine.inOut',
      onComplete: () => { tween = null; },
    });
  }

  const toggle = () => setMode(appState.mode === 'night' ? 'day' : 'night');

  onMounted(() => markDocument(appState.mode));

  return { setMode, toggle };
}
