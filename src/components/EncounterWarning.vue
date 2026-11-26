<script setup>
import { t } from '@/i18n';

/*
 * The megalodon's warning, in the middle of the screen: XAVF ANIQLANDI / MEGALODON YAQINLASHMOQDA (in the chosen
 * language), red, with a soft red glow. It flickers on like a failing display, holds with a slow pulse, and fades.
 * The edges of the screen glow faintly red while it shows. With "less motion" it simply fades in and out.
 * Under it, while it shows, the "less motion" switch (before the shark reaches the camera). Afterwards a small
 * hint: tap the shark for the information card. Shown only in night mode (the scene never raises it by day).
 */
defineProps({
  warning: Boolean,
  hint: Boolean,
  calm: Boolean,
});
defineEmits(['toggle-calm']);
</script>

<template>
  <div class="encounter" :class="{ 'is-calm': calm }">
    <Transition name="edge">
      <div v-if="warning" class="encounter__edge" aria-hidden="true"></div>
    </Transition>
    <Transition name="warn">
      <div v-if="warning" class="encounter__warn" role="alert" aria-live="assertive">
        <span class="encounter__rule" aria-hidden="true"></span>
        <p class="encounter__title">{{ t('megalodon.warning.title') }}</p>
        <p class="encounter__sub">{{ t('megalodon.warning.subtitle') }}</p>
        <span class="encounter__rule" aria-hidden="true"></span>
        <button
          type="button"
          class="encounter__calm"
          data-ui
          :aria-pressed="calm"
          :aria-label="t('megalodon.calm.aria')"
          @click="$emit('toggle-calm')"
        >
          <span class="encounter__dot" aria-hidden="true"></span>{{ t('megalodon.calm.label') }}
        </button>
      </div>
    </Transition>
    <Transition name="hint">
      <p v-if="hint && !warning" class="encounter__hint">{{ t('megalodon.hint') }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.encounter { position: absolute; inset: 0; pointer-events: none; z-index: 3; }

.encounter__warn {
  position: absolute;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%);
  width: min(34rem, 100% - 2.5rem);
  display: grid;
  justify-items: center;
  gap: 0.55rem;
  text-align: center;
  color: #ff4a3d;
}
.encounter__title {
  margin: 0;
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: clamp(1.45rem, 4.6vw, 2.4rem);
  letter-spacing: 0.32em;
  margin-right: -0.32em; /* the tracking after the last letter would push it off centre */
  text-shadow: 0 0 14px rgba(255, 40, 30, 0.55), 0 0 42px rgba(255, 20, 10, 0.3);
  animation: flicker-on 0.75s steps(1, end) both, pulse 1.6s ease-in-out 0.75s infinite;
}
.encounter__sub {
  margin: 0;
  font-size: clamp(0.72rem, 2.2vw, 0.95rem);
  font-weight: 500;
  letter-spacing: 0.38em;
  margin-right: -0.38em;
  color: rgba(255, 150, 140, 0.92);
  text-shadow: 0 0 10px rgba(255, 40, 30, 0.45);
  animation: flicker-on 0.75s steps(1, end) 0.12s both;
}
.encounter__rule {
  display: block;
  width: min(15rem, 60%);
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 70, 60, 0.85), transparent);
  box-shadow: 0 0 8px rgba(255, 40, 30, 0.6);
  animation: rule-in 0.6s ease-out both;
}
.encounter__calm {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.9rem;
  min-height: 2.5rem;
  padding: 0 1rem;
  border: 1px solid rgba(255, 120, 110, 0.35);
  border-radius: 999px;
  background: rgba(20, 4, 6, 0.45);
  color: rgba(255, 210, 205, 0.9);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  transition: border-color 0.2s, color 0.2s;
}
.encounter__calm:hover, .encounter__calm:focus-visible { border-color: rgba(255, 150, 140, 0.8); }
.encounter__dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; border: 1px solid currentColor; }
.encounter__calm[aria-pressed='true'] .encounter__dot { background: currentColor; }

/* The edges of the screen glow faintly red while the warning shows. */
.encounter__edge {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(160, 10, 6, 0.3) 100%);
  animation: edge-pulse 1.6s ease-in-out infinite;
}

.encounter__hint {
  position: absolute;
  left: 50%;
  top: calc(var(--inset-top) + 5.4rem);
  transform: translateX(-50%);
  margin: 0;
  max-width: calc(100% - 2rem);
  padding: 0.5rem 1rem;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--glass);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--foam);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}

@keyframes flicker-on {
  0% { opacity: 0; }
  12% { opacity: 1; }
  20% { opacity: 0.2; }
  32% { opacity: 1; }
  44% { opacity: 0.45; }
  52% { opacity: 1; }
  70% { opacity: 0.8; }
  78%, 100% { opacity: 1; }
}
@keyframes pulse {
  0%, 100% { text-shadow: 0 0 14px rgba(255, 40, 30, 0.55), 0 0 42px rgba(255, 20, 10, 0.3); }
  50% { text-shadow: 0 0 18px rgba(255, 50, 40, 0.75), 0 0 56px rgba(255, 20, 10, 0.42); }
}
@keyframes rule-in { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
@keyframes edge-pulse { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }

.warn-enter-active { transition: opacity 0.25s ease-out; }
.warn-leave-active { transition: opacity 0.6s ease-in, filter 0.6s ease-in; }
.warn-enter-from { opacity: 0; }
.warn-leave-to { opacity: 0; filter: blur(4px); }
.edge-enter-active, .edge-leave-active { transition: opacity 0.6s; }
.edge-enter-from, .edge-leave-to { opacity: 0; }
.hint-enter-active, .hint-leave-active { transition: opacity 0.5s, transform 0.5s; }
.hint-enter-from, .hint-leave-to { opacity: 0; transform: translate(-50%, -6px); }

/* Less motion: no flicker, no pulsing; a plain fade. */
.is-calm .encounter__title, .is-calm .encounter__sub, .is-calm .encounter__rule, .is-calm .encounter__edge { animation: none; }
.is-calm .encounter__edge { opacity: 0.7; }

@media (max-width: 440px) {
  .encounter__warn { top: 38%; }
  .encounter__title { letter-spacing: 0.22em; margin-right: -0.22em; }
  .encounter__sub { letter-spacing: 0.24em; margin-right: -0.24em; }
  .encounter__hint { top: calc(var(--inset-top) + 4.6rem); font-size: 0.72rem; }
}
</style>
