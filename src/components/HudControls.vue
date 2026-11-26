<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { t } from '@/i18n';
import LanguageSwitcher from './LanguageSwitcher.vue';

const props = defineProps({
  isFullscreen: Boolean,
  fullscreenSupported: Boolean,
  soundOn: Boolean, // sound is really coming out (not just "wanted")
  soundError: { type: String, default: null },
  volume: { type: Number, default: 0.7 }, // 0..1
  quality: { type: String, default: 'medium' }, // tier id; its name comes from the translations
  mode: { type: String, default: 'day' }, // 'day' | 'night'
});
const emit = defineEmits(['toggle-fullscreen', 'toggle-sound', 'cycle-quality', 'set-volume', 'toggle-mode']);

// The volume panel: opens when sound is switched on, from its own button, on hover (mouse) or focus,
// and closes itself after a few idle seconds so it never sits over the picture.
const panelOpen = ref(false);
let hideTimer = 0;
const clearHide = () => clearTimeout(hideTimer);
function openPanel(idleMs = 5000) {
  panelOpen.value = true;
  clearHide();
  if (idleMs) hideTimer = setTimeout(() => { panelOpen.value = false; }, idleMs);
}
function closePanel() {
  clearHide();
  panelOpen.value = false;
}

function onToggleSound() {
  const wasOn = props.soundOn;
  emit('toggle-sound');
  if (!wasOn) openPanel(); // turning on: show the volume for a moment
  else closePanel();
}
function onVolume(e) {
  emit('set-volume', Number(e.target.value) / 100);
  openPanel(); // restart the idle timer while the slider is being used
}
const onEnter = (e) => { if (e.pointerType === 'mouse' && props.soundOn) openPanel(0); };
const onLeave = (e) => { if (e.pointerType === 'mouse' && panelOpen.value) openPanel(1200); };

const volumePct = computed(() => Math.round(props.volume * 100));
const qualityLabel = computed(() => t(`hud.quality.${props.quality}`));
const modeLabel = computed(() => (props.mode === 'night' ? t('hud.mode.toDay') : t('hud.mode.toNight')));
// The browser's own error text (often in another language) goes to the console, not into the label.
const soundLabel = computed(() => {
  if (props.soundError) return t('hud.sound.unavailable');
  return props.soundOn ? t('hud.sound.off') : t('hud.sound.on');
});
onBeforeUnmount(clearHide);
</script>

