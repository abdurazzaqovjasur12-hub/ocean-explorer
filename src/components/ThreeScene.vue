<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { SceneManager } from '@/core/SceneManager';
import { AssetLoader } from '@/core/AssetLoader';

const props = defineProps({
  /** async ({ manager, scene, camera, renderer, settings, state, assets, report }) => { update?, render?, resize?, setQuality?, dispose? }
   `report(progress, labelKey)`: the label is a translation key (loading.*), so it follows the chosen language. */
  sceneFactory: { type: Function, required: true },
  quality: { type: String, default: 'medium' },
  /** Reactive state the scene reads each frame (depth, device, ...). */
  state: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['progress', 'ready', 'error', 'low-fps']);

const container = ref(null);
let manager = null;
let sceneApi = null;
let removeUpdater = null;
let removeResizer = null;
let unmounted = false;

const report = (value, label) => emit('progress', Math.min(Math.max(value, 0), 1), label);

onMounted(async () => {
  try {
    manager = new SceneManager(container.value, {
      quality: props.quality,
      onSustainedLowFps: (fps) => emit('low-fps', fps), // even the lowest resolution isn't enough
    });
  } catch (err) {
    console.error('[ThreeScene] WebGL init failed', err);
    emit('error', 'loading.errorWebgl');
    return;
  }

  try {
    report(0.05, 'loading.renderer');
    sceneApi = await props.sceneFactory({
      manager,
      scene: manager.scene,
      camera: manager.camera,
      renderer: manager.renderer,
      settings: manager.settings,
      state: props.state,
      assets: new AssetLoader(),
      report,
    });
    if (unmounted) {
      sceneApi?.dispose?.();
      return;
    }
    if (sceneApi?.update) removeUpdater = manager.addUpdater(sceneApi.update);
    if (sceneApi?.resize) removeResizer = manager.addResizer(sceneApi.resize);
    if (sceneApi?.render) manager.setRenderFunction(sceneApi.render);

    report(0.95, 'loading.shaders');
    await manager.compile();
    if (unmounted) return;
    sceneApi?.warm?.(); // e.g. post-processing shaders, compiled now rather than mid-dive

    manager.start();
    emit('ready', { manager, api: sceneApi });
  } catch (err) {
    console.error('[ThreeScene] scene setup failed', err);
    if (!unmounted) emit('error', 'loading.errorScene');
  }
});

watch(() => props.quality, (quality) => {
  if (!manager) return;
  manager.setQuality(quality);
  sceneApi?.setQuality?.(manager.settings);
});

onBeforeUnmount(() => {
  unmounted = true;
  removeUpdater?.();
  removeResizer?.();
  manager?.setRenderFunction(null);
  sceneApi?.dispose?.();
  manager?.dispose();
  manager = sceneApi = removeUpdater = removeResizer = null;
});

defineExpose({ getManager: () => manager });
</script>

<template>
  <div ref="container" class="three-scene"></div>
</template>

<style scoped>
.three-scene { position: absolute; inset: 0; overflow: hidden; }
</style>
