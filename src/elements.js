// Ручные элементы каталога из map.elements (data/elements.json):
// ризалит — на его фасаде (дом с фасадом civic, шаг окон 3 м) белые пилястры на двух верхних этажах
// между окнами и треугольный фронтон над карнизом; скульптуры моста — грифоны по концам моста
// с тросами и фонарями. Ограду с колоннадой строит details.js. Возвращает препятствия.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { snowyMaterial } from './props.js';

const STEP = 3; // шаг окон фасада civic (см. шейдер в buildings.js)
const FLOOR = 3.8;

export function buildElements(map, scene) {
  const colliders = [];
  for (const el of map.elements ?? []) if (el.type === 'bridge_statues') colliders.push(...bridgeStatues(map, el, scene));
  const white = [];
  for (const el of map.elements ?? []) {
    if (el.type !== 'risalit') continue;
    const b = map.buildings[el.b];
    // Перед ризалита — ребро, ближайшее к точке «at + out к face».
    const L0 = Math.hypot(el.face[0] - el.at[0], el.face[1] - el.at[1]);
    const front = [el.at[0] + ((el.face[0] - el.at[0]) / L0) * el.out, el.at[1] + ((el.face[1] - el.at[1]) / L0) * el.out];
    let best = 0, bd = Infinity;
    b.o.forEach((a, i) => {
      const c = b.o[(i + 1) % b.o.length];
      const d = Math.hypot((a[0] + c[0]) / 2 - front[0], (a[1] + c[1]) / 2 - front[1]);
      if (d < bd) { bd = d; best = i; }
    });
    const a = b.o[best], c = b.o[(best + 1) % b.o.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L, nx = dz, nz = -dx; // наружу, как у стен
    // Локальные оси (правая тройка): x — вдоль фасада от c к a, y — вверх, z — наружу.
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(-dx, 0, -dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(c[0], 0, c[1]);
    const top = b.h - 1.1; // низ карниза
    const put = (g) => white.push(g.applyMatrix4(M));
    // Пилястры — на границах окон: окна раскладываются по прямой стене от её начала (перед ризалита —
    // отдельная стена, углы 90°), шаг ровно STEP, потому что ширина ризалита кратна ему.
    for (let x = 0; x < L + 1e-6; x += L / Math.max(1, Math.round(L / STEP))) {
      const xc = L - Math.min(L - 0.45, Math.max(0.45, x)); // x — от a, в локальных осях — от c
      put(new THREE.BoxGeometry(0.75, top - FLOOR, 0.28).translate(xc, (FLOOR + top) / 2, 0.14));
      put(new THREE.BoxGeometry(0.95, 0.35, 0.4).translate(xc, FLOOR + 0.17, 0.2));
      put(new THREE.BoxGeometry(1.0, 0.45, 0.45).translate(xc, top - 0.22, 0.22));
    }
    // Фронтон: тимпан чуть впереди стены, наклонные карнизы выступают; основание — на карнизе.
    const y0 = b.h - 0.3, half = L / 2 + 0.2, rise = el.rise ?? 3;
    const tri = new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, rise)]);
    put(new THREE.ExtrudeGeometry(tri, { depth: 2.6, bevelEnabled: false }).translate(L / 2, y0, -2.5));
    const slope = Math.atan2(rise, half), rl = Math.hypot(half + 0.4, rise + 0.25);
    for (const s of [-1, 1]) {
      put(new THREE.BoxGeometry(rl, 0.4, 0.6).rotateZ(-s * slope).translate(L / 2 + (s * (half + 0.4)) / 2, y0 + rise / 2 + 0.1, 0.25));
    }
    put(new THREE.BoxGeometry(2 * half + 0.6, 0.35, 0.6).translate(L / 2, y0 + 0.1, 0.25)); // горизонтальный карниз фронтона
  }
  if (white.length) {
    const g = mergeGeometries(white.map((x) => (x.index ? x.toNonIndexed() : x)).map(stripUv));
    scene.add(new THREE.Mesh(g, snowyMaterial(0xe4e0d6, 0.35)));
  }
  return colliders;
}

