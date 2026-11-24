<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import gsap from '@/core/gsap';
import { appState } from '@/state/appState';
import { buildIntroIn, hideIntroUi } from '@/core/introTimelines';
import { createIntroInteractions } from '@/core/introInteractions';
import ScrollIndicator from './ScrollIndicator.vue';

const emit = defineEmits(['start']);

const root = ref(null);
let ctx = null;
let interactions = null;

onMounted(() => {
  ctx = gsap.context(() => hideIntroUi(root.value), root.value);
  interactions = createIntroInteractions({
    root: root.value,
    isActive: () => appState.loading.done && appState.story.chapter === 0,
  });
});

onBeforeUnmount(() => {
  interactions?.dispose();
  ctx?.revert();
});

// Timelines are created inside the context so they are cleaned up with the component.
function make(build) {
  let tl = null;
  ctx.add(() => { tl = build(root.value); });
  return tl;
}

// The scroll story fades the whole intro (`el`) away as the descent begins; its parts belong to playIn.
defineExpose({
  playIn: () => make(buildIntroIn),
  el: () => root.value,
});
</script>

<template>
  <section ref="root" class="intro" aria-label="Ocean Explorer">
    <div class="intro__scrim" data-part="scrim" aria-hidden="true"></div>

    <div class="intro__content">
      <div class="layer" data-depth="1">
        <h1 class="intro__title" data-part="title">
          <span class="intro__word">OCEAN</span> <span class="intro__word">EXPLORER</span>
        </h1>
      </div>

      <div class="layer" data-depth="0.7">
        <div class="intro__rule" data-part="rule" aria-hidden="true"></div>
        <p class="intro__subtitle" aria-label="Descend into the unknown">
          <span data-part="word" aria-hidden="true">DESCEND</span>
          <span data-part="word" aria-hidden="true">INTO</span>
          <span data-part="word" aria-hidden="true">THE</span>
          <span data-part="word" aria-hidden="true">UNKNOWN</span>
        </p>
      </div>

      <div class="layer layer--button" data-depth="0.45" data-magnetic>
        <button type="button" class="intro__start" data-part="start" @click="emit('start', 'button')">
          <span class="intro__start-glow" aria-hidden="true"></span>
          <span class="intro__start-label">START EXPEDITION</span>
          <svg class="intro__start-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>

    <div class="intro__bar">
      <div class="layer intro__side intro__side--left" data-depth="0.25">
        <dl class="intro__facts">
          <div data-part="fact"><dt>Expedition</dt><dd>01 · Challenger Deep</dd></div>
          <div data-part="fact"><dt>Position</dt><dd>11°22′ N · 142°35′ E</dd></div>
        </dl>
      </div>

      <ScrollIndicator class="intro__scroll" data-part="scroll" @activate="emit('start', 'scroll')" />

      <div class="layer intro__side intro__side--right" data-depth="0.25">
        <dl class="intro__facts">
          <div data-part="fact"><dt>Target depth</dt><dd>≈ 11,000 m</dd></div>
          <div data-part="fact"><dt>Conditions</dt><dd>Calm seas · Golden hour</dd></div>
        </dl>
      </div>
    </div>
  </section>
</template>

<style scoped>
.intro { position: absolute; inset: 0; pointer-events: none; color: #f4fbfc; }

/* Darkens the lower part of the frame so the type stays legible over the bright glitter path. */
.intro__scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to top, rgba(2, 10, 20, 0.84) 0%, rgba(2, 10, 20, 0.52) 34%, rgba(2, 10, 20, 0) 64%),
    radial-gradient(60% 34% at 50% 66%, rgba(2, 10, 20, 0.35), transparent 100%);
}

.intro__content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding: 0 1.5rem calc(var(--inset-bottom) + 9.5rem);
  text-align: center;
}

.intro__title {
  --track: 0.26em;
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(1.9rem, 5vw, 4.2rem);
  line-height: 1.08;
  letter-spacing: var(--track);
  margin-right: calc(var(--track) * -1); /* trailing letter-spacing would push the text off-centre */
  text-shadow: 0 2px 36px rgba(2, 12, 22, 0.55);
}
.intro__word { display: inline-block; }

.intro__rule {
  width: min(14rem, 44vw);
  height: 1px;
  margin: 1.6rem auto 1.3rem;
  background: linear-gradient(to right, transparent, rgba(215, 241, 242, 0.7), transparent);
}

