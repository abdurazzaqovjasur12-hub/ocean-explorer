import { noiseBuffer, impulseResponse, bubble, bubbleCluster, splash, whoosh, whale, groan, deepBoom, uiClick, uiChime, rand,
  createEncounterDrone, encounterWarning, encounterRush, encounterImpact, encounterPass } from './synth';
import { createDayMusic, createNightMusic } from './music';
import { createSurfaceLayer, createUnderwaterLayer } from './ambience';
import { AUDIO_FILES, loadAudioFile } from './files';
import { smoothstep } from '@/utils/math';

const STORAGE_KEY = 'ocean-explorer.sound.v2';
const LEGACY_KEY = 'ocean-explorer.sound.v1'; // { enabled, volume }: read once, as the master volume
const LOOKAHEAD = 1.2; // seconds of sound scheduled ahead of the audio clock
const MODE_FADE = 3; // seconds: the day / night crossfade
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

function defaultCreateContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('Web Audio is not supported in this browser');
  return new AC({ latencyHint: 'playback' });
}
function safeStorage() {
  try { return window.localStorage; } catch { return null; } // blocked in some private modes
}

/**
 * Equal-power fade of a gain towards `to` (0 or 1) from wherever it is now, over `dur` seconds. Two of these in
 * opposite directions make a crossfade in which the two sides are never both at full level (at the midpoint
 * each is at ~71%). Starting from the current value makes a reversal mid-fade seamless.
 */
function equalPowerFade(param, to, t, dur) {
  const from = param.value;
  const curve = new Float32Array(48);
  for (let i = 0; i < curve.length; i++) {
    const x = i / (curve.length - 1);
    const k = to > from ? Math.sin((x * Math.PI) / 2) : 1 - Math.cos((x * Math.PI) / 2);
    curve[i] = from + (to - from) * k;
  }
  param.cancelScheduledValues(t);
  param.setValueCurveAtTime(curve, t, dur);
}

/** 0 at the surface .. 1 in the hadal deep, on a log scale (each zone gets its share). */
export const moodAt = (meters) => clamp01(Math.log1p(Math.max(0, meters) / 100) / Math.log1p(110));

/**
 * The whole sound system: music, ambience, effects, the mixer and the browser autoplay rules.
 * No framework in here; see bridge.js for how it is wired to the app.
 *
 *   master ── compressor ── limiter ── speakers
 *     ├─ music bus (music volume) ── duck ── tone ─┬─ day piece   ┐ crossfaded with the day / night mode
 *     │                                    └─ night piece ┘
 *     ├─ effects bus (effects volume) ── underwater filter ── ambience (surface + depth zones), effects and
 *     │                                                       the megalodon's drone (night only, see setEncounter)
 *     ├─ interface sounds (effects volume, never filtered)
 *     └─ one shared reverb, fed after the volumes (so a silenced bus leaves no tail behind)
 *
 * The music is not muffled by the underwater filter (it is the score, not a sound in the water); it only
 * darkens a little, and its pieces grow sparser and more mysterious with depth.
 *
 * Autoplay: browsers only let audio start after a user gesture, so nothing is created until unlock() is
 * called from one (bridge.js does this on the first click, tap or key press).
 */
export class AudioEngine {
  constructor({ createContext = defaultCreateContext, storage, files = AUDIO_FILES, manual = false, fetchFn } = {}) {
    this.createContext = createContext;
    this.storage = storage === undefined ? safeStorage() : storage;
    this.files = files;
    this.manual = manual; // tests: no timers, no resume(); the caller schedules explicitly
    this.fetchFn = fetchFn;

    this.ctx = null;
    this.graph = null;
    this.enabled = true; // not muted (remembered); sound starts after the first gesture unless muted
    this.volume = 0.7; // master
    this.music = 0.8;
    this.effects = 0.8;
    this.mode = 'day';
    this.unlocked = false;
    this.paused = false; // tab hidden
    this.error = null;
    this.env = { depth: 0, under: 0 };
    this.encounter = 0; // the megalodon encounter's tension, 0..1 (heard only in night mode)
    this.fileReport = {};

    this._envDirty = true;
    this._listeners = new Set();
    this._unlocking = null;
    this._autoStarted = false;
    this._pending = [];
    this._timer = 0;
    this._suspendTimer = 0;
    this._saveTimer = 0;
    this._tickErrors = new Set();
    this._loadPrefs();
  }