<template>
  <div class="hud" data-ui @pointerenter="onEnter" @pointerleave="onLeave">
    <button
      type="button"
      class="hud__btn hud__btn--text"
      :aria-label="t('hud.quality.aria', { tier: qualityLabel })"
      @click="$emit('cycle-quality')"
    >{{ qualityLabel }}</button>

    <button
      v-if="fullscreenSupported"
      type="button"
      class="hud__btn hud__btn--fullscreen"
      :aria-pressed="isFullscreen"
      :aria-label="isFullscreen ? t('hud.fullscreen.exit') : t('hud.fullscreen.enter')"
      @click="$emit('toggle-fullscreen')"
    >
      <svg v-if="!isFullscreen" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
    </button>

    <!-- Always shows the real state: lit only while sound is actually playing. -->
    <button
      type="button"
      class="hud__btn"
      :class="{ 'is-on': soundOn && !soundError, 'is-error': !!soundError }"
      data-sound-toggle
      :aria-pressed="soundOn"
      :aria-label="soundLabel"
      :title="soundLabel"
      @click="onToggleSound"
    >
      <svg v-if="soundError" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4zM17 8v4.5M17 16v.01" /></svg>
      <svg v-else-if="soundOn && volume >= 0.34" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>
      <svg v-else-if="soundOn" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4zM15.5 9a4 4 0 0 1 0 6" /></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4zM16 9.5l5 5M21 9.5l-5 5" /></svg>
    </button>

    <button
      v-if="soundOn && !soundError"
      type="button"
      class="hud__btn hud__btn--volume"
      :class="{ 'is-open': panelOpen }"
      :aria-expanded="panelOpen"
      aria-controls="hud-volume"
      :aria-label="t('hud.volume')"
      @click="panelOpen ? closePanel() : openPanel()"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 16h14" /><circle cx="9" cy="8" r="2" /><circle cx="15" cy="16" r="2" /></svg>
    </button>

    <div v-show="panelOpen && soundOn && !soundError" id="hud-volume" class="hud__volume" role="group" :aria-label="t('hud.volume')">
      <input
        class="hud__range"
        type="range"
        min="0"
        max="100"
        step="1"
        :aria-label="t('hud.volume')"
        :value="volumePct"
        :style="{ '--fill': volumePct + '%' }"
        @input="onVolume"
      />
      <output class="hud__pct">{{ volumePct }}%</output>
    </div>

    <!-- Day / night: shows the mode you are in (sun or moon); the icons cross-fade as it switches. -->
    <button
      type="button"
      class="hud__btn hud__btn--mode"
      :class="{ 'is-night': mode === 'night' }"
      :aria-pressed="mode === 'night'"
      :aria-label="modeLabel"
      :title="modeLabel"
      @click="$emit('toggle-mode')"
    >
      <svg class="hud__sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>
      <svg class="hud__moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z" /><path class="hud__star" d="M17.2 3.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" /></svg>
    </button>

    <LanguageSwitcher />
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  top: calc(var(--inset-top) + 1rem);
  right: calc(var(--inset-right) + 1rem);
  display: flex;
  gap: 0.5rem;
  pointer-events: auto;
}
.hud__btn {
  display: grid;
  place-items: center;
  min-width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--glass);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  transition: border-color 0.2s, color 0.2s, background-color 0.2s;
}
.hud__btn--text { padding: 0 1rem; font-size: 0.85rem; }
.hud__btn:hover { border-color: var(--mist); }
.hud__btn.is-on, .hud__btn.is-open { border-color: var(--jelly); color: var(--jelly); }
.hud__btn.is-error { border-color: #ff9b8a; color: #ff9b8a; }
.hud__btn svg {
  width: 1.3rem;
  height: 1.3rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hud__volume {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  height: 2.75rem;
  padding: 0 1.1rem;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--glass);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.hud__pct { min-width: 2.6rem; text-align: right; font-size: 0.8rem; font-variant-numeric: tabular-nums; color: var(--mist); }

.hud__range {
  --fill: 70%;
  -webkit-appearance: none;
  appearance: none;
  width: 8.5rem;
  height: 2.75rem; /* full-height touch target around a thin track */
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.hud__range::-webkit-slider-runnable-track { height: 2px; border-radius: 2px; background: linear-gradient(to right, var(--jelly) var(--fill), var(--hairline) var(--fill)); }
.hud__range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 1.15rem;
  height: 1.15rem;
  margin-top: calc((2px - 1.15rem) / 2);
  border: 0;
  border-radius: 50%;
  background: var(--foam);
  box-shadow: 0 0 0 4px rgba(183, 162, 255, 0.28);
}
.hud__range::-moz-range-track { height: 2px; border-radius: 2px; background: var(--hairline); }
.hud__range::-moz-range-progress { height: 2px; border-radius: 2px; background: var(--jelly); }
.hud__range::-moz-range-thumb { width: 1.15rem; height: 1.15rem; border: 0; border-radius: 50%; background: var(--foam); box-shadow: 0 0 0 4px rgba(183, 162, 255, 0.28); }

@media (max-width: 640px) {
  .hud__range { width: min(8.5rem, 38vw); }
}
/* Day / night icon: the sun turns away as the moon comes in. */
.hud__btn--mode { position: relative; }
.hud__btn--mode svg { position: absolute; inset: 0; margin: auto; transition: opacity 0.6s, transform 0.6s; }
.hud__moon { opacity: 0; transform: rotate(-40deg) scale(0.7); }
.hud__btn--mode.is-night .hud__sun { opacity: 0; transform: rotate(60deg) scale(0.7); }
.hud__btn--mode.is-night .hud__moon { opacity: 1; transform: none; }
.hud__btn--mode.is-night { border-color: rgba(183, 162, 255, 0.55); }
.hud__star { fill: currentColor; stroke: none; }

/* Narrow phones: keep the row clear of the brand on the left. The volume button gives way to the language
   button; the volume slider still opens whenever sound is switched on. */
@media (max-width: 440px) {
  .hud__btn--volume { display: none; }
  .hud { top: calc(var(--inset-top) + 0.85rem); right: calc(var(--inset-right) + 0.75rem); gap: 0.35rem; }
  .hud__btn { min-width: 2.35rem; height: 2.35rem; }
  .hud__btn--text { padding: 0 0.65rem; font-size: 0.74rem; }
}
/* Phones up to 400 px: fullscreen gives way to day / night and language (phone browsers hide their own bars
   while scrolling anyway; iPhones never offer it), so long Uzbek and Russian names still fit beside the row. */
@media (max-width: 400px) {
  .hud__btn--fullscreen { display: none; }
}
/* The smallest phones (320 px wide): a little tighter still. */
@media (max-width: 360px) {
  .hud { gap: 0.3rem; right: calc(var(--inset-right) + 0.6rem); }
  .hud__btn { min-width: 2.3rem; height: 2.3rem; }
  .hud__btn--text { padding: 0 0.55rem; font-size: 0.7rem; }
}
</style>