.intro__subtitle {
  margin: 0;
  font-size: clamp(0.7rem, 1.5vw, 0.92rem);
  letter-spacing: 0.42em;
  margin-right: -0.42em;
  color: rgba(215, 241, 242, 0.86);
  text-shadow: 0 1px 18px rgba(2, 12, 22, 0.6);
}
.intro__subtitle span { display: inline-block; margin: 0 0.35em; }

.layer--button { margin-top: 2.4rem; }

.intro__start {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.9rem;
  min-height: 3.4rem;
  padding: 0 2.1rem 0 2.4rem;
  border: 1px solid rgba(215, 241, 242, 0.5);
  border-radius: 999px;
  background: rgba(6, 26, 38, 0.38);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  color: #f4fbfc;
  font-size: 0.8rem;
  letter-spacing: 0.3em;
  pointer-events: auto;
  overflow: hidden;
  /* No transform here: GSAP animates this element's transform, and a CSS transition on it would lag behind. */
  transition: border-color 0.35s, background-color 0.35s, letter-spacing 0.35s;
}
.intro__start-label { position: relative; }
.intro__start-arrow {
  position: relative;
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.35s;
}
/* A soft light that follows the pointer across the button. */
.intro__start-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(130px circle at var(--mx, 50%) var(--my, 50%), rgba(183, 162, 255, 0.34), transparent 70%);
  opacity: 0;
  transition: opacity 0.35s;
}
.intro__start:active { border-color: var(--foam); background: rgba(10, 44, 63, 0.72); } /* press feedback on touch and mouse */

/* Hover effects only where hover exists, so touch screens never get a stuck hover state. */
@media (hover: hover) {
  .intro__start:hover { border-color: var(--jelly); background: rgba(10, 44, 63, 0.5); letter-spacing: 0.34em; }
  .intro__start:hover .intro__start-glow { opacity: 1; }
  .intro__start:hover .intro__start-arrow { transform: translateX(5px); }
}

.intro__bar {
  position: absolute;
  left: calc(var(--inset-left) + 1.5rem);
  right: calc(var(--inset-right) + 1.5rem);
  bottom: calc(var(--inset-bottom) + 1.25rem);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: end;
  gap: 1rem;
}
.intro__side--right { justify-self: end; text-align: right; }
.intro__facts { display: grid; gap: 0.75rem; margin: 0; }
.intro__facts dt { font-size: 0.62rem; letter-spacing: 0.22em; color: var(--mist); }
.intro__facts dd { margin: 0.2rem 0 0; font-size: 0.74rem; letter-spacing: 0.1em; font-variant-numeric: tabular-nums; color: rgba(215, 241, 242, 0.92); }
.intro__facts dt { text-transform: uppercase; }

/* Phones in portrait: details tuck under the button in two compact columns, the cue sits above them. */
@media (max-width: 640px) {
  .intro__title { font-size: clamp(1.9rem, 9.4vw, 3rem); }
  .intro__word { display: block; }
  .intro__content { padding-bottom: calc(var(--inset-bottom) + 12rem); }
  .intro__start { min-height: 3.25rem; padding: 0 1.7rem 0 1.9rem; font-size: 0.76rem; }
  .intro__bar { grid-template-columns: 1fr 1fr; grid-template-areas: 'cue cue' 'left right'; row-gap: 0.6rem; left: calc(var(--inset-left) + 1.1rem); right: calc(var(--inset-right) + 1.1rem); bottom: calc(var(--inset-bottom) + 0.9rem); }
  .intro__scroll { grid-area: cue; justify-self: center; }
  .intro__side--left { grid-area: left; }
  .intro__side--right { grid-area: right; }
  .intro__facts { gap: 0.5rem; }
  .intro__facts dd { font-size: 0.68rem; letter-spacing: 0.06em; }
}

/* Short landscape screens (phones on their side): keep only title, subtitle and button. */
@media (max-height: 520px) {
  .intro__content { padding-bottom: calc(var(--inset-bottom) + 1.5rem); }
  .intro__title { font-size: clamp(1.6rem, 7vh, 2.6rem); }
  .intro__word { display: inline-block; }
  .intro__rule { margin: 0.9rem auto 0.8rem; }
  .layer--button { margin-top: 1.2rem; }
  .intro__bar { display: none; }
}
</style>
