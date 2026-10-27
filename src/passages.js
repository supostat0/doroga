// Арки-проезды (каталог: arch_passage): за вырезом в стене (см. buildings.js) — тёмный свод вглубь
// дома. Сквозная арка (open: во двор этого дома, см. tools/elements.mjs) — свод на всю толщину, двор
// виден насквозь; у её пары со стороны двора своего свода нет (vault: 0). Глухая — до 3 м, в глубине
// светлее. Ворота (gate) — решётка в проёме. Пол — земля под домом. Всё одной сеткой.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEPTH_MAX = 3;

// Возвращает препятствия для пешехода: стенки свода и торец тупика (машина сюда не проедет —
// проём арки для неё закрыт, см. buildings.js).
export function buildPassages(map, scene) {
  const colliders = [];
  const pos = [], col = [];
  const gates = [];
  for (const q of map.passages ?? []) {
    if (q.vault === 0) continue;
    const b = map.buildings[q.b];
    const ring = [b.o, ...b.i][q.r];
    const a = ring[q.e], c = ring[(q.e + 1) % ring.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const d = [(c[0] - a[0]) / L, (c[1] - a[1]) / L], n = [d[1], -d[0]]; // n — наружу, как у стен
    const base = b.mh || 0, r = q.w / 2, spring = base + q.h - r;
    // Профиль арки (вдоль стены от центра, высота): левая пята → свод → правая пята.
    const prof = [[-r, base], [-r, spring]];
    for (let k = 1; k < 10; k++) {
      const ang = Math.PI - (k / 10) * Math.PI;
      prof.push([r * Math.cos(ang), spring + r * Math.sin(ang)]);
    }
    prof.push([r, spring], [r, base]);
    const P = [a[0] + d[0] * q.u, a[1] + d[1] * q.u];
    // Глубина — не дальше противоположной стены (тонкий дом: проём не вылезает во двор).
    let DEPTH = q.open ? q.depth : DEPTH_MAX;
    for (const rg of q.open ? [] : [b.o, ...b.i]) {
      for (let k = 0; k < rg.length; k++) {
        const t = rayHit(P, [-n[0], -n[1]], rg[k], rg[(k + 1) % rg.length]);
        if (t > 0.05 && t - 0.15 < DEPTH) DEPTH = Math.max(0.3, t - 0.15);
      }
    }
    const at = (x, y, z) => [P[0] + d[0] * x + n[0] * z, y, P[1] + d[1] * x + n[1] * z];
    const tri = (v, color) => { for (let k = 0; k < 3; k++) { pos.push(...v[k]); col.push(...color(v[k][1])); } };
    // Стены и свод: от выреза (z = 0) внутрь (z = −DEPTH), лицом к оси арки.
    // Цвета вершин — линейные (на экране светлее: 0.16 выходит бежевым) — свод почти чёрный,
    // у пола тёплый отсвет.
    const side = (y) => { const t = Math.min(1, (y - base) / 1.6); return [0.05 - 0.04 * t, 0.038 - 0.03 * t, 0.028 - 0.022 * t]; };
    for (let k = 1; k < prof.length; k++) {
      const [x0, y0] = prof[k - 1], [x1, y1] = prof[k];
      const p00 = at(x0, y0, 0), p10 = at(x1, y1, 0), p01 = at(x0, y0, -DEPTH), p11 = at(x1, y1, -DEPTH);
      tri([p00, p11, p10], side); // материал двусторонний — порядок вершин не важен
      tri([p00, p01, p11], side);
    }
    // Глухая — дальний торец светлее (там двор); сквозная — открыта.
    const far = (y) => (y - base < 0.5 ? [0.06, 0.045, 0.03] : [0.012, 0.011, 0.012]);
    const c0 = at(0, base, -DEPTH);
    for (const s of [-r, r]) colliders.push([...xz(at(s, base, 0)), ...xz(at(s, base, -DEPTH)), 1]);
    if (!q.open) colliders.push([...xz(at(-r, base, -DEPTH)), ...xz(at(r, base, -DEPTH)), 1]);
    if (!q.open) for (let k = 1; k < prof.length; k++) tri([c0, at(...prof[k], -DEPTH), at(...prof[k - 1], -DEPTH)], far);
    // Ворота — в 0.6 м от улицы, по форме арки.
    if (q.gate) {
      const s = new THREE.Shape(prof.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ShapeGeometry(s, 1);
      const P2 = g.attributes.position, uv = g.attributes.uv;
      for (let k = 0; k < P2.count; k++) {
        const [x, y] = [P2.getX(k), P2.getY(k)];
        uv.setXY(k, (x + r) / 0.15, (y - base) / q.h); // прут через 15 см
        P2.setXYZ(k, ...at(x, y, -0.6));
      }
      g.computeVertexNormals();
      gates.push(g);
    }
  }
  if (gates.length) scene.add(new THREE.Mesh(mergeGeometries(gates), new THREE.MeshLambertMaterial({ color: 0x24252a, map: barsTexture(), alphaTest: 0.5, side: THREE.DoubleSide })));
  if (!pos.length) return colliders;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  return colliders;
}

// Расстояние по лучу p + dir·t до отрезка ab (null — мимо).
function rayHit(p, dir, a, b) {
  const sx = b[0] - a[0], sz = b[1] - a[1];
  const den = dir[0] * sz - dir[1] * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / den;
  const s = ((a[0] - p[0]) * dir[1] - (a[1] - p[1]) * dir[0]) / den;
  return s >= 0 && s <= 1 ? t : null;
}

// Решётка ворот: прутья через 15 см, две перекладины.
function barsTexture() {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(2, 0, 3, 64);
  c.fillRect(0, 8, 16, 3);
  c.fillRect(0, 50, 16, 3);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

const xz = (p) => [p[0], p[2]];
