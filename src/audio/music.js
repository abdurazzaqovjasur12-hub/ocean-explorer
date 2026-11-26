import { rand } from './synth';
import { padNote, bassNote, feltPiano, stringSwell, glassPing, distantResonance, createDrone } from './instruments';

/*
 * The two soundtracks, both generative (composed rules, not loops: they never repeat the same way twice).
 *
 *   day    D major, warm and open: slow pad chords that drift between related harmonies, a felt piano that
 *          plays short, singing phrases (stepwise, resting between them, sometimes answering its last phrase),
 *          the odd harp arpeggio and a high string swell.
 *   night  D minor / Phrygian, deep and still: a low drone that never stops, dark slow chords, distant glassy
 *          notes that echo away, and now and then something resonating far off in the dark.
 *
 * Both share one interface: start(when) / stop(when) (only the audible piece schedules notes; the other is
 * idle), schedule(until) (called a little ahead of the audio clock), setMood(0..1) (how deep the camera is:
 * deeper is darker, sparser and more mysterious) and `output` (the gain the engine crossfades).
 */

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Common machinery: the output gain, a low-pass for the pads, the clock of chords and phrases. */
function base(ctx, out, sends, { chords, chordLength, padCutoff, padLevel }) {
  const output = ctx.createGain();
  output.gain.value = 0;
  output.connect(out);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = padCutoff;
  padFilter.Q.value = 0.5;
  padFilter.connect(output);
  if (sends.reverb) padFilter.connect(sends.reverb);
  // The filter breathes very slowly: the pads open and close over half a minute.
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.035;
  lfoDepth.gain.value = padCutoff * 0.25;
  lfo.connect(lfoDepth).connect(padFilter.frequency);
  lfo.start();

  const state = {
    output,
    padFilter,
    active: false,
    stopAt: Infinity,
    mood: 0,
    chord: 0,
    nextChord: 0,
    chords,
    chordLength,
    padLevel,
  };
  return state;
}

