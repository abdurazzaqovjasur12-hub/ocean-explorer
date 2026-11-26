<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { LOCALES, locale, setLocale, t } from '@/i18n';

// A pill in the HUD showing the current language; it opens a small glass menu with the three languages.
// Keyboard: Enter/Space/Arrow down to open, arrows to move, Enter to choose, Escape to close.
const open = ref(false);
const root = ref(null);
const items = ref([]);
const current = computed(() => locale.value);

function focusItem(i) {
  const list = items.value;
  list[(i + list.length) % list.length]?.focus();
}
async function show(focusCurrent = true) {
  open.value = true;
  document.addEventListener('pointerdown', onOutside, true);
  await nextTick();
  if (focusCurrent) focusItem(LOCALES.indexOf(current.value));
}
function hide(returnFocus = false) {
  open.value = false;
  document.removeEventListener('pointerdown', onOutside, true);
  if (returnFocus) root.value?.querySelector('.lang__toggle')?.focus();
}
const toggle = () => (open.value ? hide() : show());
function onOutside(e) {
  if (!root.value?.contains(e.target)) hide();
}
function choose(lang) {
  setLocale(lang);
  hide(true);
}
function onToggleKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    show();
  }
}
function onMenuKey(e) {
  const i = items.value.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
  else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
  else if (e.key === 'End') { e.preventDefault(); focusItem(LOCALES.length - 1); }
  else if (e.key === 'Escape') { e.preventDefault(); hide(true); }
  else if (e.key === 'Tab') hide();
}
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true));
</script>

<template>
  <div ref="root" class="lang" data-ui>
    <button
      type="button"
      class="lang__toggle"
      :class="{ 'is-open': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-controls="lang-menu"
      :aria-label="t('hud.language.button', { name: t(`languages.${current}`) })"
      @click="toggle"
      @keydown="onToggleKey"
    >
      <span class="lang__flag" :data-flag="current" aria-hidden="true"></span>
      <span class="lang__code">{{ current.toUpperCase() }}</span>
    </button>

    <Transition name="lang-menu">
      <ul
        v-if="open"
        id="lang-menu"
        class="lang__menu"
        role="menu"
        :aria-label="t('hud.language.menu')"
        @keydown="onMenuKey"
      >
        <li v-for="lang in LOCALES" :key="lang" role="none">
          <button
            ref="items"
            type="button"
            role="menuitemradio"
            class="lang__item"
            :class="{ 'is-current': lang === current }"
            :aria-checked="lang === current"
            :lang="lang"
            @click="choose(lang)"
          >
            <span class="lang__flag" :data-flag="lang" aria-hidden="true"></span>
            <span class="lang__name">{{ t(`languages.${lang}`) }}</span>
            <svg v-if="lang === current" class="lang__check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.lang { position: relative; pointer-events: auto; }

.lang__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 2.75rem;
  padding: 0 0.85rem 0 0.7rem;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--glass);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  touch-action: manipulation;
  transition: border-color 0.2s, color 0.2s;
}
.lang__toggle:hover, .lang__toggle.is-open { border-color: var(--jelly); }
.lang__code { font-variant-numeric: tabular-nums; }

/* Flags are drawn in CSS (emoji flags don't render on Windows): small rounded rectangles. */
.lang__flag {
  flex: none;
  width: 1.3rem;
  height: 0.9rem;
  border-radius: 0.2rem;
  box-shadow: 0 0 0 1px rgba(215, 241, 242, 0.25);
  background-size: cover;
}
.lang__flag[data-flag='uz'] {
  /* blue, thin red, white, thin red, green; a crescent and stars on the blue */
  background:
    radial-gradient(circle at 22% 22%, #fff 0 9%, transparent 10%),
    radial-gradient(circle at 26% 20%, #0099b5 0 9%, transparent 10%),
    linear-gradient(to bottom, #0099b5 0 32%, #ce1126 32% 35%, #fff 35% 65%, #ce1126 65% 68%, #1eb53a 68% 100%);
}
.lang__flag[data-flag='en'] {
  /* a simplified Union Jack: red cross on white, over blue with white diagonals */
  background:
    linear-gradient(to right, transparent 43%, #c8102e 43% 57%, transparent 57%),
    linear-gradient(to bottom, transparent 40%, #c8102e 40% 60%, transparent 60%),
    linear-gradient(to right, transparent 37%, #fff 37% 63%, transparent 63%),
    linear-gradient(to bottom, transparent 32%, #fff 32% 68%, transparent 68%),
    linear-gradient(33deg, transparent 44%, #fff 44% 56%, transparent 56%),
    linear-gradient(-33deg, transparent 44%, #fff 44% 56%, transparent 56%),
    #012169;
}
.lang__flag[data-flag='ru'] { background: linear-gradient(to bottom, #fff 0 33.3%, #0039a6 33.3% 66.6%, #d52b1e 66.6% 100%); }

.lang__menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  z-index: 3;
  display: grid;
  gap: 0.2rem;
  min-width: 11.5rem;
  margin: 0;
  padding: 0.35rem;
  list-style: none;
  border: 1px solid var(--hairline);
  border-radius: 1.1rem;
  background: rgba(6, 26, 38, 0.82);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 40px rgba(2, 8, 14, 0.45);
}
.lang__item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.85rem;
  border: 1px solid transparent;
  border-radius: 0.8rem;
  background: none;
  text-align: left;
  font-size: 0.9rem;
  touch-action: manipulation;
  transition: background-color 0.2s, border-color 0.2s;
}
.lang__item:hover, .lang__item:focus-visible { background: rgba(215, 241, 242, 0.08); }
.lang__item.is-current { border-color: var(--jelly); background: rgba(183, 162, 255, 0.14); }
.lang__name { flex: 1; }
.lang__check { width: 1rem; height: 1rem; fill: none; stroke: var(--jelly); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.lang-menu-enter-active, .lang-menu-leave-active { transition: opacity 0.2s, transform 0.2s; }
.lang-menu-enter-from, .lang-menu-leave-to { opacity: 0; transform: translateY(-6px); }

/* Narrow phones: just the flag in the HUD row. */
@media (max-width: 440px) {
  .lang__toggle { height: 2.5rem; padding: 0 0.6rem; }
  .lang__code { display: none; }
}
@media (max-width: 360px) {
  .lang__toggle { height: 2.3rem; padding: 0 0.5rem; }
}
</style>
