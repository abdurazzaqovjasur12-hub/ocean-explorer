<script setup>
import { CHAPTERS } from '@/config/story';

// The text of every chapter after the surface (the intro screen is the surface's text). All of it is in
// the DOM from the start; the story timeline reveals and hides each block as the scroll reaches it.
const beats = CHAPTERS.filter((c) => c.title);
</script>

<template>
  <div class="overlay">
    <article
      v-for="c in beats"
      :key="c.id"
      class="beat"
      :data-beat="c.id"
      :aria-label="c.label"
    >
      <p class="beat__kicker" data-line>{{ c.kicker }}</p>
      <h2 class="beat__title" data-line data-title>{{ c.title }}</h2>
      <p class="beat__text" data-line>{{ c.text }}</p>
    </article>
  </div>
</template>

<style scoped>
.overlay { position: absolute; inset: 0; pointer-events: none; }

.beat {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(var(--inset-bottom) + 4.75rem);
  width: min(36rem, 100% - 3rem);
  margin-inline: auto;
  text-align: center;
  isolation: isolate; /* keeps the shade below (::before) behind the text, not behind the scene */
  visibility: hidden; /* revealed by the story timeline */
  opacity: 0;
}
/* A soft pool of shade behind the words, so they read over bright water and sky alike. */
.beat::before {
  content: '';
  position: absolute;
  inset: -3rem -4rem;
  z-index: -1;
  background: radial-gradient(closest-side, rgba(2, 10, 18, 0.55), transparent);
}
.beat [data-line] { opacity: 0; }

.beat__kicker {
  margin: 0 0 0.9rem;
  font-size: 0.68rem;
  letter-spacing: 0.32em;
  margin-right: -0.32em;
  text-transform: uppercase;
  color: var(--mist);
  font-variant-numeric: tabular-nums;
}
.beat__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(2rem, 4.6vw, 3.5rem);
  line-height: 1.08;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 30px rgba(2, 12, 22, 0.6);
}
.beat__text {
  margin: 1rem auto 0;
  max-width: 30rem;
  font-size: clamp(0.92rem, 1.4vw, 1.05rem);
  line-height: 1.6;
  color: rgba(215, 241, 242, 0.88);
  text-shadow: 0 1px 16px rgba(2, 12, 22, 0.7);
  text-wrap: pretty;
}


/* Phones: a little higher, clear of the progress bar along the bottom edge. */
@media (max-width: 640px) {
  .beat { bottom: calc(var(--inset-bottom) + 4.25rem); width: calc(100% - 2.2rem); }
  .beat__kicker { font-size: 0.62rem; margin-bottom: 0.7rem; }
  .beat__text { font-size: 0.9rem; line-height: 1.55; }
}
/* Short landscape screens: keep the block compact. */
@media (max-height: 520px) {
  .beat { bottom: calc(var(--inset-bottom) + 3rem); width: max(16rem, min(30rem, 100% - 21rem)); }
  .beat__title { font-size: clamp(1.5rem, 7vh, 2.2rem); }
  .beat__text { margin-top: 0.5rem; font-size: 0.85rem; line-height: 1.45; }
}
</style>