function playChord(ctx, s, when, { bassLevel, attack, release }) {
  const c = s.chords[s.chord];
  const level = s.padLevel / Math.sqrt(c.pad.length);
  c.pad.forEach((m, i) => padNote(ctx, s.padFilter, m, when, { dur: s.chordLength, level, attack, release, pan: (i / (c.pad.length - 1) - 0.5) * 0.5 }));
  bassNote(ctx, s.padFilter, c.bass, when, { dur: s.chordLength, level: bassLevel, attack, release });
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Day

const DAY_CHORDS = [
  { name: 'Dmaj9', bass: 38, pad: [57, 61, 64, 66], tones: [62, 66, 69, 73, 74, 76, 78, 81], next: [1, 2, 5] },
  { name: 'Bm9', bass: 47, pad: [54, 57, 61, 62], tones: [61, 62, 66, 69, 71, 73, 74, 78], next: [2, 5] },
  { name: 'Gmaj9', bass: 43, pad: [54, 57, 59, 62], tones: [62, 66, 67, 69, 71, 74, 78, 79], next: [3, 0, 4] },
  { name: 'Asus2', bass: 45, pad: [52, 57, 59, 64], tones: [64, 66, 69, 71, 73, 76, 78, 81], next: [0, 4] },
  { name: 'F#m7', bass: 42, pad: [52, 57, 61, 64], tones: [61, 64, 66, 69, 73, 76, 78, 81], next: [2, 5] },
  { name: 'Em9', bass: 40, pad: [54, 55, 59, 62], tones: [62, 64, 66, 67, 71, 74, 76, 78], next: [3, 6] },
  { name: 'Gmaj7#11', bass: 43, pad: [54, 59, 61, 62], tones: [61, 62, 66, 67, 71, 73, 74, 78], next: [0, 3] },
];
// The melody's world: D major pentatonic plus G and C# for colour, middle to upper register.
const DAY_SCALE = [62, 64, 66, 67, 69, 71, 73, 74, 76, 78, 79, 81];

export function createDayMusic(ctx, out, sends) {
  const s = base(ctx, out, sends, { chords: DAY_CHORDS, chordLength: 12.5, padCutoff: 1500, padLevel: 0.075 });
  const melodyOut = ctx.createGain();
  melodyOut.gain.value = 1;
  melodyOut.connect(s.output);
  if (sends.reverb) melodyOut.connect(sends.reverb);
  let nextNote = 0;
  let phrase = [];
  let lastPhrase = null;
  let lastNote = 69;
  let nextExtra = 0;

  /** A phrase: 3 to 6 notes moving mostly by step, landing on a tone of the chord, then a rest. */
  function makePhrase() {
    const chord = s.chords[s.chord];
    // Deeper water: fewer notes, lower, slower.
    const ceiling = DAY_SCALE.length - 1 - Math.round(s.mood * 4);
    const length = Math.max(2, Math.round(rand(3, 6.4) - s.mood * 2));
    const answer = lastPhrase?.length > 1 && Math.random() < 0.35; // echo the last phrase's rhythm, a step higher or lower
    const rhythm = answer ? lastPhrase.map((n) => n.dur) : Array.from({ length }, (_, i) => (i === length - 1 ? pick([2.4, 3.2]) : pick([0.9, 1.2, 1.2, 1.8])));
    let idx = DAY_SCALE.indexOf(lastNote);
    if (idx < 0) idx = 4;
    const shift = answer ? pick([-1, 1]) : 0;
    const notes = rhythm.map((dur, i) => {
      if (answer) idx = Math.min(ceiling, Math.max(0, DAY_SCALE.indexOf(lastPhrase[i].midi) + shift));
      else idx = Math.min(ceiling, Math.max(0, idx + pick([-2, -1, -1, 1, 1, 2, 0])));
      let midi = DAY_SCALE[idx];
      if (i === rhythm.length - 1) midi = chord.tones.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a)); // land on the harmony
      return { midi, dur: dur * (1 + s.mood * 0.5) };
    });
    lastPhrase = notes.slice(); // a copy: the phrase being played is consumed note by note
    lastNote = notes[notes.length - 1].midi;
    return notes;
  }

  return {
    output: s.output,
    get active() { return s.active; },
    start(when) {
      if (s.active && s.stopAt === Infinity) return;
      if (!s.active) {
        s.nextChord = when + 0.1;
        nextNote = when + 4 + rand(0, 3); // the first phrase waits for the first chord to bloom
        nextExtra = when + 8;
      }
      s.active = true;
      s.stopAt = Infinity;
    },
    stop(when) { s.stopAt = when; },
    setMood(m, when) {
      s.mood = m;
      s.padFilter.frequency.setTargetAtTime(1500 - 750 * m, when, 2);
      melodyOut.gain.setTargetAtTime(1 - 0.35 * m, when, 2);
    },
    schedule(until) {
      if (!s.active) return;
      if (until > s.stopAt) { s.active = false; return; }
      const now = ctx.currentTime;
      // After a stall (a busy main thread, an interrupted context) never play the backlog: carry on from now.
      if (s.nextChord < now - 1) s.nextChord = now + 0.1;
      if (nextNote < now - 1) { nextNote = now + 1; phrase = []; }
      if (nextExtra < now - 1) nextExtra = now + 4;

      while (s.nextChord < until + 4) {
        const c = playChord(ctx, s, s.nextChord, { bassLevel: 0.045, attack: 3.5, release: 5 });
        const t = s.nextChord;
        if (Math.random() < 0.3) stringSwell(ctx, melodyOut, pick(c.tones.filter((m) => m >= 69)), t + rand(2, 5), { dur: rand(6, 9), level: 0.022, pan: rand(-0.5, 0.5) });
        s.nextChord += s.chordLength;
        s.chord = pick(c.next);
      }
      while (nextNote < until) {
        if (!phrase.length) phrase = makePhrase();
        const n = phrase.shift();
        feltPiano(ctx, melodyOut, n.midi, nextNote, { level: rand(0.1, 0.14), decay: 3.4, pan: rand(-0.25, 0.25) });
        nextNote += n.dur;
        if (!phrase.length) nextNote += rand(5, 11) * (1 + s.mood * 1.5); // breathe between phrases
      }
      // Now and then a soft harp arpeggio of the current chord, high and quiet.
      while (nextExtra < until) {
        if (Math.random() < 0.4 * (1 - s.mood * 0.6)) {
          const tones = s.chords[s.chord].tones.filter((m) => m >= 66).slice(0, 4);
          tones.forEach((m, i) => feltPiano(ctx, melodyOut, m + 12 > 90 ? m : m + 12, nextExtra + i * 0.16, { level: 0.03, decay: 2.2, pan: -0.4 + i * 0.25, brightness: 1.4 }));
        }
        nextExtra += rand(14, 24);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Night

const NIGHT_CHORDS = [
  { name: 'Dm(add9)', bass: 38, pad: [50, 53, 57, 64], next: [1, 2, 3] },
  { name: 'Bbmaj7#11', bass: 46, pad: [46, 53, 57, 64], next: [0, 2] },
  { name: 'Gm(add9)/D', bass: 38, pad: [50, 55, 57, 58], next: [3, 0, 4] },
  { name: 'Ebmaj7/D', bass: 38, pad: [51, 55, 58, 62], next: [0] },
  { name: 'Am(b6)', bass: 45, pad: [52, 57, 60, 65], next: [0, 1] },
];
const NIGHT_SCALE = [62, 63, 65, 67, 69, 70, 72, 74, 77]; // D Phrygian colours, sparse and high, like far-off lights

export function createNightMusic(ctx, out, sends, noise) {
  const s = base(ctx, out, sends, { chords: NIGHT_CHORDS, chordLength: 18, padCutoff: 1000, padLevel: 0.07 });
  const drone = createDrone(ctx, s.output, [38, 45]);
  // Distant notes echo away: a long, dark feedback delay.
  const pingBus = ctx.createGain();
  pingBus.gain.value = 1;
  const echo = ctx.createDelay(2);
  echo.delayTime.value = 0.68;
  const fb = ctx.createGain();
  fb.gain.value = 0.48;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 1800;
  pingBus.connect(s.output);
  pingBus.connect(echo);
  echo.connect(echoTone).connect(fb).connect(echo);
  echoTone.connect(s.output);
  if (sends.reverb) { pingBus.connect(sends.reverb); echoTone.connect(sends.reverb); }
  let nextPing = 0;
  let nextResonance = 0;

  return {
    output: s.output,
    get active() { return s.active; },
    start(when) {
      if (s.active && s.stopAt === Infinity) return;
      if (!s.active) {
        s.nextChord = when + 0.1;
        nextPing = when + 6 + rand(0, 4);
        nextResonance = when + rand(14, 26);
      }
      drone.start(when);
      s.active = true;
      s.stopAt = Infinity;
    },
    stop(when) {
      s.stopAt = when;
      drone.stop(when + 0.5);
    },
    setMood(m, when) {
      s.mood = m;
      s.padFilter.frequency.setTargetAtTime(1000 - 420 * m, when, 2);
      drone.setLevel(0.03 + 0.045 * m, when);
      drone.setTone(320 - 140 * m, when);
      echo.delayTime.setTargetAtTime(0.68 + 0.3 * m, when, 3);
    },
    schedule(until) {
      if (!s.active) return;
      if (until > s.stopAt) { s.active = false; return; }
      const now = ctx.currentTime;
      if (s.nextChord < now - 1) s.nextChord = now + 0.1;
      if (nextPing < now - 1) nextPing = now + 2;
      if (nextResonance < now - 1) nextResonance = now + 8;

      while (s.nextChord < until + 4) {
        const c = playChord(ctx, s, s.nextChord, { bassLevel: 0.03, attack: 6, release: 7 });
        s.nextChord += s.chordLength;
        s.chord = pick(c.next);
      }
      while (nextPing < until) {
        // One to three notes, lower and fewer the deeper the camera is, then a long silence.
        const count = Math.random() < 0.5 - s.mood * 0.3 ? 2 + Math.round(Math.random()) : 1;
        let t = nextPing;
        for (let i = 0; i < count; i++) {
          const top = NIGHT_SCALE.length - 1 - Math.round(s.mood * 4);
          glassPing(ctx, pingBus, NIGHT_SCALE[Math.floor(rand(0, top + 1))], t, { level: rand(0.045, 0.07), decay: 4.5, pan: rand(-0.7, 0.7) });
          t += rand(0.9, 1.8);
        }
        nextPing = t + rand(7, 15) * (1 + s.mood);
      }
      while (nextResonance < until) {
        distantResonance(ctx, pingBus, nextResonance, noise, { level: 0.05 + 0.05 * s.mood }); // echoed and reverberant, far off
        nextResonance += rand(18, 40) * (1.2 - s.mood * 0.5);
      }
    },
  };
}
