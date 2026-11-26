<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import gsap from '@/core/gsap';
import { appState } from '@/state/appState';
import { QUALITY_ORDER } from '@/config/quality';
import { QUALITY_MODES, pickQuality, saveQualityMode } from '@/utils/device';
import { CHAPTERS, STORY_LENGTH, chapterIndexById } from '@/config/story';
import { t } from '@/i18n';
import { prefersReducedMotion, saveCalmMotion } from '@/utils/motion';
import { createOceanScene } from '@/scenes/ocean/index.js';
import { createArrivalTimeline } from '@/core/expedition';
import { useFullscreen } from '@/composables/useFullscreen';
import { useAudio } from '@/composables/useAudio';
import { useStoryScroll } from '@/composables/useStoryScroll';
import { useDayNight } from '@/composables/useDayNight';
import ThreeScene from '@/components/ThreeScene.vue';
import LoadingScreen from '@/components/LoadingScreen.vue';
import IntroScreen from '@/components/IntroScreen.vue';
import HudControls from '@/components/HudControls.vue';
import DepthIndicator from '@/components/DepthIndicator.vue';
import StoryOverlay from '@/components/StoryOverlay.vue';
import StoryProgress from '@/components/StoryProgress.vue';
import EndScreen from '@/components/EndScreen.vue';
import EncounterWarning from '@/components/EncounterWarning.vue';
import MegalodonCard from '@/components/MegalodonCard.vue';

const root = ref(null);
const track = ref(null);
const intro = ref(null);
const gauge = ref(null);
const overlay = ref(null);
const endScreen = ref(null);
const flash = ref(null);
const veil = ref(null);
const ui = ref(null);
const impactDark = ref(null);
const impactEdge = ref(null);
const impactBlur = ref(null);
let impactTl = null;
let flicker = null;
const showLoader = ref(true);
let gsapCtx = null;
let arrival = null;

const { supported: fullscreenSupported, isFullscreen, toggle: toggleFullscreen } = useFullscreen();
const { toggle: toggleSound, setVolume, setMusicVolume, setEffectsVolume, cue } = useAudio();
const story = useStoryScroll();
const { toggle: toggleMode } = useDayNight();

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
  appState.loading.label = 'loading.ready';
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
  // Auto -> Low -> Medium -> High -> Auto. A chosen tier wins over the automatic adjustment; Auto hands it back.
  const mode = QUALITY_MODES[(QUALITY_MODES.indexOf(appState.qualityMode) + 1) % QUALITY_MODES.length];
  appState.qualityMode = mode;
  appState.qualityLocked = mode !== 'auto';
  appState.quality = mode === 'auto' ? pickQuality(appState.device) : mode;
  saveQualityMode(mode);
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

