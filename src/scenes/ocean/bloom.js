import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Objects that glow (bioluminescence, jellyfish, the whale's wake, the vents) are also put on this layer. */
export const GLOW_LAYER = 1;

/**
 * Subtle, selective bloom for the glowing life of the deep, added on top of the finished frame.
 *
 * The scene still renders straight to the screen exactly as it always has (several of its shaders mix the
 * underwater colour in display space, after tone mapping, so a classic post-processing chain that renders the
 * scene into a linear target would change its look). For the glow, only the objects on GLOW_LAYER are
 * rendered again, at low resolution, into an off-screen target: no background, and no scene lights (lights
 * live on layer 0), so lit materials contribute only what they emit. Their bright parts are blurred with
 * UnrealBloomPass's filters and that glow alone is added onto the screen.
 *
 * Nothing is read back from the screen: an earlier version copied the frame from the default framebuffer,
 * which with MSAA (the high tier) sometimes presented an empty frame on some drivers.
 *
 * With `amount` ~0 (sunlit water, above the waves) none of this runs.
 * `settings.bloom` (config/quality.js): `enabled`, `scale` (resolution of the glow render relative to the
 * screen: lower is cheaper and softer), `strength`, `radius`, `threshold` (linear brightness).
 */
export function createBloom(renderer, scene, camera, settings) {
  let cfg = settings.bloom;
  let pass = null;
  let glowTarget = null;
  const size = new THREE.Vector2();
  const oldClear = new THREE.Color();

  function dispose() {
    pass?.dispose();
    glowTarget?.dispose();
    pass = glowTarget = null;
  }

  function applySize() {
    if (!pass) return;
    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, Math.round(size.x * cfg.scale));
    const h = Math.max(2, Math.round(size.y * cfg.scale));
    glowTarget.setSize(w, h);
    pass.setSize(w * 2, h * 2); // the pass works at half of what it is given: its first level matches the glow render
  }

  function build() {
    dispose();
    if (!cfg?.enabled) return;
    glowTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    pass = new UnrealBloomPass(new THREE.Vector2(2, 2), cfg.strength, cfg.radius, cfg.threshold);
    applySize();
  }

  function addGlow(strength) {
    const autoClear = renderer.autoClear;
    renderer.getClearColor(oldClear);
    const clearAlpha = renderer.getClearAlpha();
    const background = scene.background;
    const mask = camera.layers.mask;

    // 1. The glowing objects alone, at low resolution, on black.
    scene.background = null;
    camera.layers.set(GLOW_LAYER);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.setRenderTarget(glowTarget);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    scene.background = background;
    renderer.autoClear = false;

    // 2. Bright parts, blurred over five levels (UnrealBloomPass's filters).
    const q = pass.fsQuad;
    pass.highPassUniforms.tDiffuse.value = glowTarget.texture;
    pass.highPassUniforms.luminosityThreshold.value = cfg.threshold;
    q.material = pass.materialHighPassFilter;
    renderer.setRenderTarget(pass.renderTargetBright);
    renderer.clear();
    q.render(renderer);

    let input = pass.renderTargetBright;
    for (let i = 0; i < pass.nMips; i++) {
      const blur = pass.separableBlurMaterials[i];
      q.material = blur;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(pass.renderTargetsHorizontal[i]);
      renderer.clear();
      q.render(renderer);
      blur.uniforms.colorTexture.value = pass.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(pass.renderTargetsVertical[i]);
      renderer.clear();
      q.render(renderer);
      input = pass.renderTargetsVertical[i];
    }

    q.material = pass.compositeMaterial;
    pass.compositeMaterial.uniforms.bloomStrength.value = strength;
    pass.compositeMaterial.uniforms.bloomRadius.value = cfg.radius;
    renderer.setRenderTarget(pass.renderTargetsHorizontal[0]);
    renderer.clear();
    q.render(renderer);

    // 3. Only the glow, added onto the frame already on screen (no tone mapping or colour conversion).
    q.material = pass.blendMaterial;
    pass.copyUniforms.tDiffuse.value = pass.renderTargetsHorizontal[0].texture;
    renderer.setRenderTarget(null);
    q.render(renderer);

    renderer.setClearColor(oldClear, clearAlpha);
    renderer.autoClear = autoClear;
  }

  build();

  return {
    /** Render a frame. `amount` 0..1 scales the tier's bloom strength. */
    render(amount) {
      renderer.render(scene, camera);
      if (pass && amount >= 0.01) addGlow(cfg.strength * amount);
    },
    /** Compile the bloom shaders up front (during loading) instead of on the first deep frame. */
    warm() {
      if (!pass) return;
      renderer.render(scene, camera);
      addGlow(0);
    },
    setSize() {
      applySize();
    },
    setQuality(next) {
      cfg = next.bloom;
      build();
    },
    dispose,
  };
}
