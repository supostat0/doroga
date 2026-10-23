// Знаки ПДД. Явных тегов traffic_sign в OSM этого района нет, поэтому знаки выводятся из данных:
// размеченный переход → «Пешеходный переход» (с обеих сторон), highway=give_way → «Уступи дорогу»,
// конец односторонки на перекрёстке → «Въезд запрещён», начало → «Одностороннее движение».
// Знак стоит справа у бордюра лицом к подъезжающим. Все знаки — 2 вызова отрисовки.

import * as THREE from 'three';
import { sampleAt } from './geom.js';
import { addChunked } from './chunks.js';

const TYPES = ['crossing', 'giveway', 'noentry', 'oneway'];

export function buildRoadSigns(map, graph, roadAt, scene) {
  const out = [];
  const giveway = new Set(map.giveway ?? []);
  const crossingNodes = new Map(map.crossings.map((c) => [c.id, c]));
  const nameAt = new Map(); // узел → имена улиц, проходящих через него
  for (const e of graph.edges) for (const id of [e.from, e.to]) {
    if (!nameAt.has(id)) nameAt.set(id, new Set());
    nameAt.get(id).add(e.name);
  }

  // Точка у бордюра справа на ребре e за d метров до конца (или от начала, fromStart).
  const place = (e, d, type, fromStart = false) => {
    for (let back = d; back < d + 15; back += 1) {
      const s = fromStart ? Math.min(e.len, back) : Math.max(0, e.len - back);
      const p = sampleAt(e.pts, e.cum, s);
      const l = Math.hypot(p.dx, p.dz) || 1;
      const dx = p.dx / l, dz = p.dz / l;
      const x = p.x + -dz * (e.w / 2 + 0.7), z = p.z + dx * (e.w / 2 + 0.7);
      if (roadAt(x, z) > 0.3) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 2.5)) return;
      out.push({ x, z, yaw: Math.atan2(-dx, -dz), type });
      return;
    }
  };

  for (const e of graph.edges) {
    // Переход на ребре — знак перед ним справа (для каждого направления — своё ребро).
    e.pts.forEach((_, i) => {
      const c = crossingNodes.get(nodeIdAt(e, i));
      if (!c || c.signal) return;
      place({ ...e, len: e.cum[i] }, 2, 'crossing');
    });
    if (giveway.has(e.to)) place(e, 4, 'giveway');
    if (e.oneway && e.hw !== 'primary' && e.len > 15) {
      const atJunction = (id) => (nameAt.get(id)?.size ?? 0) > 1;
      if (atJunction(e.from)) place(e, 3, 'oneway', true);
      // «Въезд запрещён» — для тех, кто подъехал к концу односторонки с перекрёстка.
      if (atJunction(e.to)) {
        const rev = { ...e, pts: e.pts.slice().reverse() };
        rev.cum = rev.pts.map((_, i) => e.len - e.cum[e.pts.length - 1 - i]);
        place(rev, 3, 'noentry', true);
      }
    }
  }

  const tex = new THREE.CanvasTexture(drawSigns());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const pole = new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6).translate(0, 1.3, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x8a8e96 });
  const items = (list) => list.map((s) => ({
    x: s.x, z: s.z,
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(1, 1, 1)),
  }));
  addChunked(scene, pole, poleMat, items(out));
  // Лицо знака: свой кусок атласа для каждого типа. Чуть светится — как световозвращающая плёнка.
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, color: new THREE.Color(0.85, 0.85, 0.85) });
  // Обратная сторона — серый металл той же формы (альфа из того же атласа).
  const backMat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, color: 0x000000, emissive: 0x4a4d54 });
  TYPES.forEach((type, ti) => {
    const g = new THREE.PlaneGeometry(0.7, 0.7);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (ti + uv.getX(k)) / TYPES.length);
    g.translate(0, 2.35, 0.06);
    const list = items(out.filter((s) => s.type === type));
    addChunked(scene, g, faceMat, list);
    const back = g.clone().translate(0, 0, -0.06).rotateY(Math.PI).translate(0, 0, 0.04);
    addChunked(scene, back, backMat, list);
  });
  return out;
}

function nodeIdAt(e, i) {
  return e.ids?.[i];
}

function drawSigns() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S * TYPES.length;
  cv.height = S;
  const c = cv.getContext('2d');
  // Пешеходный переход: синий квадрат, белый треугольник, человечек.
  c.fillStyle = '#1e5fb4';
  c.fillRect(2, 2, 60, 60);
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(32, 8); c.lineTo(58, 56); c.lineTo(6, 56);
  c.fill();
  c.fillStyle = '#111';
  c.fillRect(30, 22, 5, 5);
  c.fillRect(28, 28, 8, 12);
  c.fillRect(24, 40, 5, 10);
  c.fillRect(35, 40, 5, 10);
  for (let x = 14; x < 52; x += 8) c.fillRect(x, 51, 5, 3);
  // Уступи дорогу: перевёрнутый белый треугольник с красной каймой.
  const o = S;
  c.fillStyle = '#d0202a';
  c.beginPath();
  c.moveTo(o + 2, 6); c.lineTo(o + 62, 6); c.lineTo(o + 32, 60);
  c.fill();
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(o + 13, 12); c.lineTo(o + 51, 12); c.lineTo(o + 32, 47);
  c.fill();
  // Въезд запрещён: красный круг с белой полосой («кирпич»).
  const o2 = S * 2;
  c.fillStyle = '#d0202a';
  c.beginPath();
  c.arc(o2 + 32, 32, 29, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.fillRect(o2 + 10, 27, 44, 10);
  // Одностороннее движение: синий прямоугольник с белой стрелкой вверх.
  const o3 = S * 3;
  c.fillStyle = '#1e5fb4';
  c.fillRect(o3 + 10, 2, 44, 60);
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(o3 + 32, 8); c.lineTo(o3 + 46, 26); c.lineTo(o3 + 18, 26);
  c.fill();
  c.fillRect(o3 + 27, 24, 10, 32);
  return cv;
}
