// Повторяющиеся объекты (деревья, ограды, сугробы, фонари) режем на квадраты по 80 м:
// каждый квадрат — свой InstancedMesh с границами, поэтому three.js не рисует то, что вне кадра,
// а cullFar() прячет квадраты дальше тумана. Картинка та же, видеокарте — втрое легче.

import * as THREE from 'three';

const CELL = 80;
const FAR = 160; // дальше — туман всё равно съедает
const all = [];

// items: [{ x, z, matrix }] — matrix уже с позицией.
export function addChunked(scene, geometry, material, items) {
  const cells = new Map();
  for (const it of items) {
    const k = Math.floor(it.x / CELL) * 100003 + Math.floor(it.z / CELL);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(it);
  }
  for (const list of cells.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    let cx = 0, cz = 0;
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
      cx += it.x;
      cz += it.z;
    });
    mesh.computeBoundingSphere();
    mesh.userData.center = [cx / list.length, cz / list.length];
    scene.add(mesh);
    all.push(mesh);
  }
}

export function cullFar(camera) {
  const { x, z } = camera.position;
  for (const m of all) {
    const [cx, cz] = m.userData.center;
    m.visible = Math.hypot(cx - x, cz - z) < FAR + CELL * 0.75;
  }
}
