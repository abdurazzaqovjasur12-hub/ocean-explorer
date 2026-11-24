import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Subtle bloom for the glowing life of the deep, added on top of the finished frame.
 *
 * The scene still renders straight to the screen exactly as it always has (several of its shaders mix the
 * underwater colour in display space, after tone mapping, so rendering it into a linear target for a
 * classic post-processing chain would change its look). The finished frame is then copied into a texture;
 * its bright parts are blurred at low resolution with UnrealBloomPass's filters, and only that glow is added
 * back onto the screen. With `amount` ~0 (sunlit water, above the waves) none of this runs.
 *
 * `settings.bloom` (config/quality.js): `enabled`, `scale` (resolution of the first blur level relative to
 * the screen: lower is cheaper and softer), `strength`, `radius`, `threshold` (display brightness 0..1).
 */
export function createBloom(renderer, scene, camera, settings) {
  let cfg = settings.bloom;
  let pass = null;
  let frame = null; // the copied frame
  const size = new THREE.Vector2();
  const origin = new THREE.Vector2(0, 0);
  const oldClear = new THREE.Color();

  function dispose() {
    pass?.dispose();
    frame?.dispose();
    pass = frame = null;
  }

  function applySize() {
    if (!pass) return;
    renderer.getDrawingBufferSize(size);
    if (!frame || frame.image.width !== size.x || frame.image.height !== size.y) {
      frame?.dispose();
      frame = new THREE.FramebufferTexture(size.x, size.y);
    }
    const k = 2 * cfg.scale; // the pass halves this for its first level
    pass.setSize(Math.max(2, Math.round(size.x * k)), Math.max(2, Math.round(size.y * k)));
  }

  function build() {
    dispose();
    if (!cfg?.enabled) return;
    pass = new UnrealBloomPass(new THREE.Vector2(2, 2), cfg.strength, cfg.radius, cfg.threshold);
    applySize();
  }

  /** UnrealBloomPass.render, minus the parts that would redraw or replace the frame: only the glow is added. */
  function addGlow(strength) {
    renderer.copyFramebufferToTexture(frame, origin);
    const autoClear = renderer.autoClear;
    renderer.getClearColor(oldClear);
    const clearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);

    const q = pass.fsQuad;
    pass.highPassUniforms.tDiffuse.value = frame;
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

    q.material = pass.blendMaterial; // additive copy, no tone mapping or colour conversion
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
