import { noiseBuffer, impulseResponse, bubble, bubbleCluster, splash, whoosh, whale, creak, uiClick, uiChime, rand } from './synth';
import { createMusic } from './music';
import { createSurfaceLayer, createDeepLayer } from './ambience';
import { AUDIO_FILES, loadAudioFile } from './files';

const STORAGE_KEY = 'ocean-explorer.sound.v1';
const LOOKAHEAD = 1.2; // seconds of sound scheduled ahead of the audio clock
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
 * The whole sound system: music, ambience, effects, volume and the browser autoplay rules.
 * No framework in here; see bridge.js for how it is wired to the app.
 *
 * Autoplay: browsers only let audio start after a user gesture, so nothing is created until
 * unlock() is called from one (bridge.js does this on the first click, tap or key press).
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
    this.enabled = true; // the user's preference (remembered); sound starts after the first gesture unless turned off
    this.volume = 0.7;
    this.unlocked = false;
    this.paused = false; // tab hidden
    this.error = null;
    this.env = { depth: 0, under: 0 };
    this.fileReport = {};

    this._envDirty = true;
    this._listeners = new Set();
    this._unlocking = null;
    this._autoStarted = false;
    this._pending = [];
    this._timer = 0;
    this._suspendTimer = 0;
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
    return { enabled: this.enabled, volume: this.volume, unlocked: this.unlocked, paused: this.paused, contextState: this.contextState, error: this.error, audible: this.audible, files: { ...this.fileReport } };
  }
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { const s = this.snapshot(); for (const fn of this._listeners) { try { fn(s); } catch (e) { console.error('[audio] listener failed', e); } } }
  _fail(e) { this.error = e?.message || String(e); console.error('[audio]', e); this._emit(); }

  _loadPrefs() {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (typeof saved.enabled === 'boolean') this.enabled = saved.enabled;
        if (Number.isFinite(saved.volume)) this.volume = clamp01(saved.volume);
      }
    } catch { /* corrupt or unavailable: keep defaults */ }
  }
  _savePrefs() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume })); } catch { /* storage full or blocked */ }
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

  /** After the first gesture: unlock, and start playing unless the user had turned sound off. */
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
      }, 900); // let the fade-out finish first (about 11 time constants: well below audibility)
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
  setVolume(v) {
    this.volume = clamp01(v);
    this._savePrefs();
    this._applyMaster();
    this._emit();
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
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
    // A fast limiter at the very end: at full volume loud moments are held under 0 dBFS instead of clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.12;
    master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);

    const ui = ctx.createGain(); ui.gain.value = 0.9; ui.connect(master);
    // Everything in the "world" passes through one low-pass filter that closes as you go underwater.
    const underFilter = ctx.createBiquadFilter(); underFilter.type = 'lowpass'; underFilter.frequency.value = 18000; underFilter.Q.value = 0.5;
    underFilter.connect(master);
    const reverb = ctx.createConvolver(); reverb.buffer = impulseResponse(ctx);
    const reverbIn = ctx.createGain(); reverbIn.gain.value = 0.18;
    reverbIn.connect(reverb); reverb.connect(underFilter);

    const musicOut = ctx.createGain(); musicOut.connect(underFilter);
    const ambBus = ctx.createGain(); ambBus.connect(underFilter);
    const sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(underFilter); sfx.connect(reverbIn);

    const noise = { white: noiseBuffer(ctx, 'white', 4), pink: noiseBuffer(ctx, 'pink', 8), brown: noiseBuffer(ctx, 'brown', 8) };
    const now = ctx.currentTime;
    this.graph = {
      master, comp, limiter, ui, underFilter, reverbIn, musicOut, ambBus, sfx, noise,
      surface: createSurfaceLayer(ctx, ambBus, noise),
      deep: createDeepLayer(ctx, ambBus, noise),
      music: createMusic(ctx, musicOut, reverbIn),
      events: { nextBubble: now + 0.5, nextWhale: now + 12, nextCreak: now + 9 },
      analyser: null,
    };
    if (!this.manual) this._timer = setInterval(() => this._tick(), 200);
    this._loadFiles();
  }

  _tick() {
    if (!this.graph || this.ctx.state !== 'running') return;
    try {
      this._applyEnv();
      this._schedule(this.ctx.currentTime + LOOKAHEAD);
    } catch (e) { this._fail(e); }
  }

  /** Schedule everything that should sound up to `until` (audio-clock seconds). Public so tests can render offline. */
  _schedule(until) {
    const { ctx, graph: g } = this;
    const { depth, under } = this.env;
    const ev = g.events;
    g.music.schedule(until);

    if (under > 0.25) {
      while (ev.nextBubble < until) {
        bubble(ctx, g.sfx, Math.max(ev.nextBubble, ctx.currentTime), { gain: rand(0.2, 0.5) * (0.6 + 0.4 * under) });
        ev.nextBubble += rand(0.25, 1.1) / (0.6 + under);
      }
    } else ev.nextBubble = Math.max(ev.nextBubble, until);

    if (depth > 500 && under > 0.8) {
      if (ev.nextWhale < until) { whale(ctx, g.sfx, Math.max(ev.nextWhale, ctx.currentTime)); ev.nextWhale = until + rand(25, 50); }
    } else ev.nextWhale = Math.max(ev.nextWhale, until + 8);

    if (depth > 200 && under > 0.8) {
      if (ev.nextCreak < until) { creak(ctx, g.sfx, Math.max(ev.nextCreak, ctx.currentTime), g.noise.white); ev.nextCreak = until + rand(14, 35); }
    } else ev.nextCreak = Math.max(ev.nextCreak, until + 6);
  }

  setEnvironment({ depth = 0, under = 0 }) {
    this.env = { depth, under: clamp01(under) };
    this._envDirty = true;
    if (this.manual) this._applyEnv(true);
  }

  /** Surface sounds fade out and underwater sounds fade in as the camera goes under. */
  _applyEnv(force = false) {
    if (!this.graph || (!force && !this._envDirty)) return;
    this._envDirty = false;
    const { ctx, graph: g } = this;
    const { depth, under } = this.env;
    const t = ctx.currentTime;
    g.surface.setLevel(0.8 * Math.cos(under * Math.PI / 2), t);
    g.deep.setLevel(0.45 * Math.sin(under * Math.PI / 2), t);
    g.deep.setDepth(depth, t);
    const fcUnder = 2600 * Math.exp(-depth / 1500) + 400;
    g.underFilter.frequency.setTargetAtTime(Math.pow(18000, 1 - under) * Math.pow(fcUnder, under), t, 0.35);
    g.reverbIn.gain.setTargetAtTime(0.18 + 0.22 * under, t, 0.4);
    g.music.setBrightness(1100 - 300 * under, t);
  }

  _applyMaster() {
    if (!this.graph) return;
    const on = this.enabled && !this.paused && this.unlocked;
    const level = on ? Math.pow(this.volume, 2) * 0.9 : 0; // squared: the slider feels even to the ear
    this.graph.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.08);
  }

  /** Sound events: 'start' (button tick), 'dive' (the descent begins), 'plunge' (breaking the surface), 'click', 'on'. */
  cue(name) {
    if (this.error) return;
    if (!this.graph || !this.audible) {
      if (this.enabled) this._pending.push({ name, at: performance.now() }); // waiting for the first unlock
      return;
    }
    this._play(name);
  }
  _flushPending() {
    const recent = this._pending.filter((p) => performance.now() - p.at < 2000);
    this._pending = [];
    if (this.audible) recent.forEach((p) => this._play(p.name));
  }
  _play(name) {
    const { ctx, graph: g } = this;
    const t = ctx.currentTime + 0.02;
    try {
      if (name === 'start' || name === 'click') uiClick(ctx, g.ui, t);
      else if (name === 'on') uiChime(ctx, g.ui, t, true);
      else if (name === 'dive') whoosh(ctx, g.sfx, t, g.noise.white);
      else if (name === 'plunge') { splash(ctx, g.sfx, t, g.noise.white); bubbleCluster(ctx, g.sfx, t + 0.04, 36, 1.8); }
    } catch (e) { this._fail(e); }
  }

  // ---------- optional recorded files ----------
  async _loadFiles() {
    for (const [name, spec] of Object.entries(this.files || {})) {
      this.fileReport[name] = { url: spec.url, status: 'loading' };
      const r = await loadAudioFile(this.ctx, name, spec, { fetchFn: this.fetchFn || ((...a) => fetch(...a)) });
      this.fileReport[name] = { url: r.url, status: r.status, detail: r.detail, ms: r.ms };
      if (r.ok) this._useFile(name, spec, r.buffer);
      else if (r.status === 'missing') console.info(`[audio] "${name}": ${r.detail}. Using the generated sound instead.`);
      else console.warn(`[audio] "${name}" (${r.url}): ${r.status}, ${r.detail}. Using the generated sound instead.`);
      this._emit();
    }
  }
  _useFile(name, spec, buffer) {
    const { ctx, graph: g } = this;
    if (name !== 'music') return;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = spec.loop !== false;
    const fade = ctx.createGain(); fade.gain.value = 0; fade.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    src.connect(fade).connect(g.musicOut); src.start();
    g.music.stop(); g.music.output.gain.setTargetAtTime(0, ctx.currentTime, 1.0); // generated music fades out
  }

  /** For tests and diagnostics: an analyser on the final output. */
  getAnalyser() {
    if (!this.graph) return null;
    if (!this.graph.analyser) { const a = this.ctx.createAnalyser(); a.fftSize = 2048; this.graph.limiter.connect(a); this.graph.analyser = a; }
    return this.graph.analyser;
  }

  dispose() {
    clearInterval(this._timer); clearTimeout(this._suspendTimer);
    try { this.graph?.surface.stop(); this.graph?.deep.stop(); this.graph?.music.stop(); } catch { /* already stopped */ }
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
