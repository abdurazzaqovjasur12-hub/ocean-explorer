<script setup>
import { computed } from 'vue';
import { LOCALES, locale, t, tFor } from '@/i18n';

defineEmits(['replay', 'explore']);

// One span per letter (inside one per word, so lines only break between words): the story timeline brings
// them in one by one as the scroll reaches the end. Each language keeps its own set of letters, all animated
// together, and only the current one is shown: switching language never leaves letters out of the animation.
const titleWords = (lang) => tFor(lang, 'end.title').split(' ').map((w) => Array.from(w));
// Long words (Uzbek, Russian) scale the title down on narrow screens rather than overflow.
const titleFit = computed(() => ({ '--word-chars': Math.max(...titleWords(locale.value).map((w) => w.length)) }));
</script>

<template>
  <section class="end" data-end aria-labelledby="end-title">
    <div class="end__scrim" data-end-scrim aria-hidden="true"></div>
    <div class="end__content">
      <p class="end__kicker" data-end-part>{{ t('end.kicker') }}</p>
      <h2 id="end-title" class="end__title" :aria-label="t('end.title')" :style="titleFit">
        <span v-for="lang in LOCALES" v-show="lang === locale" :key="lang" class="end__lang" data-end-lang aria-hidden="true">
          <span v-for="(word, w) in titleWords(lang)" :key="w" class="end__word">
            <span v-for="(ch, c) in word" :key="c" class="end__char" data-end-char>{{ ch }}</span>
          </span>
        </span>
      </h2>
      <div class="end__rule" data-end-rule aria-hidden="true"></div>
      <p class="end__note" data-end-part>{{ t('end.note') }}</p>
      <div class="end__actions" data-end-part>
        <button type="button" class="end__btn end__btn--primary" data-ui @click="$emit('replay')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" /></svg>
          <span>{{ t('end.replay') }}</span>
        </button>
        <button type="button" class="end__btn" data-ui @click="$emit('explore')">
          <span>{{ t('end.explore') }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.end {
  position: absolute;
  inset: 0;
  display: grid;
  align-items: end;
  pointer-events: none; /* only the buttons take input: scrolling and swiping over the rest still scroll */
  visibility: hidden; /* revealed by the story timeline */
  opacity: 0;
}
/* Shade low in the frame, so the words read over the bright sea and sky. */
.end__scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to top, rgba(2, 10, 20, 0.86) 0%, rgba(2, 10, 20, 0.55) 38%, rgba(2, 10, 20, 0) 70%),
    radial-gradient(60% 34% at 50% 70%, rgba(2, 10, 20, 0.35), transparent 100%);
}
.end__content {
  position: relative;
  display: grid;
  justify-items: center;
  padding: 0 1.5rem calc(var(--inset-bottom) + 5.5rem);
  text-align: center;
}
.end__kicker {
  margin: 0 0 1.2rem;
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  margin-right: -0.32em;
  text-transform: uppercase;
  color: rgba(215, 241, 242, 0.85);
  text-shadow: 0 1px 14px rgba(2, 12, 22, 0.8);
}
.end__title {
  --track: 0.18em;
  margin: 0;
  max-width: 18em; /* two lines on wide screens: THE OCEAN IS STILL / UNEXPLORED */
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(1.8rem, 4.6vw, 3.8rem);
  line-height: 1.15;
  letter-spacing: var(--track);
  margin-right: calc(var(--track) * -1);
  color: #f4fbfc;
  text-transform: uppercase;
  text-shadow: 0 2px 36px rgba(2, 12, 22, 0.6);
}
.end__lang { display: inline; }
.end__word { display: inline-block; white-space: nowrap; margin: 0 0.22em; }
.end__char { display: inline-block; }
.end__rule {
  width: min(14rem, 44vw);
  height: 1px;
  margin: 1.5rem auto 1.2rem;
  background: linear-gradient(to right, transparent, rgba(215, 241, 242, 0.7), transparent);
}
.end__note {
  max-width: 30rem;
  margin: 0;
  font-size: clamp(0.88rem, 1.3vw, 1rem);
  line-height: 1.6;
  color: rgba(215, 241, 242, 0.86);
  text-wrap: pretty;
}
.end__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.8rem;
  margin-top: 2rem;
}
.end__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  min-height: 3.1rem;
  padding: 0 1.7rem;
  border: 1px solid rgba(215, 241, 242, 0.45);
  border-radius: 999px;
  background: rgba(6, 26, 38, 0.38);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  color: #f4fbfc;
  font-size: 0.76rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  pointer-events: auto;
  touch-action: manipulation; /* no double-tap zoom delay on phones */
  transition: border-color 0.3s, background-color 0.3s;
}
.end__btn--primary { border-color: var(--jelly); background: rgba(70, 52, 140, 0.32); }
.end__btn svg { width: 1.05rem; height: 1.05rem; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.end__btn:active { background: rgba(10, 44, 63, 0.75); }
@media (hover: hover) {
  .end__btn:hover { border-color: var(--foam); background: rgba(10, 44, 63, 0.6); }
  .end__btn--primary:hover { background: rgba(90, 70, 170, 0.45); }
}

/* Phones: buttons stacked full width, comfortably above the progress bar and the home indicator. */
@media (max-width: 640px) {
  .end__content { padding: 0 1.1rem calc(var(--inset-bottom) + 4.25rem); }
  .end__title { font-size: min(clamp(1.6rem, 8vw, 2.4rem), calc((100vw - 3rem) / (var(--word-chars, 10) * 0.9))); --track: 0.12em; }
  .end__actions { flex-direction: column; align-self: stretch; width: 100%; max-width: 22rem; margin-inline: auto; }
  .end__btn { width: 100%; min-height: 3.25rem; }
}
/* Short landscape screens: tighter. */
@media (max-height: 520px) {
  .end__content { padding-bottom: calc(var(--inset-bottom) + 3rem); }
  .end__kicker, .end__rule { display: none; }
  .end__note { font-size: 0.82rem; }
  .end__actions { margin-top: 1rem; }
}
</style>
