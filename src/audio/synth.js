// Procedural building blocks (no audio files needed): noise, reverb impulse and one-shot sound effects.

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const rand = (a, b) => a + Math.random() * (b - a);
const SILENT = 0.0001; // exponential ramps cannot reach 0

/** Looping noise buffer ('white' | 'pink' | 'brown'), normalised, with the loop seam cross-faded. */
export function noiseBuffer(ctx, kind, seconds = 8) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const seam = Math.floor(ctx.sampleRate * 0.1);
  const raw = new Float32Array(n + seam);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') raw[i] = w;
    else if (kind === 'pink') { // Paul Kellet's filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; raw[i] = last * 3.5; } // brown
  }
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    d[i] = i >= seam ? raw[i] : raw[i] * (i / seam) + raw[n + i] * (1 - i / seam); // the end flows into the start
    peak = Math.max(peak, Math.abs(d[i]));
  }
  const g = 0.8 / (peak || 1);
  for (let i = 0; i < n; i++) d[i] *= g;
  return buf;
}

/** Stereo reverb impulse: noise that decays and darkens, like a big body of water. */
export function impulseResponse(ctx, seconds = 3.2, decay = 2.6) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp += ((Math.random() * 2 - 1) - lp) * (0.85 - 0.75 * t);
      d[i] = lp * Math.pow(1 - t, decay) * Math.min(1, i / (0.012 * ctx.sampleRate));
    }
  }
  return buf;
}

function source(ctx, buffer, loop = false) {
  const s = ctx.createBufferSource();
  s.buffer = buffer; s.loop = loop;
  return s;
}
function release(...nodes) { return () => nodes.forEach((n) => { try { n.disconnect(); } catch { /* already gone */ } }); }
function pan(ctx, dest, value) {
  if (!ctx.createStereoPanner) return dest;
  const p = ctx.createStereoPanner(); p.pan.value = value; p.connect(dest); return p;
}

/**
 * A single bubble: a short sine that rises in pitch, like a bubble closing up. Kept low, short and rounded
 * (soft attack, a gentle rise, a low-pass on top) so a stream of them reads as water, not as electronic beeps.
 */
export function bubble(ctx, dest, when, { freq = rand(260, 620), gain = rand(0.06, 0.14), pan: panValue = rand(-0.7, 0.7) } = {}) {
  const dur = rand(0.05, 0.11);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.3;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(freq * rand(1.25, 1.6), when + dur);
  g.gain.setValueAtTime(SILENT, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.012);
  g.gain.exponentialRampToValueAtTime(SILENT, when + dur + 0.08);
  const out = pan(ctx, dest, panValue);
  osc.connect(g).connect(lp).connect(out);
  osc.start(when); osc.stop(when + dur + 0.14);
  osc.onended = release(osc, g, lp, out);
}

/** A cluster of bubbles spread over `span` seconds. */
export function bubbleCluster(ctx, dest, when, count = 30, span = 1.6) {
  for (let i = 0; i < count; i++) {
    const t = when + Math.pow(Math.random(), 1.6) * span;
    bubble(ctx, dest, t, { freq: rand(220, 900), gain: rand(0.08, 0.26) * (1 - 0.5 * (t - when) / span) });
  }
}

/** Water impact: a bright burst of noise that darkens, plus a low thump. */
export function splash(ctx, dest, when, white) {
  const src = source(ctx, white); // plays from the start of the noise buffer once
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(2800, when); bp.frequency.exponentialRampToValueAtTime(420, when + 1.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.55, when + 0.02); g.gain.setTargetAtTime(0, when + 0.05, 0.3);
  src.connect(bp).connect(g).connect(dest);
  src.start(when, Math.random() * 2); src.stop(when + 2.2);
  src.onended = release(src, bp, g);

  const thump = ctx.createOscillator(); const tg = ctx.createGain();
  thump.frequency.setValueAtTime(120, when); thump.frequency.exponentialRampToValueAtTime(55, when + 0.5);
  tg.gain.setValueAtTime(SILENT, when); tg.gain.linearRampToValueAtTime(0.5, when + 0.01); tg.gain.setTargetAtTime(0, when + 0.03, 0.14);
  thump.connect(tg).connect(dest); thump.start(when); thump.stop(when + 1);
  thump.onended = release(thump, tg);
}

/** A rising rush of air/water for the start of the descent. */
export function whoosh(ctx, dest, when, white, duration = 3.2) {
  const src = source(ctx, white);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(220, when); bp.frequency.exponentialRampToValueAtTime(1500, when + duration * 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.28, when + duration * 0.55); g.gain.linearRampToValueAtTime(SILENT, when + duration);
  src.connect(bp).connect(g).connect(dest);
  src.start(when, Math.random() * 2); src.stop(when + duration + 0.1);
  src.onended = release(src, bp, g);
}

