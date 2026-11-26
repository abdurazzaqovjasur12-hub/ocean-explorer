<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { t } from '@/i18n';

/*
 * The megalodon's information card: opened by tapping the shark during an encounter (night mode only).
 * Every line is marked as confirmed (from the fossil record), an estimate (a scientists' calculation, given as a
 * range) or a hypothesis (a leading but debated explanation), and the card says plainly that the model is a
 * reconstruction. All of it is in the translations (megalodon.card.*), so it follows the chosen language.
 * A panel on the right on wide screens, a sheet from the bottom on phones. Esc, the close button or a tap
 * outside it closes it. Only the card itself takes taps: the HUD, the scene and the scroll stay usable around it.
 */
const props = defineProps({
  open: Boolean,
  calm: Boolean,
});
const emit = defineEmits(['close', 'toggle-calm']);

const rows = [
  { id: 'status', tag: 'confirmed' },
  { id: 'length', tag: 'estimate' },
  { id: 'weight', tag: 'estimate' },
  { id: 'period', tag: 'confirmed' },
  { id: 'habitat', tag: 'confirmed' },
  { id: 'diet', tag: 'confirmed' },
];
const facts = [
  { id: 'f1', tag: 'confirmed' },
  { id: 'f2', tag: 'confirmed' },
  { id: 'f3', tag: 'estimate' },
  { id: 'f4', tag: 'hypothesis' },
  { id: 'f5', tag: 'hypothesis' },
  { id: 'f6', tag: 'estimate' },
  { id: 'f7', tag: 'confirmed' },
];

