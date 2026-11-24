import { onBeforeUnmount, watch } from 'vue';
import { appState } from '@/state/appState';
import { getAudioEngine } from '@/audio/engine';
import { createAudioBridge } from '@/audio/bridge';

/** Sound for the app: { toggle, setVolume, cue }. The first user gesture starts the audio system. */
export function useAudio() {
  const bridge = createAudioBridge({
    engine: getAudioEngine(),
    state: appState,
    subscribe: (getter, callback, options) => watch(getter, callback, options),
  });
  onBeforeUnmount(() => bridge.dispose());
  return { toggle: bridge.toggle, setVolume: bridge.setVolume, cue: bridge.cue };
}
