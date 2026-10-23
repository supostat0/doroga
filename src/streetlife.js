// Жизнь улицы: троллейбусные провода над Невским и остановки с павильонами.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lanePoint } from './roadgraph.js';

export const WIRE_Y = 6.2;

// Пара контактных проводов над правой полосой каждой половины Невского.
export function buildTrolleyWires(graph, scene) {
  const pts = [];
  for (const e of graph.edges) {
    if (e.name !== 'Невский проспект') continue;
    for (const side of [-0.3, 0.3]) {
      let prev = null;
      for (let s = 0; s <= e.len; s += 4) {
        const p = lanePoint(e, Math.min(s, e.len), 0);
        const x = p.x + -p.dz * side, z = p.z + p.dx * side;
        if (prev) pts.push(prev[0], WIRE_Y, prev[1], x, WIRE_Y, z);
        prev = [x, z];
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4a4c58 })));
}

// Остановки: павильон со стеклом, светящейся рекламой и табличкой. Всё склеено по материалам.
export function buildStops(map, scene) {
  const stops = (map.stops ?? []).map((s) => ({ ...s, dir: toNearestRoad(s.p, map.roads) })).filter((s) => s.dir);
  if (!stops.length) return [];
  const parts = { frame: [], glass: [], ad: [], snow: [], plate: [] };
  const atlas = document.createElement('canvas');
  atlas.width = 512;
  atlas.height = 48 * stops.length;
  const ac = atlas.getContext('2d');
  const out = [];
  stops.forEach((s, i) => {
    const [dx, dz] = s.dir.d;
    // Павильон — спиной к домам, лицом к дороге, в ~2 м от проезжей части.
    const back = s.dir.dist - 2.2; // < 0 — отступаем от дороги
    const x = s.p[0] + dx * back, z = s.p[1] + dz * back;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz)), new THREE.Vector3(1, 1, 1));
    const box = (w, h, d, px, py, pz, list) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(px, py, pz);
      list.push(g.applyMatrix4(m));
    };
    // локально: +z — к дороге, x — вдоль улицы
    box(0.08, 2.4, 0.08, -1.6, 1.2, 0.6, parts.frame);
    box(0.08, 2.4, 0.08, 1.6, 1.2, 0.6, parts.frame);
    box(0.08, 2.4, 0.08, -1.6, 1.2, -0.6, parts.frame);
    box(0.08, 2.4, 0.08, 1.6, 1.2, -0.6, parts.frame);
    box(3.5, 0.1, 1.6, 0, 2.45, 0, parts.frame);
    box(3.3, 0.12, 1.4, 0, 2.56, 0, parts.snow);
    box(3.2, 0.06, 0.4, 0, 0.5, -0.35, parts.frame); // скамейка
    box(3.2, 1.9, 0.04, 0, 1.35, -0.62, parts.glass);
    box(0.05, 1.8, 1.0, 1.62, 1.3, 0, parts.ad); // реклама сбоку
    // табличка с названием над входом
    const g = new THREE.PlaneGeometry(2.4, 0.24);
    const v0 = 1 - (i + 1) / stops.length, v1 = 1 - i / stops.length;
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) > 0.5 ? v1 : v0);
    g.translate(0, 2.25, 0.82);
    parts.plate.push(g.applyMatrix4(m));
    ac.fillStyle = '#123a6b';
    ac.fillRect(0, i * 48, 512, 48);
    ac.fillStyle = '#fff';
    ac.font = '700 28px Arial, sans-serif';
    ac.textBaseline = 'middle';
    ac.fillText(s.name ?? 'Остановка', 16, i * 48 + 25, 480);
    out.push({ p: [x + dx * 0.4, z + dz * 0.4], r: 3.5, a: 0.25, yaw: Math.atan2(dx, dz) });
  });
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mats = {
    frame: new THREE.MeshLambertMaterial({ color: 0x2b2e35 }),
    glass: new THREE.MeshLambertMaterial({ color: 0x3a4a5a, emissive: 0x18222c }),
    ad: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xd8e6ff, emissiveIntensity: 0.9 }),
    snow: new THREE.MeshLambertMaterial({ color: 0xe2e6ee }),
    plate: new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.1, 1.1, 1.1) }),
  };
  for (const [k, list] of Object.entries(parts)) {
    const geos = list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      if (k !== 'plate') n.deleteAttribute('uv');
      return n;
    });
    scene.add(new THREE.Mesh(mergeGeometries(geos), mats[k]));
  }
  return out;
}

function toNearestRoad(p, roads) {
  let best = null;
  let bd = 25;
  for (const r of roads) {
    if (r.kind !== 'drive') continue;
    for (let i = 1; i < r.p.length; i++) {
      const [ax, az] = r.p[i - 1];
      const [bx, bz] = r.p[i];
      const ex = bx - ax, ez = bz - az;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - az) * ez) / (ex * ex + ez * ez || 1)));
      const qx = ax + ex * t - p[0], qz = az + ez * t - p[1];
      const d = Math.hypot(qx, qz) - r.w / 2; // до края проезжей части
      if (d < bd) {
        bd = d;
        const l = Math.hypot(qx, qz) || 1;
        best = { d: [qx / l, qz / l], dist: d };
      }
    }
  }
  return best;
}
