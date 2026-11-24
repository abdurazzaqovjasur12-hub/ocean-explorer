import * as THREE from 'three';
import { QUALITY_LEVELS } from '@/config/quality';
import { disposeObject3D } from '@/utils/dispose';

const MIN_PIXEL_SCALE = 0.6;
const WARMUP_FRAMES = 60;
const SAMPLE_FRAMES = 90;

/**
 * Owns the renderer, camera, scene and render loop. Framework-agnostic:
 * Vue components create one, add updaters, and call dispose() on unmount.
 */
export class SceneManager {
  constructor(container, { quality = 'medium', adaptive = true, onContextLost, onContextRestored, onPerformanceDrop } = {}) {
    this.container = container;
    this.adaptive = adaptive;
    this.callbacks = { onContextLost, onContextRestored, onPerformanceDrop };

    this.updaters = new Set();
    this.resizers = new Set();
    this.renderFn = null; // a scene can take over rendering (e.g. post-processing)
    this.running = false;
    this.wantsRunning = false;
    this.disposed = false;
    this.rafId = 0;
    this.lastTime = 0;
    this.elapsed = 0;

    this.pixelScale = 1; // lowered automatically if the GPU struggles
    this.size = { width: 0, height: 0, pixelRatio: 0 };
    this._resetPerfSample();

    this.quality = quality in QUALITY_LEVELS ? quality : 'medium';
    this.settings = QUALITY_LEVELS[this.quality];

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.2, 6000);

    // Throws if WebGL is unavailable; the caller handles that.
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.settings.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('three-canvas');
    container.appendChild(this.canvas);

    this._tick = this._tick.bind(this);
    this._onResize = () => this.resize();
    this._onVisibility = () => {
      if (document.hidden) this._halt();
      else if (this.wantsRunning) this._run();
    };
    this._onContextLost = (e) => {
      e.preventDefault();
      this._halt();
      this.callbacks.onContextLost?.();
    };
    this._onContextRestored = () => {
      if (this.wantsRunning && !document.hidden) this._run();
      this.callbacks.onContextRestored?.();
    };

    this.resizeObserver = new ResizeObserver(this._onResize);
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this._onResize); // also catches devicePixelRatio changes
    document.addEventListener('visibilitychange', this._onVisibility);
    this.canvas.addEventListener('webglcontextlost', this._onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored);

    this.resize();
  }

  /** Register a per-frame callback `(dt, elapsed) => void`. Returns a function that removes it. */
  addUpdater(fn) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /**
   * Let the scene render the frame itself (post-processing): `fn()` replaces renderer.render(scene, camera);
   * pass null to go back to the default.
   */
  setRenderFunction(fn) {
    this.renderFn = fn;
  }

  /** Call `fn(width, height, pixelRatio)` now and on every resize. Returns a function that removes it. */
  addResizer(fn) {
    this.resizers.add(fn);
    if (this.size.width) fn(this.size.width, this.size.height, this.size.pixelRatio);
    return () => this.resizers.delete(fn);
  }

  _render() {
    if (this.renderFn) this.renderFn();
    else this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const pixelRatio = Math.max(
      0.5,
      Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio) * this.pixelScale,
    );
    const s = this.size;
    if (width === s.width && height === s.height && pixelRatio === s.pixelRatio) return;
    this.size = { width, height, pixelRatio };

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false); // CSS controls the canvas box
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 72 : 58; // wider vertical FOV in portrait
    this.camera.updateProjectionMatrix();

    for (const fn of this.resizers) fn(width, height, pixelRatio);

    if (!this.running) this._render(); // resizing clears the canvas
  }

  setQuality(quality) {
    if (!(quality in QUALITY_LEVELS)) return;
    this.quality = quality;
    this.settings = QUALITY_LEVELS[quality];
    this.pixelScale = 1;
    this.size.pixelRatio = 0; // force re-apply
    this._resetPerfSample();
    this.resize();
  }

  async compile() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* optional optimisation; first frame will compile instead */
    }
  }

  start() {
    this.wantsRunning = true;
    if (!document.hidden) this._run();
  }

  stop() {
    this.wantsRunning = false;
    this._halt();
  }

  _run() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    this._resetPerfSample();
    this.rafId = requestAnimationFrame(this._tick);
  }

  _halt() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  _tick(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._tick);
    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), 0.1);
    this.lastTime = now;
    this.elapsed += dt;
    for (const update of this.updaters) update(dt, this.elapsed);
    this._render();
    this._trackPerformance(dt);
  }

  _resetPerfSample() {
    this.warmup = WARMUP_FRAMES;
    this.sampleFrames = 0;
    this.sampleTime = 0;
  }

  /** If average FPS stays well under target, lower the render resolution a step. */
  _trackPerformance(dt) {
    if (!this.adaptive) return;
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    this.sampleFrames++;
    this.sampleTime += dt;
    if (this.sampleFrames < SAMPLE_FRAMES) return;

    const fps = this.sampleFrames / this.sampleTime;
    this.sampleFrames = 0;
    this.sampleTime = 0;
    if (fps < this.settings.targetFps * 0.85 && this.pixelScale > MIN_PIXEL_SCALE) {
      this.pixelScale = Math.max(MIN_PIXEL_SCALE, this.pixelScale - 0.15);
      this.size.pixelRatio = 0;
      this.resize();
      this.callbacks.onPerformanceDrop?.(this.pixelScale, fps);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    this.updaters.clear();
    this.resizers.clear();
    this.renderFn = null;
    disposeObject3D(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