/** Distant whale-like song: slow glide with vibrato, soft and low. */
export function whale(ctx, dest, when) {
  const dur = rand(6, 9);
  const base = rand(95, 140);
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), vib = ctx.createOscillator();
  const vg = ctx.createGain(), g = ctx.createGain(), g2 = ctx.createGain(), lp = ctx.createBiquadFilter();
  for (const [o, mult] of [[o1, 1], [o2, 2.01]]) {
    o.type = 'sine';
    o.frequency.setValueAtTime(base * mult, when);
    o.frequency.exponentialRampToValueAtTime(base * mult * 2, when + dur * 0.4);
    o.frequency.exponentialRampToValueAtTime(base * mult * 1.35, when + dur);
    vib.connect(vg); vg.connect(o.frequency);
  }
  vib.frequency.value = 0.9; vg.gain.value = 1.6;
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.26, when + dur * 0.35); g.gain.linearRampToValueAtTime(SILENT, when + dur);
  g2.gain.value = 0.25;
  lp.type = 'lowpass'; lp.frequency.value = 650;
  o1.connect(g); o2.connect(g2).connect(g); g.connect(lp).connect(dest);
  [o1, o2, vib].forEach((o) => { o.start(when); o.stop(when + dur + 0.2); });
  o1.onended = release(o1, o2, vib, vg, g, g2, lp);
}

/**
 * A distant pressure groan from the deep: a low, smooth tone that bends slowly, felt more than heard. (It
 * replaces an earlier "creak", a narrow band of noise chopped twenty times a second, which buzzed.)
 */
export function groan(ctx, dest, when) {
  const dur = rand(2.5, 4.5);
  const base = rand(70, 110);
  const o = ctx.createOscillator(), o2 = ctx.createOscillator();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 2;
  const g = ctx.createGain();
  o.type = 'sawtooth'; o2.type = 'sine';
  for (const [osc, mult] of [[o, 1], [o2, 1.5]]) {
    osc.frequency.setValueAtTime(base * mult, when);
    osc.frequency.linearRampToValueAtTime(base * mult * rand(0.82, 0.92), when + dur);
  }
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.09, when + dur * 0.4); g.gain.linearRampToValueAtTime(SILENT, when + dur);
  o.connect(lp); o2.connect(lp); lp.connect(g).connect(pan(ctx, dest, rand(-0.6, 0.6)));
  o.start(when); o2.start(when); o.stop(when + dur + 0.1); o2.stop(when + dur + 0.1);
  o.onended = release(o, o2, lp, g);
}

/** A far-off boom rolling through the deep: a soft, low thud with a long tail (the reverb carries it). */
export function deepBoom(ctx, dest, when, brown) {
  const src = source(ctx, brown);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(260, when); lp.frequency.exponentialRampToValueAtTime(90, when + 3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.32, when + 0.25); g.gain.setTargetAtTime(0, when + 0.4, 1.1);
  src.connect(lp).connect(g).connect(pan(ctx, dest, rand(-0.5, 0.5)));
  src.start(when, Math.random() * 3); src.stop(when + 5);
  src.onended = release(src, lp, g);
}

/** Interface sounds: a soft tick and a two-note chime. */
export function uiClick(ctx, dest, when) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(1320, when); o.frequency.exponentialRampToValueAtTime(880, when + 0.05);
  g.gain.setValueAtTime(SILENT, when); g.gain.exponentialRampToValueAtTime(0.16, when + 0.004); g.gain.exponentialRampToValueAtTime(SILENT, when + 0.09);
  o.connect(g).connect(dest); o.start(when); o.stop(when + 0.12); o.onended = release(o, g);
}
export function uiChime(ctx, dest, when, up = true) {
  const notes = up ? [587.33, 880] : [880, 587.33];
  notes.forEach((f, i) => {
    const t = when + i * 0.11;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(SILENT, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(SILENT, t + 0.55);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.6); o.onended = release(o, g);
  });
}

// ---------- the megalodon encounter (night mode only; the engine checks before playing any of these) ----------

/**
 * The low drone under the encounter: a dark, slowly beating pair low in the bass (with an octave above it, so
 * small speakers still carry it) and a deep rumble of water. One layer, started once; only its level moves
 * (setLevel), so it can never double up.
 */
export function createEncounterDrone(ctx, dest, brown) {
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(dest);
  const nodes = [];
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.8;
  lp.connect(level);
  for (const [hz, type, amp] of [[36.7, 'sine', 0.3], [38.9, 'sine', 0.2], [73.4, 'sawtooth', 0.06], [77.8, 'sawtooth', 0.045]]) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = hz; g.gain.value = amp;
    o.connect(g).connect(lp); o.start(); nodes.push(o);
  }
  const rumble = ctx.createBufferSource(); rumble.buffer = brown; rumble.loop = true;
  const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 120;
  const rg = ctx.createGain(); rg.gain.value = 0.5;
  rumble.connect(rlp).connect(rg).connect(level); rumble.start(0, Math.random() * brown.duration); nodes.push(rumble);
  // The rumble swells and falls slowly, like something large moving the water.
  const lfo = ctx.createOscillator(); const lg = ctx.createGain();
  lfo.frequency.value = 0.11; lg.gain.value = 0.22; lfo.connect(lg).connect(rg.gain); lfo.start(); nodes.push(lfo);
  return {
    setLevel(v, when, tc = 0.9) { level.gain.setTargetAtTime(v, when, tc); },
    stop() { nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }); level.disconnect(); },
  };
}

