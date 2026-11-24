import * as THREE from 'three';
import { MAX_DEPTH, depthToY } from '@/config/zones';
import { createRng } from '@/utils/random';

const LANDMARK_COUNT = 36;

/** Seabed and placeholder landmarks (the water surface lives in createOceanSurface). Replace the landmarks with real content later. */
export function createEnvironment(scene, settings) {
  const group = new THREE.Group();
  const rng = createRng(21);

  const seg = settings.seabedSegments;
  const bedGeometry = new THREE.PlaneGeometry(400, 400, seg, seg);
  const pos = bedGeometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 0.08) * Math.cos(y * 0.07) * 3 + Math.sin(x * 0.31 + y * 0.23) * 0.4);
  }
  bedGeometry.computeVertexNormals();
  const seabed = new THREE.Mesh(
    bedGeometry,
    new THREE.MeshStandardMaterial({ color: 0x24353b, roughness: 1, flatShading: true }),
  );
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.y = depthToY(MAX_DEPTH + 200);
  group.add(seabed);

  const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x3b8796, roughness: 0.85, flatShading: true });
  const rocks = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    const side = i % 2 ? 1 : -1;
    // Kept well off the camera's path so they read as distant shapes in the haze, never as a boulder
    // hanging in front of the lens (placeholders until real landmarks exist).
    rock.position.set(
      side * (16 + rng() * 18),
      depthToY(((i + rng()) / LANDMARK_COUNT) * MAX_DEPTH),
      -(30 + rng() * 34),
    );
    rock.scale.setScalar(1.5 + rng() * 3);
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
    rocks.push(rock);
    group.add(rock);
  }

  scene.add(group);

  return {
    update(dt) {
      for (const rock of rocks) rock.rotation.y += dt * 0.05;
    },
  };
}
