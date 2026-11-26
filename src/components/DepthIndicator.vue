<script setup>
import { computed } from 'vue';
import { MAX_DEPTH, ZONES, gaugePosition, zoneAt } from '@/config/zones';
import { formatNumber, t } from '@/i18n';

const props = defineProps({ depth: { type: Number, default: 0 } });

const position = computed(() => gaugePosition(props.depth));
const zone = computed(() => zoneAt(props.depth));
const metres = computed(() => formatNumber(Math.round(props.depth))); // 10,900 / 10 900, as the language writes it
const zoneName = computed(() => t(`zones.${zone.value.id}`));
// A tick at the start of every zone after the first marks where the water changes character.
const ticks = ZONES.slice(1).map((z, i) => ({ id: z.id, top: ((i + 1) / ZONES.length) * 100 }));
</script>

<template>
  <aside class="depth" :style="{ '--pos': position }" :aria-label="t('depth.aria')" data-ui>
    <div
      class="depth__track"
      role="meter"
      aria-valuemin="0"
      :aria-valuemax="MAX_DEPTH"
      :aria-valuenow="Math.round(depth)"
      :aria-valuetext="t('depth.valueText', { depth: metres, zone: zoneName })"
    >
      <span class="depth__fill"></span>
      <span v-for="tick in ticks" :key="tick.id" class="depth__tick" :style="{ top: tick.top + '%' }"></span>
      <div class="depth__marker">
        <span class="depth__dot"></span>
        <div class="depth__readout">
          <span class="depth__value">{{ metres }}<small>{{ ' ' + t('depth.unit') }}</small></span>
          <span class="depth__zone">{{ zoneName }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.depth {
  position: absolute;
  left: calc(var(--inset-left) + 1.5rem);
  top: 0;
  bottom: 0;
  margin-block: auto;
  height: min(56vh, 30rem);
  width: 12rem;
  pointer-events: none;
}
.depth__track { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--hairline); }
.depth__fill { position: absolute; inset: 0 0 auto 0; height: calc(var(--pos) * 100%); background: var(--jelly); }
.depth__tick { position: absolute; left: -5px; width: 12px; height: 1px; background: var(--mist); }
.depth__marker { position: absolute; left: 0; top: calc(var(--pos) * 100%); }
.depth__dot {
  position: absolute;
  left: -5px;
  top: -5px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--foam);
  box-shadow: 0 0 0 5px rgba(183, 162, 255, 0.28);
}
.depth__readout { position: absolute; left: 1.25rem; top: 0; transform: translateY(-50%); display: grid; gap: 0.15rem; white-space: nowrap; }
.depth__value { font-family: var(--font-display); font-size: 1.9rem; line-height: 1; font-variant-numeric: tabular-nums; }
.depth__value small { font-size: 0.95rem; color: var(--mist); }
.depth__zone { font-size: 0.8rem; color: var(--mist); }

@media (max-width: 640px) {
  /* Up under the brand, clear of the chapter text in the lower half of the screen. */
  .depth { left: calc(var(--inset-left) + 1.1rem); top: calc(var(--inset-top) + 6.5rem); bottom: auto; margin: 0; height: min(34vh, 16rem); width: 9rem; }
  .depth__value { font-size: 1.45rem; }
}
</style>
