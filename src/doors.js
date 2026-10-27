// Двери (каталог: door): входы из OSM (entrance=* точкой на стене дома, см. tools/elements.mjs).
// Полотно с остеклённой фрамугой, светлый наличник, над парадной — фонарик. Размер по виду входа.
// Геометрия перед стеной (стену не режем): наличник 8 см, полотно на 3 см.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { snowyMaterial } from './props.js';

export const DOOR_SIZE = { main: [1.9, 3.0], staircase: [1.3, 2.5], shop: [1.4, 2.6], service: [1.1, 2.2], home: [1.1, 2.3], yes: [1.3, 2.5] };

export function buildDoors(map, scene) {
  const wood = [], trim = [], glow = [];
  for (const d of map.doors ?? []) {
    const b = map.buildings[d.b];
    const ring = [b.o, ...b.i][d.r];
    const a = ring[d.e], c = ring[(d.e + 1) % ring.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const [w, h] = DOOR_SIZE[d.kind] ?? DOOR_SIZE.yes;
    // d.at — центр пролёта окон, куда дверь поставил buildings.js (иначе — точка из OSM).
    const du = d.at ? ((d.at[0] - a[0]) * (c[0] - a[0]) + (d.at[1] - a[1]) * (c[1] - a[1])) / L : d.u;
    // Центр пролёта уже на прямой стене (может уйти на соседнее ребро той же стены — это нормально).
    const u = d.at ? du : Math.min(L - w / 2 - 0.15, Math.max(w / 2 + 0.15, du));
    if (!d.at && L < w + 0.3) continue;
    const dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L, nx = dz, nz = -dx; // наружу, как у стен
    // Правая тройка: x — от c к a, y — вверх, z — наружу (см. docs/LESSONS.md).
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(-dx, 0, -dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(c[0], b.mh || 0, c[1]);
    const x = L - u;
    const put = (list, g) => list.push(g.toNonIndexed().applyMatrix4(M));
    put(wood, new THREE.BoxGeometry(w, h * 0.78, 0.06).translate(x, h * 0.39, 0.03)); // полотно
    put(glow, new THREE.BoxGeometry(w - 0.1, h * 0.2, 0.05).translate(x, h * 0.88, 0.03)); // фрамуга
    put(trim, new THREE.BoxGeometry(w + 0.3, 0.16, 0.1).translate(x, h + 0.08, 0.05)); // наличник: верх
    for (const s of [-1, 1]) put(trim, new THREE.BoxGeometry(0.15, h, 0.1).translate(x + s * (w / 2 + 0.07), h / 2, 0.05));
    if (d.kind === 'staircase' || d.kind === 'main') put(glow, new THREE.BoxGeometry(0.18, 0.22, 0.12).translate(x, h + 0.45, 0.12)); // фонарик
  }
  const add = (list, mat) => list.length && scene.add(new THREE.Mesh(mergeGeometries(list.map(strip)), mat));
  add(wood, snowyMaterial(0x3b2a1f, 0.2));
  add(trim, snowyMaterial(0xd8d2c4, 0.5));
  add(glow, new THREE.MeshBasicMaterial({ color: 0xffc98a }));
}

function strip(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}
