// Continuous background layers. Each returns { setLevel(value, when, tc), stop() }.

function loopSource(ctx, buffer, nodes) {
  const s = ctx.createBufferSource();
  s.buffer = buffer; s.loop = true;
  s.start(0, Math.random() * buffer.duration);
  nodes.push(s);
  return s;
}
function lfo(ctx, hz, depth, target, nodes) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = hz; g.gain.value = depth;
  o.connect(g).connect(target);
  o.start(); nodes.push(o);
}
const stopAll = (nodes) => nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });

/** Above the waves: surf rolling in, a low body of water, and a little wind. */
export function createSurfaceLayer(ctx, out, noise) {
  const nodes = [];
  const level = ctx.createGain(); level.gain.value = 0; level.connect(out);

  // surf: broadband wash (200 Hz - 5 kHz) that swells and falls
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200;
  const lpSurf = ctx.createBiquadFilter(); lpSurf.type = 'lowpass'; lpSurf.frequency.value = 5000;
  const swell = ctx.createGain(); swell.gain.value = 0.5;
  loopSource(ctx, noise.pink, nodes).connect(hp).connect(lpSurf).connect(swell).connect(level);
  lfo(ctx, 0.117, 0.38, swell.gain, nodes);

  // crest hiss: bright foam that rises with the same swell
  const hissHp = ctx.createBiquadFilter(); hissHp.type = 'highpass'; hissHp.frequency.value = 3200;
  const hiss = ctx.createGain(); hiss.gain.value = 0.06;
  loopSource(ctx, noise.white, nodes).connect(hissHp).connect(hiss).connect(level);
  lfo(ctx, 0.117, 0.05, hiss.gain, nodes);

  // body: the low weight of water, on a different rhythm so the two never line up
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
  const body = ctx.createGain(); body.gain.value = 0.3;
  loopSource(ctx, noise.brown, nodes).connect(lp).connect(body).connect(level);
  lfo(ctx, 0.083, 0.15, body.gain, nodes);

  // wind: thin, high, slowly varying
  const wp = ctx.createBiquadFilter(); wp.type = 'bandpass'; wp.frequency.value = 1700; wp.Q.value = 1.1;
  const wind = ctx.createGain(); wind.gain.value = 0.16;
  loopSource(ctx, noise.pink, nodes).connect(wp).connect(wind).connect(level);
  lfo(ctx, 0.043, 0.1, wind.gain, nodes);
  lfo(ctx, 0.19, 120, wp.frequency, nodes);

  return {
    setLevel(v, when, tc = 0.3) { level.gain.setTargetAtTime(v, when, tc); },
    stop() { stopAll(nodes); level.disconnect(); },
  };
}

/** Underwater: a deep rumble that darkens with depth, plus a faint sub drone. */
export function createDeepLayer(ctx, out, noise) {
  const nodes = [];
  const level = ctx.createGain(); level.gain.value = 0; level.connect(out);

  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.7;
  const rumble = ctx.createGain(); rumble.gain.value = 0.85;
  loopSource(ctx, noise.brown, nodes).connect(lp).connect(rumble).connect(level);
  lfo(ctx, 0.061, 0.25, rumble.gain, nodes);

  const drone = ctx.createGain(); drone.gain.value = 0; drone.connect(level);
  for (const [hz, g] of [[41, 0.6], [61.5, 0.35], [82.4, 0.15]]) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = hz; og.gain.value = g;
    o.connect(og).connect(drone); o.start(); nodes.push(o);
    lfo(ctx, 0.03 + hz / 4000, 0.8, o.detune, nodes);
  }

  return {
    setLevel(v, when, tc = 0.4) { level.gain.setTargetAtTime(v, when, tc); },
    /** Deeper water: the rumble gets darker and the drone grows. */
    setDepth(depth, when, tc = 0.5) {
      lp.frequency.setTargetAtTime(90 + 620 * Math.exp(-depth / 900), when, tc);
      drone.gain.setTargetAtTime(Math.min(1, 0.08 + depth / 1800) * 0.3, when, tc);
    },
    stop() { stopAll(nodes); level.disconnect(); },
  };
}