const closeBtn = ref(null);
const card = ref(null);
let returnFocus = null;
const onKey = (e) => { if (e.key === 'Escape') emit('close'); };
// A tap anywhere else closes it (a tap on the shark opens it again on release).
const onOutside = (e) => { if (card.value && !card.value.contains(e.target)) emit('close'); };
watch(() => props.open, async (open) => {
  if (open) {
    returnFocus = document.activeElement;
    window.addEventListener('keydown', onKey);
    await nextTick();
    window.addEventListener('pointerdown', onOutside, true);
    closeBtn.value?.focus({ preventScroll: true });
  } else {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', onOutside, true);
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('pointerdown', onOutside, true);
});
</script>

<template>
  <Transition name="card">
    <div v-if="open" class="meg">
      <section ref="card" class="meg__card" data-ui role="dialog" aria-modal="false" aria-labelledby="meg-title">
        <header class="meg__head">
          <p class="meg__kicker">{{ t('megalodon.card.kicker') }}</p>
          <h2 id="meg-title" class="meg__name">{{ t('megalodon.card.name') }}</h2>
          <p class="meg__sci"><i>{{ t('megalodon.card.scientific') }}</i></p>
          <button ref="closeBtn" type="button" class="meg__close" :aria-label="t('megalodon.card.close')" @click="$emit('close')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div class="meg__body">
          <p class="meg__legend">{{ t('megalodon.card.legend') }}</p>
          <dl class="meg__rows">
            <div v-for="r in rows" :key="r.id" class="meg__row">
              <dt>{{ t(`megalodon.card.${r.id}.label`) }} <span class="meg__tag" :class="`is-${r.tag}`">{{ t(`megalodon.card.tags.${r.tag}`) }}</span></dt>
              <dd>{{ t(`megalodon.card.${r.id}.value`) }}</dd>
            </div>
          </dl>

          <h3 class="meg__sub">{{ t('megalodon.card.factsTitle') }}</h3>
          <ul class="meg__facts">
            <li v-for="f in facts" :key="f.id">
              <span class="meg__tag" :class="`is-${f.tag}`">{{ t(`megalodon.card.tags.${f.tag}`) }}</span>
              {{ t(`megalodon.card.facts.${f.id}`) }}
            </li>
          </ul>

          <p class="meg__note">{{ t('megalodon.card.note') }}</p>
          <button type="button" class="meg__calm" :aria-pressed="calm" :aria-label="t('megalodon.calm.aria')" @click="$emit('toggle-calm')">
            <span class="meg__dot" aria-hidden="true"></span>{{ t('megalodon.calm.label') }}
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.meg {
  position: absolute;
  inset: 0;
  z-index: 7; /* over the veil (6): it is opened on purpose */
  pointer-events: none; /* only the card takes taps */
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: calc(var(--inset-top) + 4.5rem) calc(var(--inset-right) + 1.25rem) calc(var(--inset-bottom) + 1.25rem) 1.25rem;
  background: linear-gradient(90deg, transparent 40%, rgba(1, 6, 12, 0.45));
}
.meg__card {
  position: relative;
  pointer-events: auto;
  width: min(25rem, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hairline);
  border-radius: 1.25rem;
  background: rgba(4, 16, 26, 0.78);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
}
.meg__head { position: relative; padding: 1.3rem 1.4rem 1rem; border-bottom: 1px solid var(--hairline); }
.meg__kicker { margin: 0 0 0.35rem; font-size: 0.66rem; letter-spacing: 0.28em; text-transform: uppercase; color: var(--mist); }
.meg__name { margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 1.9rem; line-height: 1.1; }
.meg__sci { margin: 0.25rem 0 0; font-size: 0.95rem; color: rgba(215, 241, 242, 0.8); }
.meg__close {
  position: absolute;
  top: 0.9rem;
  right: 0.9rem;
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid var(--hairline);
  border-radius: 50%;
  background: transparent;
  transition: border-color 0.2s;
}
.meg__close:hover, .meg__close:focus-visible { border-color: var(--jelly); }
.meg__close svg { width: 1.1rem; height: 1.1rem; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }

.meg__body { padding: 1rem 1.4rem 1.3rem; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.meg__legend { margin: 0 0 0.9rem; font-size: 0.72rem; line-height: 1.5; color: var(--mist); }
.meg__rows { margin: 0; display: grid; gap: 0.8rem; }
.meg__row dt { font-size: 0.7rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mist); display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; }
.meg__row dd { margin: 0.25rem 0 0; font-size: 0.86rem; line-height: 1.5; }
.meg__sub { margin: 1.3rem 0 0.6rem; font-size: 0.7rem; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--mist); }
.meg__facts { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.7rem; }
.meg__facts li { font-size: 0.84rem; line-height: 1.5; }
.meg__facts .meg__tag { margin-right: 0.35rem; }
.meg__tag {
  display: inline-block;
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: 0.08em;
  border: 1px solid;
}
.meg__tag.is-confirmed { color: #8fe3c8; border-color: rgba(143, 227, 200, 0.45); }
.meg__tag.is-estimate { color: #f3cf86; border-color: rgba(243, 207, 134, 0.45); }
.meg__tag.is-hypothesis { color: #c3b4ff; border-color: rgba(195, 180, 255, 0.45); }
.meg__note { margin: 1.2rem 0 0; padding-top: 0.9rem; border-top: 1px solid var(--hairline); font-size: 0.74rem; line-height: 1.55; color: var(--mist); }
.meg__calm {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  min-height: 2.5rem;
  padding: 0 1rem;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: transparent;
  font-size: 0.78rem;
}
.meg__calm:hover, .meg__calm:focus-visible { border-color: var(--jelly); }
.meg__dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; border: 1px solid currentColor; }
.meg__calm[aria-pressed='true'] .meg__dot { background: currentColor; }

.card-enter-active, .card-leave-active { transition: opacity 0.35s ease; }
.card-enter-active .meg__card, .card-leave-active .meg__card { transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1); }
.card-enter-from, .card-leave-to { opacity: 0; }
.card-enter-from .meg__card, .card-leave-to .meg__card { transform: translateX(1.5rem); }

/* Phones: a sheet from the bottom, most of the screen high. */
@media (max-width: 640px) {
  .meg {
    align-items: flex-end;
    justify-content: center;
    padding: calc(var(--inset-top) + 4rem) 0 0;
    background: linear-gradient(180deg, transparent 30%, rgba(1, 6, 12, 0.5));
  }
  .meg__card { width: 100%; max-height: 82vh; border-radius: 1.25rem 1.25rem 0 0; border-bottom: 0; padding-bottom: var(--inset-bottom); }
  .card-enter-from .meg__card, .card-leave-to .meg__card { transform: translateY(2rem); }
  .meg__name { font-size: 1.6rem; }
}
</style>