  // ---------- state ----------
  get contextState() { return this.ctx ? this.ctx.state : 'none'; }
  /** True only when sound is really coming out: unlocked, wanted, not muted, no error, and the context is running. */
  get audible() {
    if (!this.unlocked || !this.enabled || this.error || this.volume <= 0) return false;
    if (this.manual) return true;
    return !this.paused && this.contextState === 'running';
  }
  snapshot() {
    return {
      enabled: this.enabled, volume: this.volume, music: this.music, effects: this.effects, mode: this.mode,
      unlocked: this.unlocked, paused: this.paused, contextState: this.contextState, error: this.error, audible: this.audible,
      files: { ...this.fileReport },
    };
  }
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { const s = this.snapshot(); for (const fn of this._listeners) { try { fn(s); } catch (e) { console.error('[audio] listener failed', e); } } }
  _fail(e) { this.error = e?.message || String(e); console.error('[audio]', e); this._emit(); }

  _loadPrefs() {
    const read = (key) => { try { return JSON.parse(this.storage?.getItem(key) || 'null'); } catch { return null; } };
    const saved = read(STORAGE_KEY) || read(LEGACY_KEY);
    if (!saved || typeof saved !== 'object') return;
    if (typeof saved.enabled === 'boolean') this.enabled = saved.enabled;
    if (Number.isFinite(saved.volume)) this.volume = clamp01(saved.volume);
    if (Number.isFinite(saved.music)) this.music = clamp01(saved.music);
    if (Number.isFinite(saved.effects)) this.effects = clamp01(saved.effects);
  }
  _savePrefs() {
    clearTimeout(this._saveTimer);
    const write = () => {
      try {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume, music: this.music, effects: this.effects }));
      } catch { /* storage full or blocked */ }
    };
    // Sliders send a stream of values: write once they settle, not on every step.
    if (this.manual) write();
    else this._saveTimer = setTimeout(write, 250);
  }

  // ---------- starting up (autoplay) ----------
  _ensureContext() {
    if (this.ctx || this.error) return this.ctx;
    try {
      this.ctx = this.createContext();
      if (!this.ctx) throw new Error('Web Audio is not supported in this browser');
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS 16.4+: sound even with the silent switch on */ }
      this.ctx.onstatechange = () => this._emit();
    } catch (e) { this._fail(e); }
    return this.ctx;
  }

  /** Call from inside a user gesture. Safe to call repeatedly; resolves true once audio can play. */
  unlock() {
    if (this.unlocked && (this.manual || this.ctx?.state === 'running')) return Promise.resolve(true);
    if (this._unlocking) return this._unlocking;
    this._unlocking = (async () => {
      const ctx = this._ensureContext();
      if (!ctx) return false;
      try {
        if (!this.manual && ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
        if (!this.manual && ctx.state !== 'running') { this._emit(); return false; } // still blocked: the next gesture tries again
        if (!this.manual) this._silentPing();
        if (!this.graph) this._build();
        this.unlocked = true;
        this._emit();
        return true;
      } catch (e) { this._fail(e); return false; }
    })().finally(() => { this._unlocking = null; });
    return this._unlocking;
  }

  /** After the first gesture: unlock, and start playing unless the user had muted sound. */
  async autoStart() {
    const ok = await this.unlock();
    if (ok && !this._autoStarted) {
      this._autoStarted = true;
      await this._engage();
    }
    return ok;
  }

  /** A tiny silent sound: iOS Safari only treats the context as unlocked once something has been played. */
  _silentPing() {
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, 22050);
      s.connect(this.ctx.destination); s.start(0);
    } catch { /* not needed everywhere */ }
  }

  async _engage() {
    await this._settle();
    this._applyMaster();
    this._applyEnv(true);
    this._flushPending();
    this._emit();
  }

  /** Keep the context in step with what we want: running while audible, suspended (no CPU) while not. */
  async _settle() {
    if (!this.ctx || this.manual) return;
    clearTimeout(this._suspendTimer);
    if (this.enabled && !this.paused) {
      if (this.unlocked && this.ctx.state !== 'running') {
        try { await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* blocked until the next gesture */ }
      }
    } else {
      this._suspendTimer = setTimeout(() => {
        if (!(this.enabled && !this.paused)) this.ctx?.suspend?.().catch(() => {});
      }, 900); // let the fade-out finish first
    }
  }

  /** iOS can interrupt audio (a call, Siri). Resume on the next gesture if we should be playing. */
  async ensureRunning() {
    if (!this.unlocked || !this.enabled || this.paused || !this.ctx || this.manual) return;
    if (this.ctx.state !== 'running') {
      try { await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 1500))]); this._emit(); } catch { /* try again later */ }
    }
  }

  // ---------- user controls ----------
  async setEnabled(on) {
    this.enabled = !!on;
    this._savePrefs();
    if (this.enabled) {
      if (await this.unlock()) {
        this._autoStarted = true;
        await this._engage();
        if (this.audible) this._play('on');
      }
    } else {
      this._applyMaster();
      this._settle();
    }
    this._emit();
    return this.audible;
  }
  async toggle() {
    const turnOn = !this.audible;
    if (turnOn && this.volume === 0) this.volume = 0.6; // "on" at zero volume would be silent
    return this.setEnabled(turnOn);
  }
  /** Master volume, 0..1. */
  setVolume(v) { this.volume = clamp01(v); this._savePrefs(); this._applyMaster(); this._emit(); }
  /** Background music volume, 0..1. */
  setMusicVolume(v) { this.music = clamp01(v); this._savePrefs(); this._applyMaster(); this._emit(); }
  /** Sound effects and ambience volume, 0..1. */
  setEffectsVolume(v) { this.effects = clamp01(v); this._savePrefs(); this._applyMaster(); this._emit(); }

  /**
   * 'day' or 'night': the soundtrack crossfades (equal power, MODE_FADE seconds) to the other piece. Only the
   * incoming piece schedules new notes; the outgoing one stops once it has faded. Nothing restarts.
   */
  setMode(mode, { immediate = false } = {}) {
    const next = mode === 'night' ? 'night' : 'day';
    const changed = next !== this.mode;
    this.mode = next;
    if (!this.graph) return;
    const { ctx, graph: g } = this;
    const t = ctx.currentTime;
    const incoming = g.pieces[next];
    const outgoing = g.pieces[next === 'night' ? 'day' : 'night'];
    incoming.start(t);
    if (immediate) {
      incoming.output.gain.cancelScheduledValues(t);
      incoming.output.gain.setValueAtTime(1, t);
      outgoing.output.gain.cancelScheduledValues(t);
      outgoing.output.gain.setValueAtTime(0, t);
      outgoing.stop(t);
    } else if (changed) {
      equalPowerFade(incoming.output.gain, 1, t, MODE_FADE);
      equalPowerFade(outgoing.output.gain, 0, t, MODE_FADE);
      outgoing.stop(t + MODE_FADE + 0.2);
    }
    this._envDirty = true;
    this._applyEncounter(); // day mode silences the encounter at once
    this._emit();
  }

  /**
   * The megalodon encounter (scenes/ocean/megalodon), 0..1: the low drone rises as it comes closer and the music
   * steps back a little to make room. Night mode only: in day mode this is always silent, whatever is asked.
   */
  setEncounter(level) {
    this.encounter = clamp01(level);
    this._applyEncounter();
  }
  _applyEncounter() {
    if (!this.graph) return;
    const t = this.ctx.currentTime;
    const v = this.mode === 'night' ? this.encounter : 0;
    this.graph.encounter.setLevel(0.2 * v, t, v > 0 ? 0.9 : 0.5); // felt more than heard: well under the music
    this.graph.musicDuck.gain.setTargetAtTime(1 - 0.4 * v, t, 0.8);
  }

  /** Tab hidden / shown: be silent and idle in the background. */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this._applyMaster();
    this._settle();
    this._emit();
  }
  async resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.unlocked) { await this._settle(); this._applyMaster(); }
    this._emit();
  }

  // ---------- the sound itself ----------
  _build() {
    const ctx = this.ctx;
    const master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 18; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
    // A fast limiter at the very end: at full volume loud moments are held under 0 dBFS instead of clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.12;
    master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);

    // One reverb for everything, fed after the volume controls.
    const reverb = ctx.createConvolver(); reverb.buffer = impulseResponse(ctx);
    const reverbIn = ctx.createGain(); reverbIn.gain.value = 1;
    reverbIn.connect(reverb); reverb.connect(master);

    // Music: its own volume, a gentle tone control, the two pieces.
    const musicVol = ctx.createGain(); musicVol.gain.value = 0;
    const musicTone = ctx.createBiquadFilter(); musicTone.type = 'lowpass'; musicTone.frequency.value = 16000; musicTone.Q.value = 0.5;
    // The duck: the music steps back a little while the megalodon is near (setEncounter).
    const musicDuck = ctx.createGain(); musicDuck.gain.value = 1;
    musicTone.connect(musicDuck); musicDuck.connect(musicVol); musicVol.connect(master);
    const musicSend = ctx.createGain(); musicSend.gain.value = 0.32; musicVol.connect(musicSend); // the pieces send their own wet parts too
    musicSend.connect(reverbIn);

    // The world: ambience and effects through the underwater filter, then the effects volume.
    const fxVol = ctx.createGain(); fxVol.gain.value = 0;
    const underFilter = ctx.createBiquadFilter(); underFilter.type = 'lowpass'; underFilter.frequency.value = 18000; underFilter.Q.value = 0.5;
    underFilter.connect(fxVol); fxVol.connect(master);
    const worldSend = ctx.createGain(); worldSend.gain.value = 0.18; fxVol.connect(worldSend); worldSend.connect(reverbIn);
    const ambBus = ctx.createGain(); ambBus.connect(underFilter);
    const sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(underFilter);
    const ui = ctx.createGain(); ui.gain.value = 0; ui.connect(master); // interface: effects volume, never filtered

    const noise = { white: noiseBuffer(ctx, 'white', 4), pink: noiseBuffer(ctx, 'pink', 8), brown: noiseBuffer(ctx, 'brown', 8) };
    const sends = { reverb: musicSend };
    const now = ctx.currentTime;
    this.graph = {
      master, comp, limiter, reverbIn, musicVol, musicTone, musicDuck, musicSend, fxVol, underFilter, worldSend, ambBus, sfx, ui, noise,
      surface: createSurfaceLayer(ctx, ambBus, noise),
      underwater: createUnderwaterLayer(ctx, ambBus, noise),
      encounter: createEncounterDrone(ctx, sfx, noise.brown),
      pieces: {
        day: createDayMusic(ctx, musicTone, sends),
        night: createNightMusic(ctx, musicTone, sends, noise.pink),
      },
      events: { nextBubble: now + 1.5, nextWhale: now + 15, nextGroan: now + 12, nextBoom: now + 20 },
      analyser: null,
    };
    this.setMode(this.mode, { immediate: true });
    if (!this.manual) this._timer = setInterval(() => this._tick(), 200);
    this._loadFiles();
  }

  _tick() {
    if (!this.graph || this.ctx.state !== 'running') return;
    try {
      this._applyEnv();
      this._schedule(this.ctx.currentTime + LOOKAHEAD);
    } catch (e) {
      // One bad note must not silence everything (an error here used to switch the whole sound system off):
      // report it once and carry on with the next tick.
      const msg = e?.message || String(e);
      if (!this._tickErrors.has(msg)) { this._tickErrors.add(msg); console.error('[audio] scheduling failed', e); }
    }
  }

  /** Schedule everything that should sound up to `until` (audio-clock seconds). Public so tests can render offline. */
  _schedule(until) {
    const { ctx, graph: g } = this;
    const { depth, under } = this.env;
    const ev = g.events;
    const now = ctx.currentTime;
    const night = this.mode === 'night';
    g.pieces.day.schedule(until);
    g.pieces.night.schedule(until);
    // After a stall (busy main thread, interrupted context) skip what was missed instead of playing it all at once.
    for (const k of Object.keys(ev)) if (ev[k] < now - 0.5) ev[k] = now + rand(0.5, 3);

    // Bubbles: a few, soft, now and then a little cluster; fewer in the deep and at night.
    if (under > 0.25) {
      const rate = (night ? 0.3 : 0.45) * (1 - 0.85 * smoothstep(150, 2000, depth)) * under; // per second
      while (ev.nextBubble < until) {
        if (Math.random() < 0.18) bubbleCluster(ctx, g.sfx, ev.nextBubble, Math.round(rand(3, 6)), 0.5);
        else bubble(ctx, g.sfx, ev.nextBubble);
        ev.nextBubble += rand(0.6, 1.6) / Math.max(0.05, rate);
      }
    } else ev.nextBubble = Math.max(ev.nextBubble, until);

    // A whale far off, only around the whale's depths (where one is met).
    if (depth > 1100 && depth < 2700 && under > 0.8) {
      if (ev.nextWhale < until) { whale(ctx, g.sfx, ev.nextWhale); ev.nextWhale += rand(30, 55); }
    } else ev.nextWhale = Math.max(ev.nextWhale, until + 6);

    // Pressure groans from 800 m down, more often at night.
    if (depth > 800 && under > 0.8) {
      if (ev.nextGroan < until) { groan(ctx, g.sfx, ev.nextGroan); ev.nextGroan += rand(night ? 22 : 32, night ? 45 : 65); }
    } else ev.nextGroan = Math.max(ev.nextGroan, until + 5);

    // Far-off booms rolling through the abyssal and hadal deep.
    if (depth > 4000 && under > 0.8) {
      if (ev.nextBoom < until) { deepBoom(ctx, g.sfx, ev.nextBoom, g.noise.brown); ev.nextBoom += rand(26, 48); }
    } else ev.nextBoom = Math.max(ev.nextBoom, until + 6);
  }

  setEnvironment({ depth = 0, under = 0 }) {
    this.env = { depth, under: clamp01(under) };
    this._envDirty = true;
    if (this.manual) this._applyEnv(true);
  }

  /** Surface sounds give way to the underwater zones as the camera goes under; everything follows the depth. */
  _applyEnv(force = false) {
    if (!this.graph || (!force && !this._envDirty)) return;
    this._envDirty = false;
    const { ctx, graph: g } = this;
    const { depth, under } = this.env;
    const t = ctx.currentTime;
    const night = this.mode === 'night' ? 1 : 0;
    const mood = moodAt(depth);
    g.surface.setLevel(0.7 * Math.cos((under * Math.PI) / 2) * (1 - 0.25 * night), t);
    g.underwater.setLevel(0.5 * Math.sin((under * Math.PI) / 2), t);
    g.underwater.setDepth(depth, night, t);
    const fcUnder = 2600 * Math.exp(-depth / 1500) + 500;
    g.underFilter.frequency.setTargetAtTime(Math.pow(18000, 1 - under) * Math.pow(fcUnder, under), t, 0.35);
    g.worldSend.gain.setTargetAtTime(0.16 + 0.2 * under, t, 0.4);
    // The score darkens a little underwater and with depth, but is never muffled.
    g.musicTone.frequency.setTargetAtTime(16000 - 6000 * under - 4000 * mood, t, 0.6);
    g.pieces.day.setMood(mood, t);
    g.pieces.night.setMood(mood, t);
  }

  _applyMaster() {
    if (!this.graph) return;
    const t = this.ctx.currentTime;
    const on = this.enabled && !this.paused && this.unlocked;
    // Squared: a slider feels even to the ear. Short time constants: sliders move smoothly, without zipper noise.
    this.graph.master.gain.setTargetAtTime(on ? Math.pow(this.volume, 2) : 0, t, 0.08);
    this.graph.musicVol.gain.setTargetAtTime(Math.pow(this.music, 2) * 1.8, t, 0.05);
    this.graph.fxVol.gain.setTargetAtTime(Math.pow(this.effects, 2) * 1.5, t, 0.05);
    this.graph.ui.gain.setTargetAtTime(Math.pow(this.effects, 2) * 0.9, t, 0.05);
  }

  /**
   * Sound events: 'start' (button tick), 'dive' (the descent begins), 'plunge' (breaking the surface), 'click', 'on',
   * and the megalodon's 'megWarning', 'megRush', 'megImpact', 'megPass' (night mode only; never queued for later).
   */
  cue(name) {
    if (this.error) return;
    if (name.startsWith('meg') && (this.mode !== 'night' || !this.graph || !this.audible)) return;
    if (!this.graph || !this.audible) {
      if (this.enabled) this._pending.push({ name, at: performance.now() }); // waiting for the first unlock
      return;
    }
    this._play(name);
  }
  _flushPending() {
    // Only the latest of each kind, and only recent ones: an unlock never fires a burst of stale sounds.
    const recent = new Map();
    for (const p of this._pending) if (performance.now() - p.at < 2000) recent.set(p.name, p);
    this._pending = [];
    if (this.audible) [...recent.values()].forEach((p) => this._play(p.name));
  }
  _play(name) {
    const { ctx, graph: g } = this;
    const t = ctx.currentTime + 0.02;
    try {
      if (name === 'start' || name === 'click') uiClick(ctx, g.ui, t);
      else if (name === 'on') uiChime(ctx, g.ui, t, true);
      else if (name === 'dive') whoosh(ctx, g.sfx, t, g.noise.pink);
      else if (name === 'plunge') { splash(ctx, g.sfx, t, g.noise.white); bubbleCluster(ctx, g.sfx, t + 0.04, 18, 1.6); }
      else if (name.startsWith('meg')) {
        if (this.mode !== 'night') return; // the encounter is never heard in day mode
        if (name === 'megWarning') encounterWarning(ctx, g.ui, t);
        else if (name === 'megRush') encounterRush(ctx, g.sfx, t, g.noise.pink);
        else if (name === 'megImpact') encounterImpact(ctx, g.sfx, t, g.noise.brown);
        else if (name === 'megPass') encounterPass(ctx, g.sfx, t, g.noise.pink);
      }
    } catch (e) { this._fail(e); }
  }

  // ---------- optional recorded files ----------
  async _loadFiles() {
    for (const [name, spec] of Object.entries(this.files || {})) {
      if (!this.ctx) return; // disposed meanwhile
      this.fileReport[name] = { url: spec.url, status: 'loading' };
      const r = await loadAudioFile(this.ctx, name, spec, { fetchFn: this.fetchFn || ((...a) => fetch(...a)) });
      if (!this.graph) return;
      this.fileReport[name] = { url: r.url, status: r.status, detail: r.detail, ms: r.ms };
      if (r.ok) this._useFile(spec, r.buffer);
      else if (r.status === 'missing') console.info(`[audio] "${name}": ${r.detail}. Using the generated music instead.`);
      else console.warn(`[audio] "${name}" (${r.url}): ${r.status}, ${r.detail}. Using the generated music instead.`);
      this._emit();
    }
  }
  /** A recording replaces the generated piece of its mode; it takes over that piece's place in the crossfade. */
  _useFile(spec, buffer) {
    const { ctx, graph: g } = this;
    const mode = spec.mode === 'night' ? 'night' : 'day';
    const old = g.pieces[mode];
    const t = ctx.currentTime;
    const output = ctx.createGain();
    output.gain.value = 0;
    output.connect(g.musicTone);
    let src = null;
    const piece = {
      output,
      get active() { return !!src; },
      start(when) {
        if (src) return;
        src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = spec.loop !== false;
        src.connect(output);
        src.start(when);
      },
      stop(when) { const s = src; src = null; try { s?.stop(when); } catch { /* not started */ } },
      schedule() {},
      setMood() {},
    };
    g.pieces[mode] = piece;
    if (this.mode === mode) {
      piece.start(t);
      equalPowerFade(output.gain, 1, t, MODE_FADE);
    }
    equalPowerFade(old.output.gain, 0, t, MODE_FADE);
    old.stop(t + MODE_FADE + 0.2);
  }

  /** For tests and diagnostics: an analyser on the final output. */
  getAnalyser() {
    if (!this.graph) return null;
    if (!this.graph.analyser) { const a = this.ctx.createAnalyser(); a.fftSize = 2048; this.graph.limiter.connect(a); this.graph.analyser = a; }
    return this.graph.analyser;
  }

  dispose() {
    clearInterval(this._timer); clearTimeout(this._suspendTimer); clearTimeout(this._saveTimer);
    try {
      this.graph?.surface.stop(); this.graph?.underwater.stop(); this.graph?.encounter.stop();
      const t = this.ctx?.currentTime ?? 0;
      Object.values(this.graph?.pieces ?? {}).forEach((p) => p.stop(t));
    } catch { /* already stopped */ }
    this.ctx?.close?.().catch(() => {});
    this.ctx = null; this.graph = null; this.unlocked = false; this._listeners.clear();
  }
}

let instance = null;
/** One engine for the whole app. */
export function getAudioEngine() {
  if (!instance) {
    instance = new AudioEngine();
    // In development, `__oceanAudio.snapshot()` / `.fileReport` in the console show what the audio system is doing.
    if (typeof window !== 'undefined' && import.meta.env?.DEV) window.__oceanAudio = instance;
  }
  return instance;
}

// Development: when this module is hot-replaced, close the old engine, or its sound would keep playing
// underneath the new one (two soundtracks at once).
if (import.meta.hot) {
  import.meta.hot.dispose(() => { instance?.dispose(); instance = null; });
}
