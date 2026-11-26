import { smoothstep } from '@/utils/math';

/*
 * The continuous sound of the place: above the waves (surf, the weight of the water, a little wind) and
 * underwater, where it follows the depth zones of config/zones.js:
 *
 *   sunlight   0 - 200 m      water moving: soft swells of filtered noise, gentle and close
 *   twilight   200 - 1000 m   currents: a faint, slowly wandering band of sound, a low hum appears
 *   midnight   1000 - 4000 m  deeper: a warm low hum and a dark, slow rumble
 *   abyssal    4000 - 6000 m  isolated: a thin, very low draught of sound, almost nothing else
 *   hadal      6000 m +       the deepest: a still, low resonance under a slow, distant swell
 *
 * Each zone is one small layer, crossfaded by depth with wide overlaps and slow time constants, so the
 * change is felt rather than noticed. At night the shallow water is quieter and the twilight layer reaches
 * up nearer the surface: the same sea, more mysterious. Every layer is running noise or oscillators started
 * once; only their gains move, so there is nothing to start or stop (or leak) while diving.
 */

function loopSource(ctx, buffer, nodes) {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.start(0, Math.random() * buffer.duration);
  nodes.push(s);
  return s;
}
function lfo(ctx, hz, depth, target, nodes) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = hz;
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
  nodes.push(o);
}
function filter(ctx, type, hz, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}
const stopAll = (nodes) => nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });

/** Above the waves: surf rolling in, the low body of the water, and a little wind. Softer at the top end than before. */
export function createSurfaceLayer(ctx, out, noise) {
  const nodes = [];
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);

  // Surf: a wash of sound that swells and falls (kept below 3.5 kHz: no hiss).
  const swell = ctx.createGain();
  swell.gain.value = 0.42;
  loopSource(ctx, noise.pink, nodes).connect(filter(ctx, 'highpass', 180)).connect(filter(ctx, 'lowpass', 3200)).connect(swell).connect(level);
  lfo(ctx, 0.117, 0.3, swell.gain, nodes);
  // Foam: a soft, darker hiss on the same swell.
  const foam = ctx.createGain();
  foam.gain.value = 0.025;
  loopSource(ctx, noise.pink, nodes).connect(filter(ctx, 'bandpass', 2600, 0.6)).connect(foam).connect(level);
  lfo(ctx, 0.117, 0.02, foam.gain, nodes);
  // Body: the low weight of the water, on another rhythm so the two never line up.
  const body = ctx.createGain();
  body.gain.value = 0.24;
  loopSource(ctx, noise.brown, nodes).connect(filter(ctx, 'lowpass', 240)).connect(body).connect(level);
  lfo(ctx, 0.083, 0.1, body.gain, nodes);
  // Wind: thin and slowly varying.
  const windBand = filter(ctx, 'bandpass', 1300, 1.1);
  const wind = ctx.createGain();
  wind.gain.value = 0.07;
  loopSource(ctx, noise.pink, nodes).connect(windBand).connect(wind).connect(level);
  lfo(ctx, 0.043, 0.05, wind.gain, nodes);
  lfo(ctx, 0.19, 120, windBand.frequency, nodes);

  return {
    setLevel(v, when, tc = 0.3) { level.gain.setTargetAtTime(v, when, tc); },
    stop() { stopAll(nodes); level.disconnect(); },
  };
}

/** How much of each underwater zone is heard at a depth (metres). Overlapping, smooth, summing to about 1. */
export function zoneWeights(meters, night = 0) {
  const m = Math.max(0, meters);
  // At night the twilight layer reaches up towards the surface.
  const shallowEnd = 380 - 260 * night;
  const sunlight = 1 - smoothstep(120, shallowEnd, m);
  const twilight = smoothstep(120, shallowEnd, m) * (1 - smoothstep(800, 1700, m));
  const midnight = smoothstep(800, 1700, m) * (1 - smoothstep(3500, 4800, m));
  const abyssal = smoothstep(3500, 4800, m) * (1 - smoothstep(5500, 7000, m));
  const hadal = smoothstep(5500, 7000, m);
  return { sunlight, twilight, midnight, abyssal, hadal };
}