// ---- The megalodon encounter (night mode only: the scene raises none of this by day) ----
const calmNow = () => appState.calmMotion || prefersReducedMotion();
// The chapter's words step back while the megalodon is close (they would sit over its face).
const textDimmed = computed(() => appState.encounter.active && appState.encounter.phase !== 'shadow' && appState.encounter.phase !== 'leaving');
function toggleCalm() {
  appState.calmMotion = !appState.calmMotion;
  saveCalmMotion(appState.calmMotion);
}
function closeCard() {
  appState.encounter.card = false;
}
// The warning: the interface flickers for a moment, as if the signal faltered.
watch(() => appState.encounter.warningId, (n, o) => {
  if (!(n > o) || appState.mode !== 'night' || calmNow() || !ui.value) return;
  gsapCtx.add(() => {
    flicker?.kill();
    flicker = gsap.to(ui.value, { keyframes: { opacity: [1, 0.5, 1, 0.72, 1, 0.86, 1] }, duration: 0.55, ease: 'none', clearProps: 'opacity' });
  });
});
// The rush reaches the camera: a sudden darkening that lifts slowly; on capable devices a short blur of the whole
// frame (motion) and a longer one at the edges. Less motion: only a gentle darkening.
watch(() => appState.encounter.impactId, (n, o) => {
  if (!(n > o) || appState.mode !== 'night' || !impactDark.value) return;
  const calm = calmNow();
  const rich = !calm && appState.quality !== 'low';
  gsapCtx.add(() => {
    impactTl?.kill();
    impactTl = gsap.timeline();
    impactTl.fromTo(impactDark.value, { autoAlpha: 0 }, { autoAlpha: calm ? 0.4 : 0.82, duration: calm ? 0.3 : 0.07, ease: 'power2.out' }, 0)
      .to(impactDark.value, { autoAlpha: 0, duration: calm ? 1.2 : 1.6, ease: 'power2.inOut' }, calm ? 0.4 : 0.22);
    if (rich) {
      impactTl.fromTo(impactBlur.value, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05, ease: 'none' }, 0)
        .to(impactBlur.value, { autoAlpha: 0, duration: 0.32, ease: 'power1.out' }, 0.08)
        .fromTo(impactEdge.value, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06, ease: 'power2.out' }, 0)
        .to(impactEdge.value, { autoAlpha: 0, duration: 1.0, ease: 'power2.out' }, 0.2);
    }
  });
});
// Over, or called off (day mode, scrolled away): nothing of it stays on screen.
watch(() => appState.encounter.active, (on) => {
  if (on) return;
  impactTl?.kill();
  impactTl = null;
  flicker?.kill();
  flicker = null;
  if (ui.value) gsap.set(ui.value, { clearProps: 'opacity' });
  const layers = [impactDark.value, impactEdge.value, impactBlur.value].filter(Boolean);
  if (layers.length) gsap.to(layers, { autoAlpha: 0, duration: 0.35, overwrite: true });
});
watch(() => appState.mode, (mode) => { if (mode !== 'night') closeCard(); });

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

    <div ref="ui" class="ui">
      <div class="brand" data-hud>
        <span class="brand__name">{{ t('app.name') }}</span>
        <span class="brand__chapter" aria-live="polite">
          <Transition name="label" mode="out-in">
            <span :key="chapter.id"><small>{{ chapterNumber }}</small> {{ t(`chapters.${chapter.id}.label`) }}</span>
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
        :music-volume="appState.audio.music"
        :effects-volume="appState.audio.effects"
        :quality="appState.quality"
        :quality-mode="appState.qualityMode"
        :mode="appState.mode"
        @toggle-fullscreen="toggleFullscreen"
        @toggle-sound="toggleSound"
        @set-volume="setVolume"
        @set-music="setMusicVolume"
        @set-effects="setEffectsVolume"
        @cycle-quality="cycleQuality"
        @toggle-mode="toggleMode"
      />
      <DepthIndicator ref="gauge" class="gauge" :depth="appState.meters" />
      <StoryOverlay ref="overlay" class="story-text" :class="{ 'is-dimmed': textDimmed }" />
      <EndScreen ref="endScreen" @replay="replayExpedition" @explore="exploreAgain" />
      <StoryProgress data-hud :progress="appState.story.progress" :active="appState.story.chapter" @navigate="story.goTo" />

      <IntroScreen ref="intro" @start="startExpedition" />

      <EncounterWarning :warning="appState.encounter.warning" :hint="appState.encounter.hint && !appState.encounter.card" :calm="appState.calmMotion" @toggle-calm="toggleCalm" />
      <MegalodonCard :open="appState.encounter.card" :calm="appState.calmMotion" @close="closeCard" @toggle-calm="toggleCalm" />
    </div>

    <!-- Brief veil of light as the camera breaks the surface. -->
    <div ref="flash" class="flash" aria-hidden="true"></div>
    <!-- The megalodon's impact (night only): a darkening, a short blur of the frame, a longer one at the edges. -->
    <div ref="impactBlur" class="impact impact--blur" aria-hidden="true"></div>
    <div ref="impactEdge" class="impact impact--edge" aria-hidden="true"></div>
    <div ref="impactDark" class="impact impact--dark" aria-hidden="true"></div>
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
/* At night the edges close in a little more, easing in with the scene. */
.vignette::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(115% 90% at 50% 42%, transparent 50%, rgba(1, 4, 10, 0.38) 100%);
  opacity: 0;
  transition: opacity 2.6s ease-in-out;
}
:global(html[data-mode='night']) .vignette::after { opacity: 1; }
.flash {
  position: absolute;
  inset: 0;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  background: radial-gradient(100% 80% at 50% 55%, rgba(190, 240, 250, 0.9), rgba(70, 170, 200, 0.75));
}
/* Hidden (visibility too, so the blurs cost nothing) until an impact; GSAP's autoAlpha shows them. */
.story-text { transition: opacity 0.9s ease; }
.story-text.is-dimmed { opacity: 0.15; }
.impact { position: absolute; inset: 0; z-index: 5; pointer-events: none; opacity: 0; visibility: hidden; }
.impact--dark { background: radial-gradient(95% 85% at 50% 50%, rgba(0, 3, 7, 0.6), rgba(0, 1, 3, 0.96)); }
.impact--blur { -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.impact--edge {
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  -webkit-mask-image: radial-gradient(72% 66% at 50% 50%, transparent 42%, #000 100%);
  mask-image: radial-gradient(72% 66% at 50% 50%, transparent 42%, #000 100%);
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
  /* the name may wrap onto two lines (Uzbek and Russian names are long) rather than run under the buttons */
  .brand__name { font-size: 0.95rem; max-width: calc(100vw - 17.8rem); line-height: 1.2; }
  .brand__chapter { max-width: calc(100vw - 17.8rem); line-height: 1.5; } /* both stop short of the HUD row */
}
@media (max-width: 400px) {
  .brand__name, .brand__chapter { max-width: calc(100vw - 15.2rem); } /* one HUD button fewer here (no fullscreen) */
}
@media (max-width: 360px) {
  .brand { left: calc(var(--inset-left) + 0.9rem); }
  .brand__name { font-size: 0.86rem; max-width: calc(100vw - 13.5rem); }
  .brand__chapter { max-width: calc(100vw - 13.5rem); font-size: 0.58rem; letter-spacing: 0.1em; }
}
</style>