// Скульптуры по концам моста (сейчас — грифоны): по две на каждом конце, по бокам дорожки, лицом
// к мосту, на гранитной площадке у начала пролёта. Начало пролёта — где ось моста пересекает край
// воды (у линии моста в OSM бывают подходы, заходящие на проезжую часть набережной).
function bridgeStatues(map, el, scene) {
  const roads = map.roads.filter((r) => r.bridge && r.name === el.bridge);
  const pts = roads.flatMap((r) => r.p);
  if (pts.length < 2) return [];
  const heads = [];
  for (const r of roads) for (let k = 1; k < r.p.length; k++) for (const w of map.water) {
    for (let i = 0; i < w.o.length; i++) {
      const t = crossAt(r.p[k - 1], r.p[k], w.o[i], w.o[(i + 1) % w.o.length]);
      if (t !== null) heads.push([r.p[k - 1][0] + (r.p[k][0] - r.p[k - 1][0]) * t, r.p[k - 1][1] + (r.p[k][1] - r.p[k - 1][1]) * t]);
    }
  }
  const far = (list) => {
    let A = list[0], B = list[1], bd = 0;
    for (const p of list) for (const q of list) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d > bd) { bd = d; A = p; B = q; } }
    return [A, B, bd];
  };
  let [A, B, L] = far(heads.length >= 2 ? heads : pts);
  const d = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], side = [-d[1], d[0]];
  // Сидят на берегу: в 1.4 м от края воды.
  A = [A[0] - d[0] * 1.4, A[1] - d[1] * 1.4];
  B = [B[0] + d[0] * 1.4, B[1] + d[1] * 1.4];
  const half = (roads[0].w + 1) / 2 + 0.7; // настил моста (как в ground.js) + запас до постамента
  const iron = [], gold = [], granite = [], lamp = [];
  // Гранитная площадка у начала пролёта — тротуар с бордюром под грифонами.
  for (const [end, fwd] of [[A, d], [B, [-d[0], -d[1]]]]) {
    const M = new THREE.Matrix4().compose(new THREE.Vector3(end[0], 0, end[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fwd[0], fwd[1])), new THREE.Vector3(1, 1, 1));
    granite.push(stripUv(new THREE.BoxGeometry(2 * half + 2.2, 0.2, 3.4).translate(0, 0.1, 0.3).toNonIndexed()).applyMatrix4(M));
  }
  const mouths = [];
  const colliders = [];
  for (const [end, fwd] of [[A, d], [B, [-d[0], -d[1]]]]) {
    for (const s of [-1, 1]) {
      const x = end[0] + side[0] * half * s, z = end[1] + side[1] * half * s;
      const M = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fwd[0], fwd[1])), new THREE.Vector3(1, 1, 1));
      const put = (list, g) => list.push(stripUv(g.toNonIndexed()).applyMatrix4(M));
      // Локально: +z — к мосту, y — вверх. Постамент, на нём сидящий грифон.
      put(granite, new THREE.BoxGeometry(1.4, 1.5, 2.2).translate(0, 0.95, 0)); // постамент на площадке
      const y = 1.7;
      put(iron, new THREE.BoxGeometry(0.8, 0.6, 1.1).translate(0, y + 0.3, -0.15)); // задние лапы
      put(iron, new THREE.BoxGeometry(0.6, 1.0, 0.55).rotateX(-0.25).translate(0, y + 0.85, 0.25)); // грудь
      for (const lx of [-0.18, 0.18]) put(iron, new THREE.BoxGeometry(0.16, 0.8, 0.18).translate(lx, y + 0.4, 0.5)); // передние лапы
      put(iron, new THREE.BoxGeometry(0.38, 0.38, 0.5).translate(0, y + 1.5, 0.45)); // голова
      put(iron, new THREE.BoxGeometry(0.06, 0.06, 0.9).rotateX(0.6).translate(0, y + 0.5, -0.75)); // хвост
      for (const wx of [-1, 1]) {
        put(gold, new THREE.BoxGeometry(0.06, 1.3, 0.8).rotateZ(wx * 0.35).rotateX(-0.2).translate(wx * 0.45, y + 1.35, -0.1)); // крылья
      }
      if (el.lamps) {
        put(gold, new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6).translate(0, y + 1.95, 0.4));
        put(lamp, new THREE.SphereGeometry(0.26, 12, 8).translate(0, y + 2.5, 0.4));
      }
      mouths.push({ p: new THREE.Vector3(0, y + 1.45, 0.72).applyMatrix4(M), s, end });
      const c = [[-0.65, -0.85], [-0.65, 0.85], [0.65, 0.85], [0.65, -0.85], [-0.65, -0.85]].map(([lx, lz]) => {
        const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(M);
        return [v.x, v.z];
      });
      for (let k = 0; k < 4; k++) colliders.push([...c[k], ...c[k + 1], 1]);
    }
  }
  const mesh = (list, mat) => list.length && scene.add(new THREE.Mesh(mergeGeometries(list), mat));
  mesh(granite, snowyMaterial(0x5e575a, 0.55));
  mesh(iron, snowyMaterial(0x2b2a27, 0.4));
  mesh(gold, new THREE.MeshLambertMaterial({ color: 0xd2a640, emissive: 0x6a4a12 }));
  mesh(lamp, new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  // Тросы висячего моста: из пасти грифона на одном конце к пасти на другом, с провисом к середине.
  const line = [];
  for (const s of [-1, 1]) {
    const [p, q] = mouths.filter((m) => m.s === s).map((m) => m.p);
    for (let k = 0; k < 16; k++) {
      const t0 = k / 16, t1 = (k + 1) / 16;
      const at = (t) => p.clone().lerp(q, t).setY(p.y + (q.y - p.y) * t - 1.6 * 4 * t * (1 - t));
      line.push(...at(t0).toArray(), ...at(t1).toArray());
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1c1c20 })));
  return colliders;
}

// У Extrude и Box разные наборы атрибутов — для склейки оставляем только положение и нормаль.
function stripUv(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}

// Где отрезок cd пересекает ab: доля пути по ab (null — не пересекает).
function crossAt(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
