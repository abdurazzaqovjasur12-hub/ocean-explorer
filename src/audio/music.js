import { midiToHz, rand } from './synth';

// A slow, generative ambient piece in D: four warm chords that overlap, with sparse bell notes
// from the D minor pentatonic scale drifting over the top. It never loops the same way twice.
const CHORDS = [
  [38, 45, 50, 57, 64],        // D sus2
  [34, 41, 46, 53, 57, 62],    // B-flat major 7
  [43, 50, 58, 62, 65, 69],    // G minor 9
  [33, 45, 52, 55, 60],        // A minor 7
];
const BELLS = [74, 77, 79, 81, 84, 86];
const CHORD_LENGTH = 16; // seconds
const SILENT = 0.0001;

export function createMusic(ctx, out, reverbSend) {
  const bus = ctx.createGain(); bus.gain.value = 0.34; bus.connect(out);
  const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 1100; padFilter.Q.value = 0.4;
  padFilter.connect(bus);
  const filterLfo = ctx.createOscillator(); const filterLfoGain = ctx.createGain();
  filterLfo.frequency.value = 0.05; filterLfoGain.gain.value = 380; filterLfo.connect(filterLfoGain).connect(padFilter.frequency); filterLfo.start();

  // bells go through a soft echo as well as the reverb
  const bellBus = ctx.createGain(); bellBus.gain.value = 0.9;
  const echo = ctx.createDelay(1.5); echo.delayTime.value = 0.43;
  const feedback = ctx.createGain(); feedback.gain.value = 0.36;
  bellBus.connect(bus); bellBus.connect(echo); echo.connect(feedback).connect(echo); echo.connect(bus);
  if (reverbSend) { bellBus.connect(reverbSend); echo.connect(reverbSend); padFilter.connect(reverbSend); }

  let nextChord = ctx.currentTime + 0.05;
  let chordIndex = 0;
  let nextBell = ctx.currentTime + 2.5;
  let stopped = false;

  function playChord(when) {
    const notes = CHORDS[chordIndex++ % CHORDS.length];
    const base = 0.34 / Math.sqrt(notes.length);
    for (const m of notes) {
      const f = midiToHz(m);
      const peak = base * Math.min(1, Math.max(0.22, (m - 30) / 24)); // deep notes are felt more than heard: keep them light
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.setTargetAtTime(peak, when, 1.7);                              // slow bloom
      g.gain.setTargetAtTime(0, when + CHORD_LENGTH, 1.9);                  // long fade, overlapping the next chord
      g.connect(padFilter);
      for (const [type, detune] of [['triangle', -5], ['sine', 5]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
        o.connect(g); o.start(when); o.stop(when + CHORD_LENGTH + 12);
        if (type === 'sine') o.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
      }
    }
  }

  function playBell(when) {
    const f = midiToHz(BELLS[Math.floor(Math.random() * BELLS.length)]);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(rand(0.07, 0.13), when + 0.004); g.gain.setTargetAtTime(0, when + 0.004, 0.75);
    g.connect(bellBus);
    for (const [mult, level] of [[1, 1], [2.76, 0.32], [5.4, 0.1]]) { // inharmonic partials make it bell-like
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * mult; og.gain.value = level;
      o.connect(og).connect(g); o.start(when); o.stop(when + 5);
      if (mult === 1) o.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
    }
  }

  return {
    /** Create everything that should sound up to `until` (audio-clock seconds). */
    schedule(until) {
      if (stopped) return;
      while (nextChord < until + 6) { playChord(nextChord); nextChord += CHORD_LENGTH - 2; }
      while (nextBell < until) { playBell(nextBell); nextBell += rand(3.2, 8); }
    },
    /** Level and brightness follow the environment (a bit darker and wetter underwater). */
    setBrightness(hz, when, tc = 0.4) { padFilter.frequency.setTargetAtTime(hz, when, tc); },
    stop() { stopped = true; },
    output: bus,
  };
}
