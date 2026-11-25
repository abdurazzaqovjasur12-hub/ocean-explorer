<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import gsap from '@/core/gsap';
import { appState } from '@/state/appState';
import { QUALITY_LEVELS, QUALITY_ORDER } from '@/config/quality';
import { CHAPTERS, STORY_LENGTH, chapterIndexById } from '@/config/story';
import { prefersReducedMotion } from '@/utils/motion';
import { createOceanScene } from '@/scenes/ocean/index.js';
import { createArrivalTimeline } from '@/core/expedition';
import { useFullscreen } from '@/composables/useFullscreen';
import { useAudio } from '@/composables/useAudio';
import { useStoryScroll } from '@/composables/useStoryScroll';
import ThreeScene from '@/components/ThreeScene.vue';
import LoadingScreen from '@/components/LoadingScreen.vue';
import IntroScreen from '@/components/IntroScreen.vue';
import HudControls from '@/components/HudControls.vue';
import DepthIndicator from '@/components/DepthIndicator.vue';
import StoryOverlay from '@/components/StoryOverlay.vue';
import StoryProgress from '@/components/StoryProgress.vue';
import EndScreen from '@/components/EndScreen.vue';

const root = ref(null);
const track = ref(null);
const intro = ref(null);
const gauge = ref(null);
const overlay = ref(null);
const endScreen = ref(null);
const flash = ref(null);
const veil = ref(null);
const showLoader = ref(true);
let gsapCtx = null;
let arrival = null;

const { supported: fullscreenSupported, isFullscreen, toggle: toggleFullscreen } = useFullscreen();
const { toggle: toggleSound, setVolume, cue } = useAudio();
const story = useStoryScroll();

const chapter = computed(() => CHAPTERS[appState.story.chapter]);
const chapterNumber = computed(() => String(appState.story.chapter + 1).padStart(2, '0'));
// The scroll spacer: one screen to stand on, plus one per screen of story.
const trackStyle = { '--story-screens': STORY_LENGTH + 1 };

function onProgress(value, label) {
  appState.loading.progress = value;
  if (label) appState.loading.label = label;
}
function onReady() {
  appState.loading.progress = 1;
  appState.loading.label = 'Ready';
  appState.loading.ready = true;
}
function onError(message) {
  appState.loading.error = message;
}
// The story and the arrival start as the loading screen begins to fade, so they play in under it.
function onLoaderLeaving() {
  appState.loading.done = true;
}
function onLoaderHidden() {
  showLoader.value = false;
  appState.loading.done = true;
}
function cycleQuality() {
  const next = (QUALITY_ORDER.indexOf(appState.quality) + 1) % QUALITY_ORDER.length;
  appState.quality = QUALITY_ORDER[next];
  appState.qualityLocked = true; // the visitor's choice wins over the automatic adjustment
}
/** The frame rate stays too low even at the lowest render resolution: step down a quality tier. */
function onLowFps(fps) {
  if (appState.qualityLocked) return;
  const i = QUALITY_ORDER.indexOf(appState.quality);
  if (i <= 0) return;
  appState.quality = QUALITY_ORDER[i - 1];
  console.info(`[quality] ${Math.round(fps)} fps: switched to ${appState.quality}`);
}

/** Camera settles into the idle frame while the title, subtitle, button and details arrive. */
function playIntroIn(startsAtSurface, { hud = true } = {}) {
  gsapCtx.add(() => {
    arrival = createArrivalTimeline(appState);
    arrival.add(intro.value.playIn(), startsAtSurface ? 0.4 : 0);
    if (prefersReducedMotion() || !startsAtSurface) arrival.timeScale(2.5);
    if (hud) arrival.fromTo('[data-hud]', { opacity: 0 }, { opacity: 1, duration: 1.2, clearProps: 'opacity' }, startsAtSurface ? 2.8 : 0);
  });
}

/** START EXPEDITION (and the scroll cue): glide down the page into the descent. Any scroll takes over. */
function startExpedition({ silent = false } = {}) {
  if (!silent) cue('start');
  story.goTo(chapterIndexById('descent'), { duration: 5.5, smooth: true });
}

/**
 * REPLAY EXPEDITION: the whole experience from the start, without reloading. Through a fade to black the page
 * returns to the top (the story timeline rewinds everything it drives), the camera goes back to its raised
 * arrival pose and the intro to its hidden state; as the fade lifts, the arrival plays again.
 */
function replayExpedition() {
  cue('start');
  story.restart({
    atBlack: () => {
      arrival?.kill();
      appState.shot.heave = 3;
      appState.shot.fov = 8;
      intro.value.reset();
    },
    then: () => playIntroIn(true, { hud: false }),
  });
}

/** EXPLORE AGAIN: straight back to the surface and down into the water, skipping the intro. */
function exploreAgain() {
  cue('start');
  story.restart({ then: () => startExpedition({ silent: true }) });
}

function collectBeats() {
  const beats = {};
  overlay.value?.$el.querySelectorAll('[data-beat]').forEach((el) => { beats[el.dataset.beat] = el; });
  return beats;
}

onMounted(() => {
  gsapCtx = gsap.context(() => {
    gsap.set('[data-hud]', { opacity: 0 }); // hidden until the arrival
  }, root.value);
});

watch(() => appState.loading.done, (done) => {
  if (!done) return;
  story.init({
    track: track.value,
    intro: intro.value.el(),
    gauge: gauge.value.$el,
    beats: collectBeats(),
    end: endScreen.value.$el,
    veil: veil.value,
  });
  playIntroIn(appState.story.chapter === 0);
});

