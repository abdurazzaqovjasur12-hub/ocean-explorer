<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import gsap from '@/core/gsap';
import { motionDuration } from '@/utils/motion';
import { t } from '@/i18n';

const props = defineProps({
  progress: { type: Number, default: 0 }, // 0..1
  label: { type: String, default: '' }, // a translation key (loading.*)
  ready: Boolean,
  error: { type: String, default: null }, // a translation key (loading.error*)
});
// 'leaving': the fade-out starts (the scene can begin underneath it); 'hidden': it is gone.
const emit = defineEmits(['leaving', 'hidden']);

const root = ref(null);
const display = reactive({ value: 0 }); // eased value shown to the user
const percent = computed(() => Math.round(display.value * 100));
let hiding = false;

function maybeHide() {
  if (hiding || !props.ready || display.value < 0.999) return;
  hiding = true;
  emit('leaving');
  gsap.to(root.value, {
    opacity: 0,
    duration: motionDuration(0.9),
    delay: motionDuration(0.25),
    ease: 'power1.inOut',
    onComplete: () => emit('hidden'),
  });
}

watch(() => props.progress, (p) => {
  gsap.to(display, { value: p, duration: motionDuration(0.6), overwrite: true, onComplete: maybeHide });
});
watch(() => props.ready, maybeHide);

onBeforeUnmount(() => {
  gsap.killTweensOf(display);
  if (root.value) gsap.killTweensOf(root.value);
});
</script>

<template>
  <div
    ref="root"
    class="loader"
    role="progressbar"
    :aria-label="t('loading.aria')"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="percent"
  >
    <div v-if="error" class="loader__error">
      <h2>{{ t('loading.errorTitle') }}</h2>
      <p>{{ t(error) }}</p>
    </div>
    <template v-else>
      <p class="loader__percent">
        <span class="loader__num">{{ percent }}</span><span class="loader__sign">%</span>
      </p>
      <p class="loader__label">{{ label ? t(label) : '' }}</p>
      <div class="loader__bar"><span class="loader__fill" :style="{ transform: `scaleX(${display.value})` }"></span></div>
    </template>
  </div>
</template>

<style scoped>
.loader {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: calc(var(--inset-top) + 1.5rem) 1.5rem calc(var(--inset-bottom) + 1.5rem);
  background: radial-gradient(120% 90% at 50% 20%, var(--deep) 0%, var(--abyss) 70%);
  text-align: center;
}
.loader__percent { margin: 0; font-family: var(--font-display); line-height: 1; }
.loader__num {
  font-size: clamp(5rem, 22vw, 10rem);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.loader__sign { font-size: clamp(1.5rem, 5vw, 2.5rem); color: var(--mist); margin-left: 0.2em; }
.loader__label { margin: 1.25rem 0 1.75rem; color: var(--mist); font-size: 0.95rem; min-height: 1.4em; }
.loader__bar { width: min(18rem, 70vw); height: 2px; background: var(--hairline); overflow: hidden; }
.loader__fill { display: block; height: 100%; background: var(--jelly); transform-origin: left center; }
.loader__error h2 { font-family: var(--font-display); font-weight: 500; font-size: 1.6rem; margin: 0 0 0.75rem; }
.loader__error p { margin: 0; max-width: 28rem; color: var(--mist); line-height: 1.5; }
</style>
