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
  // Only Chromium reports memory (Safari and Firefox don't): unknown must not count as "low", or every
  // iPhone would start on the lowest tier. Only a known weakness lowers the starting tier; whatever the
  // device really manages is then found out by the frame-rate adaptation (SceneManager).
  const memory = navigator.deviceMemory; // GB, or undefined
  const isLowPower = cores <= 2 || (memory !== undefined && memory <= 2);

  const gpu = gpuName();
  return {
    isMobile,
    isTouch,
    isLowPower: isLowPower || (isMobile ? WEAK_MOBILE_GPU.test(gpu) : false),
    integratedGpu: !isMobile && INTEGRATED_GPU.test(gpu),
    gpu,
    cores,
    memory: memory ?? null,
    pixelRatio: window.devicePixelRatio || 1,
  };
}

// Integrated graphics (most laptops) can't hold the high tier at a comfortable frame rate: start on medium.
const INTEGRATED_GPU = /Intel|Iris|UHD Graphics|HD Graphics|Radeon\(TM\)( Vega)? ?\d* Graphics|Vega \d+ Graphics|SwiftShader|llvmpipe|Microsoft Basic Render/i;
// Older phone GPUs: start on low.
const WEAK_MOBILE_GPU = /Adreno \(TM\) [3-5]\d\d|Mali-(4\d\d|T\d+)|PowerVR SGX/i;

/** The GPU's name (where the browser shares it; Safari says "Apple GPU"), from a throwaway context. */
function gpuName() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // give the context back straight away
    return name;
  } catch {
    return '';
  }
}

/** `?quality=low|medium|high` in the URL, or null. A forced tier is never changed automatically. */
export function forcedQuality() {
  const forced = new URLSearchParams(window.location.search).get('quality');
  return forced && Object.hasOwn(QUALITY_LEVELS, forced) ? forced : null;
}

/** Pick a starting quality tier: phones start on medium, computers on high, one lower for a known weak device. */
export function pickQuality(device) {
  const forced = forcedQuality();
  if (forced) return forced;
  if (device.isMobile) return device.isLowPower ? 'low' : 'medium';
  return device.isLowPower || device.integratedGpu ? 'medium' : 'high';
}
