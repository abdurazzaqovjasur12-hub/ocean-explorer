import { cameraYAtDepth } from '@/config/zones';
import { smoothstep } from '@/utils/math';

// Events that count as a user gesture for the browser's autoplay rules. Not 'pointerdown': starting the
// sound adds the volume button to the HUD, and if that happened between press and release the HUD row would
// shift under the pointer and the click (e.g. on the quality button) would be lost. A release still counts.
const GESTURES = ['pointerup', 'touchend', 'keydown', 'click'];
const NOT_A_GESTURE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape']);

/** 0 above the waves, 1 well below them: the same rule the water shader uses for its underwater look. */
export function underwaterAmount(depth, heave = 0) {
  return 1 - smoothstep(-2.0, -0.9, cameraYAtDepth(depth) + heave);
}

/**
 * Connects the audio engine to the app, without depending on Vue:
 *  - the first click, tap or key press unlocks and starts audio (browsers refuse to before that)
 *  - the engine's real state is copied into `state` so the button always shows the truth
 *  - depth, the dive and the surface break drive the sounds
 *  - the tab being hidden silences and idles the audio
 * `subscribe(getter, callback, options)` is Vue's watch() in the app.
 */
export function createAudioBridge({ engine, state, subscribe, doc = document, win = window }) {
  const sync = (s) => {
    Object.assign(state.audio, { enabled: s.enabled, volume: s.volume, unlocked: s.unlocked, contextState: s.contextState, error: s.error });
    state.soundOn = s.audible;
  };
  const offEngine = engine.on(sync);
  sync(engine.snapshot());

  const onGesture = (e) => {
    if (e.type === 'keydown' && NOT_A_GESTURE.has(e.key)) return;
    if (e.target?.closest?.('[data-sound-toggle]')) return; // the toggle unlocks and decides for itself
    if (!engine.unlocked || engine.contextState !== 'running') engine.autoStart().catch(() => {});
    else engine.ensureRunning().catch(() => {}); // e.g. iOS interrupted audio during a call
  };
  GESTURES.forEach((type) => doc.addEventListener(type, onGesture, { capture: true, passive: true }));

  const onVisibility = () => (doc.hidden ? engine.pause() : engine.resume());
  doc.addEventListener('visibilitychange', onVisibility);
  const onPageHide = () => engine.pause();
  win.addEventListener('pagehide', onPageHide);

  const onKey = (e) => {
    if (e.key?.toLowerCase() !== 'm' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    engine.toggle();
  };
  doc.addEventListener('keydown', onKey);

  const stops = [
    // `meters` is how far under the surface the camera really is (worked out by the scene); `depth` is the dive parameter.
    // The camera height is the dive parameter plus both heaves (the scroll camera and the arrival).
    subscribe(() => [state.depth, state.shot.heave + (state.cam?.heave ?? 0), state.meters], ([depth, heave, meters]) => engine.setEnvironment({ depth: meters ?? depth, under: underwaterAmount(depth, heave) }), { immediate: true }),
    subscribe(() => state.fx.burstId, (n, o) => { if (n !== o) engine.cue('plunge'); }),
    // Scrolling from the surface into the descent: the rush of air as the dive begins.
    subscribe(() => state.story?.chapter, (n, o) => { if (o === 0 && n === 1) engine.cue('dive'); }),
  ];

  return {
    toggle: () => engine.toggle(),
    setVolume: (v) => engine.setVolume(v),
    cue: (name) => engine.cue(name),
    dispose() {
      offEngine();
      stops.forEach((stop) => stop?.());
      GESTURES.forEach((type) => doc.removeEventListener(type, onGesture, { capture: true }));
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pagehide', onPageHide);
      doc.removeEventListener('keydown', onKey);
    },
  };
}
