import { midiToHz, rand } from './synth';

/*
 * The instruments the generated music is played on. All synthesised (no samples, nothing licensed), every
 * voice short-lived: each note builds its own few nodes, schedules its whole envelope on the audio clock and
 * disconnects itself when it ends, so nothing accumulates however long the music plays.
 */
const SILENT = 0.0001;
const free = (...nodes) => () => nodes.forEach((n) => { try { n.disconnect(); } catch { /* already gone */ } });

function panner(ctx, dest, value) {
  if (!ctx.createStereoPanner || !value) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = value;
  p.connect(dest);
  return p;
}

/**
 * A warm pad note: two slightly detuned saws (the caller's low-pass makes them soft), a slow swell in,
 * a long release. `dur` is how long it holds before the release starts.
 */
export function padNote(ctx, dest, midi, when, { dur, level, attack = 3.5, release = 5, detune = 6, pan = 0 }) {
  const f = midiToHz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(level, when + attack);
  g.gain.setValueAtTime(level, when + Math.max(attack, dur));
  g.gain.linearRampToValueAtTime(0, when + Math.max(attack, dur) + release);
  const out = panner(ctx, dest, pan);
  g.connect(out);
  const end = when + Math.max(attack, dur) + release + 0.05;
  const oscs = [-detune, detune].map((d) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = d + rand(-2, 2);
    o.connect(g);
    o.start(when);
    o.stop(end);
    return o;
  });
  oscs[0].onended = free(...oscs, g, out === dest ? null : out);
}

/** A soft, low sine under the pad (the bass of the chord), swelling and fading with it. */
export function bassNote(ctx, dest, midi, when, { dur, level, attack = 4, release = 5 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = midiToHz(midi);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(level, when + attack);
  g.gain.setValueAtTime(level, when + dur);
  g.gain.linearRampToValueAtTime(0, when + dur + release);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + dur + release + 0.05);
  o.onended = free(o, g);
}

/**
 * A felt piano: a sine with a few soft harmonics behind a low-pass that closes as the note dies away, so it
 * starts round and warm and fades darker, like a hammer on felt-covered strings.
 */
export function feltPiano(ctx, dest, midi, when, { level = 0.1, decay = 3.2, pan = 0, brightness = 1 } = {}) {
  const f = midiToHz(midi);
  const out = ctx.createGain();
  out.gain.setValueAtTime(SILENT, when);
  out.gain.exponentialRampToValueAtTime(level, when + 0.015);
  out.gain.exponentialRampToValueAtTime(level * 0.35, when + 0.6);
  out.gain.exponentialRampToValueAtTime(SILENT, when + decay);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.4;
  lp.frequency.setValueAtTime(Math.min(7000, f * 7 * brightness), when);
  lp.frequency.exponentialRampToValueAtTime(Math.max(260, f * 1.6), when + decay * 0.8);
  const dst = panner(ctx, dest, pan);
  out.connect(lp).connect(dst);
  const oscs = [[1, 1], [2, 0.32], [3, 0.1], [4.01, 0.04]].map(([mult, amp]) => {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mult;
    og.gain.value = amp;
    o.connect(og).connect(out);
    o.start(when);
    o.stop(when + decay + 0.1);
    return [o, og];
  });
  oscs[0][0].onended = free(...oscs.flat(), out, lp, dst === dest ? null : dst);
}

