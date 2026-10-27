// Деревья, фонари, ограды набережных и мостов. Всё через InstancedMesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from './shaders.js';
import { rng } from './geom.js';
import { addChunked } from './chunks.js';

const SNOWY = {
  vertexHeader: 'varying vec3 vWN;',
  vertexMain: `
    vec3 wn = objectNormal;
    #ifdef USE_INSTANCING
    wn = mat3(instanceMatrix) * wn;
    #endif
    vWN = normalize(mat3(modelMatrix) * wn);`,
  header: 'varying vec3 vWN;',
};

// Материал «тёмный металл/кора со снегом сверху».
export function snowyMaterial(base, amount = 0.45) {
  return patchMaterial(new THREE.MeshLambertMaterial({ color: base }), {
    ...SNOWY,
    colorCode: `
      float up = vWN.y + (vnoise(vWorld.xz * 6.0 + vWorld.y * 4.0) - 0.5) * 0.5;
      col = mix(diffuse, vec3(0.9, 0.91, 0.95), smoothstep(${(1 - amount).toFixed(2)}, ${(1.1 - amount).toFixed(2)} + 0.15, up));
    `,
  });
}

export function buildProps(map, ground, scene) {
  buildTrees(map.trees, scene);
  buildLamps(map.lamps, scene);
  buildFences(ground, scene);
}

// --- деревья ---

function treeGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  const branch = (start, dir, length, radius, depth) => {
    const end = start.clone().addScaledVector(dir, length);
    // Тонкие ветки — трёхгранные: в пикселях разницы не видно, а треугольников втрое меньше.
    const g = new THREE.CylinderGeometry(radius * 0.7, radius, length, depth > 2 ? 5 : 3, 1, true);
    g.translate(0, length / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(start.x, start.y, start.z);
    parts.push(g);
    if (depth === 0) return;
    const n = depth > 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const t = 0.55 + r() * 0.4;
      const from = start.clone().addScaledVector(dir, length * t);
      const nd = dir.clone()
        .add(new THREE.Vector3((r() - 0.5) * 1.6, 0.35 + r() * 0.5, (r() - 0.5) * 1.6))
        .normalize();
      branch(from, nd, length * (0.55 + r() * 0.2), radius * 0.6, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 3.4, 0.2, 4);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

function buildTrees(points, scene) {
  if (!points.length) return;
  const variants = [11, 23, 37].map(treeGeometry);
  const mat = snowyMaterial(0x3a3433, 0.5);
  const r = rng(77);
  const buckets = variants.map(() => []);
  for (const p of points) buckets[Math.floor(r() * variants.length)].push(p);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  buckets.forEach((pts, vi) => {
    const items = pts.map((p) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
      const s = 0.85 + r() * 0.5;
      return { x: p[0], z: p[1], matrix: m.compose(new THREE.Vector3(p[0], 0, p[1]), q, new THREE.Vector3(s, s, s)).clone() };
    });
    addChunked(scene, variants[vi], mat, items);
  });
}

// --- фонари ---

function buildLamps(points, scene) {
  if (!points.length) return;
  const pole = new THREE.CylinderGeometry(0.06, 0.11, 6.5, 6);
  pole.translate(0, 3.25, 0);
  const arm = new THREE.BoxGeometry(0.06, 0.06, 1.3);
  arm.translate(0, 6.4, 0.6);
  const body = mergeGeometries([pole, arm].map((g) => g.toNonIndexed()));
  const head = new THREE.CylinderGeometry(0.14, 0.24, 0.42, 8);
  head.translate(0, 6.15, 1.2);
  const metal = snowyMaterial(0x24262b, 0.35);
  const glow = new THREE.MeshLambertMaterial({ color: 0xfff1d6, emissive: 0xffc77a, emissiveIntensity: 3.5 });
  const q = new THREE.Quaternion();
  const items = points.map((p) => {
    // Кронштейн — в сторону проезжей части (направление посчитано в street.js).
    const [, , dx = 1, dz = 0] = p;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz));
    return { x: p[0], z: p[1], matrix: new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, p[1]), q, new THREE.Vector3(1, 1, 1)) };
  });
  addChunked(scene, body, metal, items);
  // Пара процентов фонарей барахлит и моргает — у них свой материал.
  const r = rng(13);
  const broken = items.filter(() => r() < 0.04);
  addChunked(scene, head, glow, items.filter((it) => !broken.includes(it)));
  if (broken.length) addChunked(scene, head, FLICKER.mat, broken);
}

// Моргающие фонари: в основном горят, но время от времени — серия быстрых миганий.
export const FLICKER = {
  mat: new THREE.MeshLambertMaterial({ color: 0xfff1d6, emissive: 0xffc77a, emissiveIntensity: 3.5 }),
  update(t) {
    const burst = (t % 9.7) < 1.6;
    const flick = Math.sin(Math.floor(t * 14) * 12.9898) * 43758.5453;
    this.mat.emissiveIntensity = burst && flick - Math.floor(flick) < 0.55 ? 0.15 : 3.5;
  },
};

// --- ограды: чугунная решётка на гранитном парапете ---

function buildFences(ground, scene) {
  const segs = [...ground.embankment, ...ground.bridgeEdges];
  if (!segs.length) return;
  const posts = [];
  for (const [ax, az, bx, bz] of segs) {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / 0.35));
    for (let k = 0; k < n; k++) posts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, Math.atan2(bx - ax, bz - az)]);
  }
  const iron = snowyMaterial(0x1f2024, 0.3);
  const granite = snowyMaterial(0x6e6466, 0.55);
  const postGeo = new THREE.BoxGeometry(0.035, 0.9, 0.035);
  postGeo.translate(0, 0.75, 0);
  const railGeo = new THREE.BoxGeometry(0.07, 0.06, 1);
  railGeo.translate(0, 1.22, 0);
  const curbGeo = new THREE.BoxGeometry(0.45, 0.3, 1);
  curbGeo.translate(0, 0.15, 0);

  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  addChunked(scene, postGeo, iron, posts.map(([x, z, yaw]) => {
    q.setFromAxisAngle(up, yaw);
    return { x, z, matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1)) };
  }));
  const segItems = segs.map(([ax, az, bx, bz]) => {
    const L = Math.hypot(bx - ax, bz - az);
    q.setFromAxisAngle(up, Math.atan2(bx - ax, bz - az));
    const x = (ax + bx) / 2, z = (az + bz) / 2;
    return { x, z, matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, L + 0.05)) };
  });
  addChunked(scene, railGeo, iron, segItems);
  addChunked(scene, curbGeo, granite, segItems);
}
