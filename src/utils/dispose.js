const TEXTURE_KEYS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
  'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap',
];

export function disposeMaterial(material) {
  for (const key of TEXTURE_KEYS) material[key]?.dispose?.();
  material.dispose();
}

/** Frees GPU memory for everything under `root`, then empties it. */
export function disposeObject3D(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    obj.shadow?.map?.dispose?.();
    if (obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(disposeMaterial);
    }
  });
  root.clear();
}
