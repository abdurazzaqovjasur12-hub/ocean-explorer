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

/** A single bubble: a short sine that rises in pitch, like a bubble closing up. */
export function bubble(ctx, dest, when, { freq = rand(300, 900), gain = rand(0.2, 0.5), pan: panValue = rand(-0.8, 0.8) } = {}) {
  const dur = rand(0.05, 0.13);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(freq * rand(1.6, 2.4), when + dur);
  g.gain.setValueAtTime(SILENT, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.006);
  g.gain.exponentialRampToValueAtTime(SILENT, when + dur + 0.06);
  const out = pan(ctx, dest, panValue);
  osc.connect(g).connect(out);
  osc.start(when); osc.stop(when + dur + 0.12);
  osc.onended = release(osc, g, out);
}

/** A cluster of bubbles spread over `span` seconds. */
export function bubbleCluster(ctx, dest, when, count = 30, span = 1.6) {
  for (let i = 0; i < count; i++) {
    const t = when + Math.pow(Math.random(), 1.6) * span;
    bubble(ctx, dest, t, { freq: rand(220, 1400), gain: rand(0.12, 0.45) * (1 - 0.5 * (t - when) / span) });
  }
}

/** Water impact: a bright burst of noise that darkens, plus a low thump. */
export function splash(ctx, dest, when, white) {
  const src = source(ctx, white); // plays from the start of the noise buffer once
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(4200, when); bp.frequency.exponentialRampToValueAtTime(500, when + 1.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(1.0, when + 0.015); g.gain.setTargetAtTime(0, when + 0.05, 0.3);
  src.connect(bp).connect(g).connect(dest);
  src.start(when, Math.random() * 2); src.stop(when + 2.2);
  src.onended = release(src, bp, g);

  const thump = ctx.createOscillator(); const tg = ctx.createGain();
  thump.frequency.setValueAtTime(110, when); thump.frequency.exponentialRampToValueAtTime(38, when + 0.5);
  tg.gain.setValueAtTime(SILENT, when); tg.gain.linearRampToValueAtTime(0.8, when + 0.01); tg.gain.setTargetAtTime(0, when + 0.03, 0.14);
  thump.connect(tg).connect(dest); thump.start(when); thump.stop(when + 1);
  thump.onended = release(thump, tg);
}

/** A rising rush of air/water for the start of the descent. */
export function whoosh(ctx, dest, when, white, duration = 3.2) {
  const src = source(ctx, white);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(250, when); bp.frequency.exponentialRampToValueAtTime(2200, when + duration * 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.45, when + duration * 0.55); g.gain.linearRampToValueAtTime(SILENT, when + duration);
  src.connect(bp).connect(g).connect(dest);
  src.start(when, Math.random() * 2); src.stop(when + duration + 0.1);
  src.onended = release(src, bp, g);
}

/** Distant whale-like song: slow glide with vibrato, soft and low. */
export function whale(ctx, dest, when) {
  const dur = rand(6, 9);
  const base = rand(62, 85);
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), vib = ctx.createOscillator();
  const vg = ctx.createGain(), g = ctx.createGain(), g2 = ctx.createGain(), lp = ctx.createBiquadFilter();
  for (const [o, mult] of [[o1, 1], [o2, 2.01]]) {
    o.type = 'sine';
    o.frequency.setValueAtTime(base * mult, when);
    o.frequency.exponentialRampToValueAtTime(base * mult * 2, when + dur * 0.4);
    o.frequency.exponentialRampToValueAtTime(base * mult * 1.35, when + dur);
    vib.connect(vg); vg.connect(o.frequency);
  }
  vib.frequency.value = 5.5; vg.gain.value = 2.5;
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.5, when + dur * 0.35); g.gain.linearRampToValueAtTime(SILENT, when + dur);
  g2.gain.value = 0.25;
  lp.type = 'lowpass'; lp.frequency.value = 420;
  o1.connect(g); o2.connect(g2).connect(g); g.connect(lp).connect(dest);
  [o1, o2, vib].forEach((o) => { o.start(when); o.stop(when + dur + 0.2); });
  o1.onended = release(o1, o2, vib, vg, g, g2, lp);
}

/** A faint creak, like a distant hull or rock under pressure. */
export function creak(ctx, dest, when, white) {
  const dur = rand(0.5, 1.2);
  const src = source(ctx, white);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 18;
  bp.frequency.setValueAtTime(rand(170, 240), when); bp.frequency.exponentialRampToValueAtTime(rand(280, 420), when + dur);
  const am = ctx.createGain(); am.gain.value = 0.5;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = rand(18, 26); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(SILENT, when); g.gain.linearRampToValueAtTime(0.22, when + dur * 0.3); g.gain.linearRampToValueAtTime(SILENT, when + dur);
  src.connect(bp).connect(am).connect(g).connect(dest);
  src.start(when, Math.random() * 2); lfo.start(when); src.stop(when + dur + 0.1); lfo.stop(when + dur + 0.1);
  src.onended = release(src, bp, am, lfo, lg, g);
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
