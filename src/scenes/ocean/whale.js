import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { depthToY } from '@/config/zones';
import { clamp, lerp, smoothstep } from '@/utils/math';

const SWIM_DEPTH = 1790; // metres: the middle of the whale chapter's drift
const BASE_Y = depthToY(SWIM_DEPTH);
// The pass: from beyond the left edge of the frame, closest to the camera halfway, out past the right edge.
const PATH = { x0: -40, x1: 36, z: -25, closer: 10, rise: 3 };

const flat = (g) => (g.index ? g.toNonIndexed() : g);

/** A sperm whale, built from a few primitives and merged into one mesh (one draw call). Swims along +x. */
function whaleGeometry() {
  // Body: a lathe profile from the tail stock (-x) to the blunt, block-like head (+x). [along, radius]
  const profile = [
    [-5.5, 0], [-5.45, 0.12], [-5.0, 0.22], [-4.2, 0.38], [-3.2, 0.62], [-2.0, 0.9], [-0.8, 1.06],
    [0.5, 1.14], [1.8, 1.18], [3.2, 1.17], [4.4, 1.12], [5.15, 1.0], [5.45, 0.7], [5.55, 0],
  ];
  const body = new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(r, y)), 22);
  body.rotateZ(-Math.PI / 2); // lathe axis (y) -> swim axis (+x)
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const head = smoothstep(0.8, 3.6, x);
    // The head is taller than it is wide and squarer; the belly is a little flatter than the back.
    pos.setY(i, y * (1 + 0.2 * head) * (y < 0 ? 0.9 : 1));
    pos.setZ(i, pos.getZ(i) * (0.9 - 0.06 * head));
  }
  body.computeVertexNormals();

  // The narrow lower jaw under the head.
  const jaw = new THREE.CylinderGeometry(0.16, 0.1, 3.4, 8, 1);
  jaw.rotateZ(Math.PI / 2);
  jaw.translate(3.4, -1.0, 0);

  // Flukes: a broad, swept-back tail, horizontal like every whale's.
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(-0.3, 0.6, -0.9, 1.6, -1.6, 2.3);
  s.quadraticCurveTo(-1.15, 1.2, -1.5, 0.25);
  s.lineTo(-1.32, 0);
  s.lineTo(-1.5, -0.25);
  s.quadraticCurveTo(-1.15, -1.2, -1.6, -2.3);
  s.bezierCurveTo(-0.9, -1.6, -0.3, -0.6, 0, 0);
  const flukes = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false, curveSegments: 6 });
  flukes.translate(0, 0, -0.05);
  flukes.rotateX(Math.PI / 2); // into the horizontal plane
  flukes.translate(-5.25, 0, 0);

  // Small paddle-shaped flippers and a low dorsal hump.
  const fin = (side) => {
    const g = new THREE.SphereGeometry(1, 10, 6);
    g.scale(0.75, 0.07, 0.3);
    g.rotateY(side * 0.55);
    g.rotateX(side * -0.35);
    g.translate(2.3, -0.75, side * 1.05);
    return g;
  };
  const hump = new THREE.SphereGeometry(1, 10, 6);
  hump.scale(0.7, 0.28, 0.16);
  hump.translate(-2.1, 0.86, 0);

  const parts = [body, jaw, flukes, fin(1), fin(-1), hump].map((g) => {
    const f = flat(g);
    for (const name of Object.keys(f.attributes)) if (!['position', 'normal', 'uv'].includes(name)) f.deleteAttribute(name);
    f.clearGroups();
    return f;
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * The whale encounter. Its swim across the frame is tied to the scroll (`progress`, 0..1, from the story
 * timeline); the tail beat, a slow glide and a faint rim of light (so its silhouette reads against the
 * dark water) are added here. It also tells the camera where to look (`followYaw`).
 */
export function createWhale(scene) {
  const swim = { value: 0 };
  const rimColor = { value: new THREE.Color(0.09, 0.2, 0.3) };
  const material = new THREE.MeshStandardMaterial({ color: 0x5b6872, roughness: 0.78, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSwim = swim;
    shader.uniforms.uRimColor = rimColor;
    shader.vertexShader = `uniform float uSwim;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Up-and-down tail beat: nothing at the head, strongest at the flukes.
      float tail = clamp((1.5 - position.x) / 7.0, 0.0, 1.0);
      transformed.y += sin(position.x * 0.5 + uSwim) * tail * tail * 0.75;`,
    );
    shader.fragmentShader = `uniform vec3 uRimColor;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
      totalEmissiveRadiance += uRimColor * pow(rim, 2.5);`,
    );
  };
  material.customProgramCacheKey = () => 'whale';

  const mesh = new THREE.Mesh(whaleGeometry(), material);
  mesh.frustumCulled = false; // the vertex shader bends the tail outside the bounding sphere
  mesh.visible = false;
  scene.add(mesh);

  const api = { mesh, followYaw: 0 };
  let beat = 0;

  return Object.assign(api, {
    /** progress: 0..1 along the pass (scroll); meters: camera depth. */
    update(dt, t, progress, meters, camPos) {
      const p = clamp(progress, 0, 1);
      const presence = smoothstep(0, 0.12, p) * (1 - smoothstep(0.88, 1, p));
      mesh.visible = presence > 0 && meters > 1100 && meters < 2700;
      if (!mesh.visible) {
        api.followYaw = 0;
        return;
      }
      beat += dt * 1.7;
      swim.value = beat;
      rimColor.value.setRGB(0.09, 0.2, 0.3).multiplyScalar(0.6 + 0.4 * presence);

      const x = lerp(PATH.x0, PATH.x1, p) + Math.sin(t * 0.21) * 0.8;
      const z = PATH.z + PATH.closer * Math.sin(p * Math.PI);
      const y = BASE_Y + (p - 0.5) * PATH.rise + Math.sin(t * 0.17) * 0.4;
      mesh.position.set(x, y, z);
      // Face along the path; nose up a touch as it rises, a slow roll as it glides.
      const dx = PATH.x1 - PATH.x0;
      const dz = PATH.closer * Math.PI * Math.cos(p * Math.PI);
      mesh.rotation.set(Math.sin(t * 0.3) * 0.05, Math.atan2(-dz, dx), 0.05 + Math.sin(t * 0.23) * 0.03);

      // The camera turns a little to follow it (positive yaw looks left).
      const look = Math.atan2(-(x - camPos.x), -(z - camPos.z));
      api.followYaw = clamp(look, -0.7, 0.7) * 0.28 * presence;
    },
  });
}