/** Underwater: one layer per depth zone. */
export function createUnderwaterLayer(ctx, out, noise) {
  const nodes = [];
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  const layer = () => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(level);
    return g;
  };

  // Sunlight zone: the water moving, close and soft (swells of filtered noise on two slow rhythms).
  const sunlight = layer();
  const wash = ctx.createGain();
  wash.gain.value = 0.55;
  loopSource(ctx, noise.pink, nodes).connect(filter(ctx, 'lowpass', 650)).connect(filter(ctx, 'highpass', 70)).connect(wash).connect(sunlight);
  lfo(ctx, 0.09, 0.3, wash.gain, nodes);
  const lap = ctx.createGain();
  lap.gain.value = 0.12;
  const lapBand = filter(ctx, 'bandpass', 900, 1.4);
  loopSource(ctx, noise.pink, nodes).connect(lapBand).connect(lap).connect(sunlight);
  lfo(ctx, 0.23, 0.08, lap.gain, nodes);
  lfo(ctx, 0.05, 250, lapBand.frequency, nodes);

  // Twilight zone: currents, a band of sound wandering slowly, over a faint low hum.
  const twilight = layer();
  const current = ctx.createGain();
  current.gain.value = 0.22;
  const currentBand = filter(ctx, 'bandpass', 420, 3);
  loopSource(ctx, noise.pink, nodes).connect(currentBand).connect(current).connect(twilight);
  lfo(ctx, 0.027, 160, currentBand.frequency, nodes);
  lfo(ctx, 0.061, 0.1, current.gain, nodes);
  const hum = ctx.createGain();
  hum.gain.value = 0.06;
  for (const [hz, amp] of [[98, 1], [147, 0.5]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = hz;
    og.gain.value = amp;
    o.connect(og).connect(hum);
    o.start();
    nodes.push(o);
    lfo(ctx, 0.04 + hz / 9000, 6, o.detune, nodes);
  }
  hum.connect(twilight);

  // Midnight zone: a warm low hum and a dark, slow rumble.
  const midnight = layer();
  const rumble = ctx.createGain();
  rumble.gain.value = 0.22;
  loopSource(ctx, noise.brown, nodes).connect(filter(ctx, 'lowpass', 220)).connect(rumble).connect(midnight);
  lfo(ctx, 0.04, 0.12, rumble.gain, nodes);
  const deepHum = ctx.createGain();
  deepHum.gain.value = 0.07;
  for (const [hz, amp] of [[61.7, 1], [92.5, 0.6], [123.5, 0.25]]) { // B1 and its fifth and octave: low, but not sub-bass
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = hz;
    og.gain.value = amp;
    o.connect(og).connect(deepHum);
    o.start();
    nodes.push(o);
    lfo(ctx, 0.03 + hz / 5000, 5, o.detune, nodes);
  }
  deepHum.connect(midnight);

  // Abyssal zone: isolation, a thin and very low draught of sound.
  const abyssal = layer();
  const draught = ctx.createGain();
  draught.gain.value = 0.26;
  const draughtBand = filter(ctx, 'lowpass', 140, 1.2);
  loopSource(ctx, noise.brown, nodes).connect(draughtBand).connect(draught).connect(abyssal);
  lfo(ctx, 0.021, 0.14, draught.gain, nodes);
  lfo(ctx, 0.013, 40, draughtBand.frequency, nodes);

  // Hadal zone: a still, low resonance (A1 and its octave, beating slowly) under a slow, distant swell.
  const hadal = layer();
  const still = ctx.createGain();
  still.gain.value = 0.06;
  for (const [hz, cents, amp] of [[55, 0, 1], [55, 5, 0.7], [110, 0, 0.3]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = hz;
    o.detune.value = cents;
    og.gain.value = amp;
    o.connect(og).connect(still);
    o.start();
    nodes.push(o);
  }
  still.connect(hadal);
  const swell = ctx.createGain();
  swell.gain.value = 0.16;
  loopSource(ctx, noise.brown, nodes).connect(filter(ctx, 'lowpass', 110)).connect(swell).connect(hadal);
  lfo(ctx, 0.017, 0.1, swell.gain, nodes);

  const layers = { sunlight, twilight, midnight, abyssal, hadal };
  // Relative loudness of each zone: the deep is quieter, emptier (isolation), not louder.
  const LOUDNESS = { sunlight: 1, twilight: 0.85, midnight: 0.8, abyssal: 0.6, hadal: 0.65 };

  return {
    setLevel(v, when, tc = 0.4) { level.gain.setTargetAtTime(v, when, tc); },
    /** Depth in metres, night 0..1: the zone layers crossfade slowly (time constant ~2 s). */
    setDepth(meters, night, when, tc = 2) {
      const w = zoneWeights(meters, night);
      for (const [name, g] of Object.entries(layers)) {
        const nightTrim = name === 'sunlight' ? 1 - 0.4 * night : 1;
        g.gain.setTargetAtTime(w[name] * LOUDNESS[name] * nightTrim, when, tc);
      }
    },
    stop() { stopAll(nodes); level.disconnect(); },
  };
}
