import { reactive } from 'vue';
import { detectDevice, pickQuality } from '@/utils/device';

const device = detectDevice();
// `?intro=0` skips the arrival and starts underwater, at the end of the descent (handy while developing).
// A chapter in the hash (`#whale`) opens the story at that chapter.
const skipIntro = new URLSearchParams(window.location.search).get('intro') === '0';

/** Single shared, reactive source of truth for UI and scene. */
export const appState = reactive({
  device,
  quality: pickQuality(device),
  loading: { progress: 0, label: 'Preparing the dive', ready: false, done: false, error: null },
  skipIntro,
  depth: 0, // the dive parameter, scrubbed by the scroll story (drives the camera height)
  meters: 0, // how far under the surface the camera really is, worked out every frame from its position
  // Time-based camera direction (the arrival after loading). Added to `cam` by the scene.
  shot: {
    idle: 1, // weight of the slow cinematic drift (multiplied by cam.idle)
    heave: skipIntro ? 0 : 3, // extra height (arrival settle)
    fov: skipIntro ? 0 : 8, // extra field of view, degrees
    pitch: 0, // extra pitch, radians (negative looks down)
    push: 0, // forward dolly, scene units
  },
  // Scroll-driven camera direction, scrubbed by the story timeline. Same meaning as `shot`.
  cam: { idle: 1, heave: 0, fov: 0, pitch: 0, push: 0, yaw: 0 },
  // Effects driven by the story: underwater snow (0..1), the whale's swim (0..1), and counters bumped each
  // time the camera goes under (burstId) or comes back up through the surface (breachId).
  fx: { snow: 0, whale: 0, burstId: 0, breachId: 0 },
  // Where the scroll story is: progress 0..1 along the whole story and the current chapter index.
  story: { progress: 0, chapter: 0, ready: false },
  soundOn: false, // true only while sound is really coming out (set by the audio bridge)
  audio: { enabled: true, volume: 0.7, unlocked: false, contextState: 'none', error: null },
});
