<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import gsap from '@/core/gsap';
import { buildScrollCue } from '@/core/introTimelines';
import { t } from '@/i18n';

defineEmits(['activate']);

const root = ref(null);
let ctx = null;

// Looping GSAP timeline; the context reverts it when the component unmounts.
onMounted(() => {
  ctx = gsap.context(() => buildScrollCue(root.value), root.value);
});

onBeforeUnmount(() => ctx?.revert());
</script>

<template>
  <button ref="root" type="button" class="scroll" :aria-label="t('scroll.aria')" @click="$emit('activate')">
    <span class="scroll__label scroll__label--mouse">{{ t('scroll.mouse') }}</span>
    <span class="scroll__label scroll__label--touch">{{ t('scroll.touch') }}</span>
    <span class="scroll__track" aria-hidden="true"><span class="scroll__dot" data-dot></span></span>
    <svg class="scroll__chevron" data-chevron viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
  </button>
</template>

<style scoped>
.scroll {
  display: grid;
  justify-items: center;
  gap: 0.55rem;
  min-width: 3.5rem;
  min-height: 2.75rem; /* comfortable touch target */
  padding: 0.25rem 0.75rem;
  border: 0;
  background: none;
  color: var(--mist);
  pointer-events: auto;
}
.scroll__label { font-size: 0.64rem; letter-spacing: 0.34em; margin-right: -0.34em; text-transform: uppercase; white-space: nowrap; }
.scroll__label--touch { display: none; }
@media (pointer: coarse) {
  .scroll__label--mouse { display: none; }
  .scroll__label--touch { display: block; }
}
.scroll__track { position: relative; display: block; width: 1px; height: 2.4rem; background: var(--hairline); overflow: visible; }
.scroll__dot {
  position: absolute;
  left: -2px;
  top: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--foam);
  opacity: 0;
}
.scroll__chevron { width: 1rem; height: 1rem; fill: none; stroke: var(--foam); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; opacity: 0.25; }
</style>