// Breaking the surface, on the way down or back up: a brief veil of light.
watch(() => [appState.fx.burstId, appState.fx.breachId], () => {
  if (!appState.story.ready || !flash.value) return;
  gsapCtx.add(() => {
    gsap.timeline()
      .to(flash.value, { opacity: 0.6, duration: 0.3, ease: 'power2.out' })
      .to(flash.value, { opacity: 0, duration: 2, ease: 'power2.out' });
  });
});

onBeforeUnmount(() => {
  arrival?.kill();
  gsapCtx?.revert();
});
</script>

<template>
  <main ref="root" class="app">
    <ThreeScene
      :scene-factory="createOceanScene"
      :quality="appState.quality"
      :state="appState"
      @progress="onProgress"
      @ready="onReady"
      @error="onError"
      @low-fps="onLowFps"
    />

    <div class="vignette" aria-hidden="true"></div>

    <div class="ui">
      <div class="brand" data-hud>
        <span class="brand__name">Ocean Explorer</span>
        <span class="brand__chapter" aria-live="polite">
          <Transition name="label" mode="out-in">
            <span :key="chapter.id"><small>{{ chapterNumber }}</small> {{ chapter.label }}</span>
          </Transition>
        </span>
      </div>
      <HudControls
        data-hud
        :is-fullscreen="isFullscreen"
        :fullscreen-supported="fullscreenSupported"
        :sound-on="appState.soundOn"
        :sound-error="appState.audio.error"
        :volume="appState.audio.volume"
        :quality-label="QUALITY_LEVELS[appState.quality].label"
        @toggle-fullscreen="toggleFullscreen"
        @toggle-sound="toggleSound"
        @set-volume="setVolume"
        @cycle-quality="cycleQuality"
      />
      <DepthIndicator ref="gauge" class="gauge" :depth="appState.meters" />
      <StoryOverlay ref="overlay" />
      <EndScreen ref="endScreen" @replay="replayExpedition" @explore="exploreAgain" />
      <StoryProgress data-hud :progress="appState.story.progress" :active="appState.story.chapter" @navigate="story.goTo" />

      <IntroScreen ref="intro" @start="startExpedition" />
    </div>

    <!-- Brief veil of light as the camera breaks the surface. -->
    <div ref="flash" class="flash" aria-hidden="true"></div>
    <!-- Fade to the deep for long jumps between chapters. -->
    <div ref="veil" class="veil" aria-hidden="true"></div>

    <LoadingScreen
      v-if="showLoader"
      :progress="appState.loading.progress"
      :label="appState.loading.label"
      :ready="appState.loading.ready"
      :error="appState.loading.error"
      @leaving="onLoaderLeaving"
      @hidden="onLoaderHidden"
    />
  </main>

  <!-- The page that is actually scrolled: an empty spacer. The scene and interface above stay fixed. -->
  <div ref="track" class="track" :style="trackStyle" aria-hidden="true"></div>
</template>

<style scoped>
/* Fixed stage over the scrolling spacer. `clip` (not `hidden`) so it is not a scroll container: touch
   scrolling anywhere on it scrolls the page. */
.app { position: fixed; inset: 0; z-index: 1; overflow: hidden; overflow: clip; }
.gauge { opacity: 0; visibility: hidden; } /* shown by the story once the camera is under */
.track { position: relative; height: calc(var(--story-screens) * 100vh); height: calc(var(--story-screens) * 100lvh); }

.ui { position: absolute; inset: 0; pointer-events: none; }
/* Soft darkening towards the edges: frames the water like a lens and keeps the UI legible over the bright sky. */
.vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(120% 95% at 50% 42%, transparent 58%, rgba(2, 8, 14, 0.42) 100%);
}
.flash {
  position: absolute;
  inset: 0;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  background: radial-gradient(100% 80% at 50% 55%, rgba(190, 240, 250, 0.9), rgba(70, 170, 200, 0.75));
}
.veil {
  position: absolute;
  inset: 0;
  z-index: 6;
  background: var(--abyss);
  pointer-events: none;
  visibility: hidden;
}

.brand {
  position: absolute;
  top: calc(var(--inset-top) + 1.1rem);
  left: calc(var(--inset-left) + 1.5rem);
  display: grid;
  gap: 0.35rem;
  margin: 0;
}
.brand__name {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.2rem;
  letter-spacing: 0.02em;
}
.brand { text-shadow: 0 1px 14px rgba(2, 12, 22, 0.55); }
.brand__chapter {
  display: block;
  min-height: 1.2em;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(215, 241, 242, 0.78);
}
.brand__chapter small { font-size: inherit; color: var(--jelly); margin-right: 0.35em; font-variant-numeric: tabular-nums; }
.label-enter-active, .label-leave-active { transition: opacity 0.35s, transform 0.35s; }
.label-enter-from { opacity: 0; transform: translateY(6px); }
.label-leave-to { opacity: 0; transform: translateY(-6px); }

@media (max-width: 640px) {
  .brand { left: calc(var(--inset-left) + 1.1rem); }
  .brand__name { font-size: 1.05rem; }
  .brand__chapter { font-size: 0.64rem; letter-spacing: 0.14em; }
}
/* Narrow phones: the chapter name wraps rather than running under the buttons on the right. */
@media (max-width: 440px) {
  .brand__name { font-size: 0.95rem; }
  .brand__chapter { max-width: 9.5rem; line-height: 1.5; }
}
@media (max-width: 360px) {
  .brand { left: calc(var(--inset-left) + 0.9rem); }
  .brand__name { font-size: 0.86rem; }
  .brand__chapter { max-width: 7.5rem; font-size: 0.58rem; }
}
</style>
