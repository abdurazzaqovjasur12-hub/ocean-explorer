import * as THREE from 'three';

/**
 * Thin wrapper around THREE.LoadingManager. Not used by the foundation scene yet,
 * but it is where textures, GLTF models and audio buffers will load from, and
 * `onProgress` can feed the loading screen.
 */
export class AssetLoader {
  constructor() {
    this.progress = 0;
    this.onProgress = null;
    this.manager = new THREE.LoadingManager();
    this.manager.onProgress = (url, loaded, total) => {
      this.progress = total ? loaded / total : 1;
      this.onProgress?.(this.progress, url);
    };
    this.textureLoader = new THREE.TextureLoader(this.manager);
  }

  async loadTexture(url, { srgb = true } = {}) {
    const texture = await this.textureLoader.loadAsync(url);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
}