/** The warning: a soft sonar-like ping over a short, dark swell (two close notes rising out of the low end). */
export function encounterWarning(ctx, dest, when) {
  const ping = ctx.createOscillator(); const pg = ctx.createGain();
  ping.type = 'sine'; ping.frequency.setValueAtTime(1180, when); ping.frequency.exponentialRampToValueAtTime(1040, when + 1.2);
  pg.gain.setValueAtTime(SILENT, when); pg.gain.exponentialRampToValueAtTime(0.09, when + 0.015); pg.gain.exponentialRampToValueAtTime(SILENT, when + 1.3);
  ping.connect(pg).connect(dest); ping.start(when); ping.stop(when + 1.4); ping.onended = release(ping, pg);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
  lp.frequency.setValueAtTime(220, when); lp.frequency.exponentialRampToValueAtTime(900, when + 0.9); lp.frequency.exponentialRampToValueAtTime(260, when + 2.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.exponentialRampToValueAtTime(0.07, when + 0.7); g.gain.exponentialRampToValueAtTime(SILENT, when + 2.3);
  const oscs = [110, 116.54].map((hz) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(lp); o.start(when); o.stop(when + 2.4); return o; });
  lp.connect(g).connect(dest);
  oscs[0].onended = release(...oscs, lp, g);
}

/** The rush: water shoved aside, rising fast, and a swell in the deep bass under it. */
export function encounterRush(ctx, dest, when, pink, duration = 1.15) {
  const src = source(ctx, pink);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(110, when); bp.frequency.exponentialRampToValueAtTime(620, when + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.exponentialRampToValueAtTime(0.3, when + duration * 0.9); g.gain.exponentialRampToValueAtTime(SILENT, when + duration + 0.25);
  src.connect(bp).connect(g).connect(dest); src.start(when, Math.random() * 3); src.stop(when + duration + 0.3);
  src.onended = release(src, bp, g);
  const sub = ctx.createOscillator(); const sg = ctx.createGain();
  sub.frequency.setValueAtTime(42, when); sub.frequency.exponentialRampToValueAtTime(62, when + duration);
  sg.gain.setValueAtTime(SILENT, when); sg.gain.exponentialRampToValueAtTime(0.28, when + duration); sg.gain.exponentialRampToValueAtTime(SILENT, when + duration + 0.2);
  sub.connect(sg).connect(dest); sub.start(when); sub.stop(when + duration + 0.3); sub.onended = release(sub, sg);
}

/** The impact: a deep, short thud with a dark wash of water behind it. Brief, and held under the limiter. */
export function encounterImpact(ctx, dest, when, brown) {
  const o = ctx.createOscillator(); const og = ctx.createGain();
  o.frequency.setValueAtTime(78, when); o.frequency.exponentialRampToValueAtTime(30, when + 0.7);
  og.gain.setValueAtTime(SILENT, when); og.gain.linearRampToValueAtTime(0.4, when + 0.012); og.gain.setTargetAtTime(0, when + 0.05, 0.22);
  o.connect(og).connect(dest); o.start(when); o.stop(when + 1.4); o.onended = release(o, og);
  const src = source(ctx, brown);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1100, when); lp.frequency.exponentialRampToValueAtTime(140, when + 1.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.28, when + 0.02); g.gain.setTargetAtTime(0, when + 0.08, 0.35);
  src.connect(lp).connect(g).connect(dest); src.start(when, Math.random() * 3); src.stop(when + 1.8);
  src.onended = release(src, lp, g);
}

/** The tail sweeping past: a low rush of water moving across from one side to the other. */
export function encounterPass(ctx, dest, when, pink, from = 0.7, to = -0.7) {
  const src = source(ctx, pink);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(420, when); bp.frequency.exponentialRampToValueAtTime(160, when + 1.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.exponentialRampToValueAtTime(1.2, when + 0.45); g.gain.exponentialRampToValueAtTime(SILENT, when + 1.7);
  let out = dest;
  let p = null;
  if (ctx.createStereoPanner) {
    p = ctx.createStereoPanner(); p.pan.setValueAtTime(from, when); p.pan.linearRampToValueAtTime(to, when + 1.5); p.connect(dest); out = p;
  }
  src.connect(bp).connect(g).connect(out); src.start(when, Math.random() * 3); src.stop(when + 1.8);
  src.onended = release(src, bp, g, ...(p ? [p] : []));
}
