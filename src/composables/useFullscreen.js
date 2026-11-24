import { ref, onMounted, onBeforeUnmount } from 'vue';

export function useFullscreen() {
  const root = document.documentElement;
  const supported = !!(root.requestFullscreen || root.webkitRequestFullscreen); // not on iPhone Safari
  const isFullscreen = ref(false);

  const sync = () => {
    isFullscreen.value = !!(document.fullscreenElement || document.webkitFullscreenElement);
  };

  async function toggle() {
    try {
      if (isFullscreen.value) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      } else {
        await (root.requestFullscreen?.({ navigationUI: 'hide' }) ?? root.webkitRequestFullscreen?.());
      }
    } catch (err) {
      console.warn('[fullscreen]', err);
    }
  }

  onMounted(() => {
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
  });
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', sync);
    document.removeEventListener('webkitfullscreenchange', sync);
  });

  return { supported, isFullscreen, toggle };
}