/** A string swell: a high, sustained note that breathes in and out with a gentle vibrato. */
export function stringSwell(ctx, dest, midi, when, { dur = 7, level = 0.04, pan = 0 } = {}) {
  const f = midiToHz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(level, when + dur * 0.45);
  g.gain.linearRampToValueAtTime(0, when + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  const vib = ctx.createOscillator();
  const vibDepth = ctx.createGain();
  vib.frequency.value = 4.6;
  vibDepth.gain.setValueAtTime(0, when);
  vibDepth.gain.linearRampToValueAtTime(7, when + dur * 0.5); // vibrato comes in as the note blooms (cents)
  vib.connect(vibDepth);
  const dst = panner(ctx, dest, pan);
  g.connect(lp).connect(dst);
  const oscs = [['sawtooth', 0.35], ['triangle', 1]].map(([type, amp]) => {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    og.gain.value = amp;
    vibDepth.connect(o.detune);
    o.connect(og).connect(g);
    o.start(when);
    o.stop(when + dur + 0.05);
    return [o, og];
  });
  vib.start(when);
  vib.stop(when + dur + 0.05);
  oscs[0][0].onended = free(...oscs.flat(), vib, vibDepth, g, lp, dst === dest ? null : dst);
}

/** A glassy ping, far away: a sine with two faint overtones, a quick strike and a long ring. */
export function glassPing(ctx, dest, midi, when, { level = 0.05, decay = 4, pan = 0 } = {}) {
  const f = midiToHz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when);
  g.gain.exponentialRampToValueAtTime(level, when + 0.01);
  g.gain.exponentialRampToValueAtTime(SILENT, when + decay);
  const dst = panner(ctx, dest, pan);
  g.connect(dst);
  const oscs = [[1, 1], [2.01, 0.18], [3.98, 0.05]].map(([mult, amp]) => {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mult;
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(when);
    o.stop(when + decay + 0.1);
    return [o, og];
  });
  oscs[0][0].onended = free(...oscs.flat(), g, dst === dest ? null : dst);
}

/**
 * Something resonating far off in the dark: a soft breath of noise rings a few inharmonic resonances, like a
 * distant structure or a cavern answering. Very quiet; the reverb carries it.
 */
export function distantResonance(ctx, dest, when, noise, { freq = rand(180, 420), level = 0.12, pan = rand(-0.8, 0.8) } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const env = ctx.createGain();
  env.gain.setValueAtTime(SILENT, when);
  env.gain.exponentialRampToValueAtTime(level, when + 0.6);
  env.gain.exponentialRampToValueAtTime(SILENT, when + 2.2);
  src.connect(env);
  const dst = panner(ctx, dest, pan);
  const bands = [1, 1.47, 2.31].map((mult, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * mult;
    bp.Q.value = 40;
    const bg = ctx.createGain();
    bg.gain.value = [1, 0.6, 0.3][i] * 6; // narrow bands pass little energy: make it up
    env.connect(bp).connect(bg).connect(dst);
    return [bp, bg];
  });
  src.start(when, Math.random() * 2);
  src.stop(when + 6);
  src.onended = free(src, env, ...bands.flat(), dst === dest ? null : dst);
}

/**
 * A continuous low drone (the night music's floor): soft sines on the given notes, one of each pair a few
 * cents off so they beat slowly, through a low-pass. start() / stop() build and release its nodes.
 */
export function createDrone(ctx, dest, notes) {
  const level = ctx.createGain();
  level.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  level.connect(lp).connect(dest);
  let oscs = [];
  return {
    start(when) {
      if (oscs.length) return;
      oscs = notes.flatMap((m, i) => [0, 4 + i].map((cents) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = midiToHz(m);
        o.detune.value = cents;
        og.gain.value = (i === 0 ? 0.5 : 0.3) * (cents ? 0.7 : 1);
        o.connect(og).connect(level);
        o.start(when);
        return { o, og };
      }));
    },
    stop(when) {
      const stopping = oscs;
      oscs = [];
      stopping.forEach(({ o, og }) => {
        try { o.stop(when); } catch { /* not started */ }
        o.onended = free(o, og);
      });
    },
    setLevel(v, when, tc = 1.5) { level.gain.setTargetAtTime(v, when, tc); },
    setTone(hz, when, tc = 2) { lp.frequency.setTargetAtTime(hz, when, tc); },
    get running() { return oscs.length > 0; },
  };
}
