<script setup>
import { CHAPTERS, CHAPTER_STARTS, STORY_LENGTH } from '@/config/story';
import { t } from '@/i18n';

defineProps({
  progress: { type: Number, default: 0 }, // 0..1 along the whole story
  active: { type: Number, default: 0 }, // current chapter index
});
defineEmits(['navigate']);

// Each chapter's mark sits where it starts along the story, so the gaps show how long each one is.
const marks = CHAPTERS.map((c, i) => ({ ...c, index: i, at: CHAPTER_STARTS[i] / STORY_LENGTH }));
const pad = (n) => String(n).padStart(2, '0');
</script>

<template>
  <nav class="progress" :class="{ 'is-surface': active === 0 }" :style="{ '--p': progress }" :aria-label="t('progress.aria')" data-ui>
    <div
      class="progress__track"
      role="progressbar"
      :aria-label="t('progress.bar')"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(progress * 100)"
    >
      <span class="progress__fill"></span>
    </div>
    <ol class="progress__list">
      <li v-for="m in marks" :key="m.id" class="progress__item" :style="{ '--at': m.at }">
        <button
          type="button"
          class="progress__mark"
          :class="{ 'is-active': m.index === active, 'is-past': m.index < active }"
          :aria-current="m.index === active ? 'step' : undefined"
          :aria-label="t('progress.chapter', { n: m.index + 1, label: t(`chapters.${m.id}.label`) })"
          @click="$emit('navigate', m.index)"
        >
          <span class="progress__dot" aria-hidden="true"></span>
          <span class="progress__label" aria-hidden="true"><small>{{ pad(m.index + 1) }}</small> {{ t(`chapters.${m.id}.label`) }}</span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
/* Desktop: a vertical rail on the right edge. */
.progress {
  position: absolute;
  right: calc(var(--inset-right) + 1.6rem);
  top: 0;
  bottom: 0;
  margin-block: auto;
  height: min(52vh, 26rem);
  width: 2rem;
  pointer-events: none;
}
.progress__track { position: absolute; right: calc(1rem - 1px); top: 0; bottom: 0; width: 2px; background: var(--hairline); }
.progress__fill {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, var(--foam), var(--jelly));
  transform: scaleY(var(--p));
  transform-origin: top;
}
.progress__list { position: absolute; inset: 0; margin: 0; padding: 0; list-style: none; }
.progress__item { position: absolute; right: 0; top: calc(var(--at) * 100%); transform: translateY(-50%); }
.progress__mark {
  position: relative;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  background: none;
  pointer-events: auto;
}
.progress__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--abyss);
  box-shadow: 0 0 0 1px var(--mist);
  transition: transform 0.3s, background-color 0.3s, box-shadow 0.3s;
}
.progress__mark.is-past .progress__dot { background: var(--mist); }
.progress__mark.is-active .progress__dot { background: var(--foam); box-shadow: 0 0 0 4px rgba(183, 162, 255, 0.35); transform: scale(1.25); }
.progress__label {
  position: absolute;
  right: 2.3rem;
  top: 50%;
  transform: translate(6px, -50%);
  white-space: nowrap;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--foam);
  text-shadow: 0 1px 12px rgba(2, 12, 22, 0.8);
  opacity: 0;
  transition: opacity 0.3s, transform 0.3s;
  pointer-events: none;
}
.progress__label small { color: var(--mist); font-size: 0.65rem; margin-right: 0.3rem; font-variant-numeric: tabular-nums; }
.progress__mark.is-active .progress__label,
.progress__mark:focus-visible .progress__label { opacity: 1; transform: translate(0, -50%); }
@media (hover: hover) {
  .progress__mark:hover .progress__label { opacity: 1; transform: translate(0, -50%); }
  .progress__mark:hover .progress__dot { transform: scale(1.3); }
}

/* Phones and narrow windows: a horizontal bar along the bottom edge; the chapter name sits under the brand. */
@media (max-width: 900px) {
  .progress {
    left: calc(var(--inset-left) + 1.1rem);
    right: calc(var(--inset-right) + 1.1rem);
    top: auto;
    bottom: calc(var(--inset-bottom) + 0.9rem);
    margin: 0;
    width: auto;
    height: 2rem;
  }
  .progress__track { left: 0; right: 0; top: calc(1rem - 1px); bottom: auto; width: auto; height: 2px; }
  .progress__fill { background: linear-gradient(to right, var(--foam), var(--jelly)); transform: scaleX(var(--p)); transform-origin: left; }
  .progress__item { right: auto; top: 0; left: calc(var(--at) * 100%); transform: translateX(-50%); }
  .progress__item:first-child { transform: translateX(-0.5rem); }
  .progress__mark { width: 1.75rem; }
  .progress__label { display: none; }
  /* On the surface the intro's own details and scroll cue use the bottom edge. */
  .progress { transition: opacity 0.5s, visibility 0.5s; }
  .progress.is-surface { opacity: 0; visibility: hidden; }
}
</style>
