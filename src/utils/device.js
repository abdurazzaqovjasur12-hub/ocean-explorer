import { QUALITY_LEVELS } from '@/config/quality';

export function detectDevice() {
  const ua = navigator.userAgent || '';
  const isTouch = (navigator.maxTouchPoints || 0) > 0;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
  const iPadOS = /Macintosh/i.test(ua) && isTouch; // iPadOS reports as a Mac
  const smallestSide = Math.min(window.screen?.width || 0, window.screen?.height || 0);
  const isMobile = mobileUA || iPadOS || (coarse && smallestSide > 0 && smallestSide < 820);

  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4; // undefined on Safari/Firefox
  const isLowPower = cores <= 4 || memory <= 4;

  return { isMobile, isTouch, isLowPower, cores, memory, pixelRatio: window.devicePixelRatio || 1 };
}

/** Pick a starting quality tier. `?quality=low|medium|high` in the URL overrides it. */
export function pickQuality(device) {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced && Object.hasOwn(QUALITY_LEVELS, forced)) return forced;
  if (device.isMobile) return device.isLowPower ? 'low' : 'medium';
  return device.isLowPower ? 'medium' : 'high';
}
