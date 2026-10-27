// Мелочи окружения из OSM: заборы (чугунная решётка), стены, живые изгороди, гранитный бортик
// газонов, скамейки и урны. Повторяющееся — InstancedMesh по квадратам (chunks.js); решётка — одна
// плоскость с прозрачной текстурой на пролёт, а не тысячи прутьев. Возвращает отрезки-препятствия.

import * as THREE from 'three';
import { addChunked } from './chunks.js';
import { snowyMaterial } from './props.js';
import { distToSegment, rng } from './geom.js';

export function buildDetails(map, scene) {
  const [x0, z0, x1, z1] = map.ext;
  const inside = (p) => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1;
  const roadSegs = [];
  for (const r of map.roads) {
    if (r.kind === 'foot') continue;
    for (let i = 1; i < r.p.length; i++) roadSegs.push([...r.p[i - 1], ...r.p[i], r.w / 2]);
  }
  // Где проезд пересекает забор — ворота. В решётке и сетке — проём шириной с дорогу,
  // глухая ограда (стена, аркада, бетон, изгородь) идёт сплошной: ворота в ней закрыты.
  const gaps = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), out = [];
    for (const [ax, az, bx, bz, hw] of roadSegs) {
      const t = crossAt(a, b, [ax, az], [bx, bz]);
      if (t !== null) out.push([t * L - Math.max(hw, 1.75), t * L + Math.max(hw, 1.75)]);
    }
    return out.sort((p, q) => p[0] - q[0]);
  };

  const colliders = [];
  const colonnades = (map.elements ?? []).filter((e) => e.type === 'fence_colonnade');
  // Участок ограды, занятый колоннадой (точки ближе w/2 к её центру): [от, до] вдоль отрезка ab.
  const taken = (a, b, L) => colonnades.flatMap(({ at, w }) => {
    const t = ((at[0] - a[0]) * (b[0] - a[0]) + (at[1] - a[1]) * (b[1] - a[1])) / L;
    const perp = Math.hypot(at[0] - a[0] - ((b[0] - a[0]) * t) / L, at[1] - a[1] - ((b[1] - a[1]) * t) / L);
    if (perp >= w / 2) return [];
    const h = Math.sqrt((w / 2) ** 2 - perp ** 2);
    return [[t - h, t + h]];
  });
  const fence = [], concrete = [], chain = [], arcade = [], wall = [], hedge = [];
  // Дома, в которые упирается ограда: кусок внутри дома не строим, стена дома — конец участка.
  const solid = map.buildings.filter((b) => !b.pt && (b.mh || 0) < 2);
  const inHouses = (a, b, L) => {
    const out = [];
    for (const h of solid) {
      const ts = [0, L];
      for (let k = 0; k < h.o.length; k++) {
        const t = crossAt(a, b, h.o[k], h.o[(k + 1) % h.o.length]);
        if (t !== null) ts.push(t * L);
      }
      if (ts.length === 2 && !inRing([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h.o)) continue;
      ts.sort((p, q) => p - q);
      for (let k = 1; k < ts.length; k++) {
        const m = (ts[k - 1] + ts[k]) / 2;
        if (inRing([a[0] + ((b[0] - a[0]) * m) / L, a[1] + ((b[1] - a[1]) * m) / L], h.o)) out.push([ts[k - 1], ts[k]]);
      }
    }
    return out;
  };
  for (const br of map.barriers ?? []) {
    let run = 0; // путь вдоль ограды
    const parts = [];
    for (let i = 1; i < br.p.length; i++) {
      const a = br.p[i - 1], b = br.p[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const s0 = run;
      run += L;
      if (!inside(a) || !inside(b) || L < 0.2) continue;
      // Куски между воротами (у глухой ограды ворот нет), колоннадами и домами.
      const cut = [...(br.kind === 'fence' || br.kind === 'chain' ? gaps(a, b) : []), ...taken(a, b, L), ...inHouses(a, b, L)].sort((p, q) => p[0] - q[0]);
      let s = 0;
      const at = (d) => [a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L];
      const piece = (d0, d1) => {
        if (d1 - d0 < 0.2) return;
        const p = at(d0), q = at(d1);
        parts.push({ a: p, b: q, s0: s0 + d0, s1: s0 + d1 });
        colliders.push([...p, ...q, ['fence', 'chain', 'hedge'].includes(br.kind) ? 1 : 0]); // поверх решётки и изгороди камера видит
      };
      for (const [g0, g1] of cut) { if (g0 > s) piece(s, Math.min(g0, L)); s = Math.max(s, g1); }
      if (s < L) piece(s, L);
    }
    // Повторяющийся рисунок (аркада): участок — куски подряд без разрыва. На участке целое число
    // пролётов, шаг подогнан под его длину — на любом конце (край ограды, дом, колоннада, ворота)
    // встаёт целый пролёт и пилон, а не пол-арки (см. docs/LESSONS.md).
    const list = ({ fence, concrete, chain, arcade, wall, hedge })[br.kind];
    for (let k = 0; k < parts.length;) {
      let j = k;
      while (j + 1 < parts.length && Math.abs(parts[j + 1].s0 - parts[j].s1) < 0.05) j++;
      const r0 = parts[k].s0, len = parts[j].s1 - r0, n = Math.max(1, Math.round(len / ARCADE.tile));
      for (let m = k; m <= j; m++) list.push({ ...parts[m], h: br.h, u0: ((parts[m].s0 - r0) * n) / len, u1: ((parts[m].s1 - r0) * n) / len, n });
      k = j + 1;
    }
  }
  buildFences(fence, scene, LATTICE);
  buildFences(concrete, scene, CONCRETE);
  buildFences(chain, scene, CHAIN);
  buildFences(arcade, scene, ARCADE);
  // Колоннада встаёт ровно между точками, где обрывается ограда (ограда может изгибаться).
  for (const c of colonnades) {
    const ends = [];
    for (const br of map.barriers ?? []) {
      for (let i = 1; i < br.p.length; i++) {
        const a = br.p[i - 1], b = br.p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (const t of taken(a, b, L).flat()) if (t > 0 && t < L) ends.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]);
      }
    }
    colliders.push(...buildFenceColonnade(c, ends.length === 2 ? ends : null, scene));
  }
  buildBoxes(wall, scene, snowyMaterial(0x9c8e7c, 0.5), 0.4, 2.4);
  buildBoxes(hedge, scene, snowyMaterial(0x26331f, 0.7), 0.9, 1.2);
  buildLawnKerbs(map.snowAreas.flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }))).filter(({ a, b }) => inside(a) && inside(b)), scene);
  buildFurniture((map.furniture ?? []).filter((f) => inside(f.p)), map.roads, scene);
  return colliders;
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

const UP = new THREE.Vector3(0, 1, 0);
// Матрица «отрезок ab»: центр, поворот вдоль ab, длина по z.
function along(a, b, y = 0, sx = 1, sy = 1) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
  const q = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(b[0] - a[0], b[1] - a[1]));
  return { x, z, matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, L)) };
}

// --- заборы: плоскость с текстурой на пролёт + столбы ---
// Виды: чугунная решётка с пиками, бетонные плиты «с ромбами» (типовой забор), сетка-рабица.

function texture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const LATTICE = { h: 1.8, tile: 0.6, post: 3, color: 0x2a2b30, alpha: true, draw(c) {
  c.fillStyle = '#fff';
  for (const x of [2, 10, 18, 26]) {
    c.fillRect(x, 6, 3, 118); // прут
    c.beginPath(); c.moveTo(x - 1, 7); c.lineTo(x + 1.5, 0); c.lineTo(x + 4, 7); c.fill(); // пика
  }
  c.fillRect(0, 14, 32, 5); // верхняя перекладина
  c.fillRect(0, 108, 32, 5); // нижняя
}, size: [32, 128] };

// Плита 2 м: серый бетон, поле ромбов, гладкая полоса сверху и снизу, шов по краю.
const CONCRETE = { h: 2.5, tile: 2, post: 2, color: 0xffffff, alpha: false, draw(c) {
  c.fillStyle = '#8b8a85'; c.fillRect(0, 0, 64, 80);
  for (let y = 12; y < 68; y += 8) for (let x = 0; x < 64; x += 8) {
    const o = (y / 8) % 2 ? 4 : 0;
    c.fillStyle = '#9d9c96'; c.beginPath(); c.moveTo(x + o, y - 4); c.lineTo(x + o + 4, y); c.lineTo(x + o, y + 4); c.lineTo(x + o - 4, y); c.fill();
    c.fillStyle = '#6f6e6a'; c.fillRect(x + o - 1, y + 3, 2, 1); // тень под ромбом
  }
  c.fillStyle = '#5f5e5a'; c.fillRect(0, 0, 2, 80); // шов между плитами
  c.fillStyle = '#7a7974'; c.fillRect(0, 76, 64, 4); // низ в грязи
}, size: [64, 80] };

const CHAIN = { h: 1.8, tile: 0.4, post: 2.5, color: 0x6c7075, alpha: true, draw(c) {
  c.strokeStyle = '#fff'; c.lineWidth = 1.5;
  for (let x = -32; x < 64; x += 8) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 32, 64); c.stroke();
    c.beginPath(); c.moveTo(x + 32, 0); c.lineTo(x, 64); c.stroke();
  }
  c.fillStyle = '#fff'; c.fillRect(0, 0, 32, 2); // верхняя проволока
}, size: [32, 64] };

// Ограда Ассигнационного банка: пролёт 6.5 м — жёлтая стена с аркой, белый архивольт,
// в арке чугунная решётка-веер (сквозь неё видно двор), внизу пояс из колец. Пилоны — геометрией.
const ARCADE = { h: 6, tile: 6.5, post: 6.5, color: 0xffffff, alpha: true, pier: [1.7, 0.55, 0xd9d6cc], plinth: [0.8, 0.75], draw(c) {
  const W = 104, H = 96, cx = W / 2, r = 34, spring = 52; // 16 px/м; пята арки на 3.25 м
  c.fillStyle = '#d8bf6a'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#e4cf86'; // веерный руст вокруг арки — светлые клинья
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI + (k / 8) * Math.PI;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * (r + 4), H - spring + Math.sin(a) * (r + 4));
    c.lineTo(cx + Math.cos(a + 0.12) * (r + 20), H - spring + Math.sin(a + 0.12) * (r + 20));
    c.lineTo(cx + Math.cos(a + 0.3) * (r + 20), H - spring + Math.sin(a + 0.3) * (r + 20)); c.fill();
  }
  c.fillStyle = '#efece4'; // архивольт
  c.beginPath(); c.arc(cx, H - spring, r + 4, Math.PI, 0); c.lineTo(cx + r + 4, H); c.lineTo(cx - r - 4, H); c.fill();
  c.save(); // проём арки — прозрачный, по нему решётка
  c.beginPath(); c.arc(cx, H - spring, r, Math.PI, 0); c.lineTo(cx + r, H); c.lineTo(cx - r, H); c.closePath(); c.clip();
  c.clearRect(0, 0, W, H);
  c.strokeStyle = '#1c1d22'; c.lineWidth = 1.5;
  for (let k = 0; k <= 24; k++) { // лучи веера из центра внизу
    const a = Math.PI + (k / 24) * Math.PI;
    c.beginPath(); c.moveTo(cx, H - 24); c.lineTo(cx + Math.cos(a) * 80, H - 24 + Math.sin(a) * 80); c.stroke();
  }
  for (const rr of [12, 26, 40]) { c.beginPath(); c.arc(cx, H - 24, rr, Math.PI, 0); c.stroke(); }
  c.lineWidth = 2; c.beginPath(); c.moveTo(cx - r, H - 24); c.lineTo(cx + r, H - 24); c.stroke();
  for (let x = cx - r + 3; x < cx + r; x += 7) { c.beginPath(); c.arc(x, H - 19, 3, 0, 7); c.stroke(); } // пояс колец над цоколем
  c.restore();
}, size: [104, 96] };

function buildFences(segs, scene, style) {
  if (!segs.length) return;
  const mat = new THREE.MeshLambertMaterial({ color: style.color, map: texture(...style.size, style.draw), alphaTest: style.alpha ? 0.5 : 0, side: THREE.DoubleSide });
  // Плоскости решётки склеены по квадратам 80 м — так three.js отсекает невидимые.
  const cells = new Map();
  const posts = [];
  for (const { a, b, h = style.h, u0: su0 = 0, u1: su1 = 0, n: spans = 0 } of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = `${Math.floor(a[0] / 80)},${Math.floor(a[1] / 80)}`;
    if (!cells.has(k)) cells.set(k, { pos: [], uv: [] });
    const { pos, uv } = cells.get(k);
    // У аркады номер пролёта по участку (u0…u1 — целое число на участок), у остальных — по длине.
    const u0 = style.pier ? su0 : 0, u = style.pier ? su1 : L / style.tile;
    pos.push(a[0], 0.1, a[1], b[0], 0.1, b[1], b[0], h, b[1], a[0], 0.1, a[1], b[0], h, b[1], a[0], h, a[1]);
    uv.push(u0, 0, u, 0, u, 1, u0, 0, u, 1, u0, 1);
    if (style.pier) {
      // Пилоны — на границах арок по пути вдоль ограды.
      for (let j = Math.ceil(u0 - 1e-6); j <= u + 1e-6; j++) {
        const t = (j - u0) / (u - u0);
        // На концах участка (у дома, колоннады, края ограды) — массивный пилон.
        posts.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], h, wide: j === 0 || j === spans });
      }
      continue;
    }
    const n = Math.max(1, Math.round(L / style.post));
    for (let j = 0; j <= n; j++) posts.push({ p: [a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n], h });
  }
  for (const { pos, uv } of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    scene.add(new THREE.Mesh(g, mat));
  }
  if (style.pier) {
    // Пилоны между арками и гранитный цоколь.
    const [pw, pd, pc] = style.pier, [ph, pt] = style.plinth;
    const pier = new THREE.BoxGeometry(pw, 1, pd).translate(0, 0.5, 0);
    addChunked(scene, pier, snowyMaterial(pc, 0.4), posts.map(({ p, h, wide }) => ({
      x: p[0], z: p[1], matrix: new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, p[1]), segYaw(segs, p), new THREE.Vector3(wide ? 1.6 : 1, h + 0.3, wide ? 1.3 : 1)),
    })));
    buildBoxes(segs.map((s) => ({ ...s, h: ph })), scene, snowyMaterial(0x6a6468, 0.55), pt, ph);
    return;
  }
  const post = new THREE.BoxGeometry(0.12, 1, 0.12).translate(0, 0.5, 0);
  addChunked(scene, post, snowyMaterial(style.alpha ? 0x26272c : 0x7d7c77, 0.3), posts.map(({ p, h }) => ({
    x: p[0], z: p[1], matrix: new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, p[1]), new THREE.Quaternion(), new THREE.Vector3(1, h + 0.15, 1)),
  })));
}

// Поворот пилона — по ближайшему пролёту.
function segYaw(segs, p) {
  let best = segs[0], bd = Infinity;
  for (const s of segs) {
    const d = distToSegment(p[0], p[1], s.a[0], s.a[1], s.b[0], s.b[1]);
    if (d < bd) { bd = d; best = s; }
  }
  return new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(best.b[0] - best.a[0], best.b[1] - best.a[1]));
}

// Колоннада в ограде (каталог: fence_colonnade): дорические колонны тёмного гранита, антаблемент,
// между колоннами решётка из пик; лицом к точке face. Возвращает препятствие по линии ограды.
// ends — точки обрыва ограды по краям колоннады (null — прямо поперёк направления на face).
function buildFenceColonnade({ at, face, w, cols = 6, h = 4.6 }, ends, scene) {
  const L0 = Math.hypot(face[0] - at[0], face[1] - at[1]);
  const n = [(face[0] - at[0]) / L0, (face[1] - at[1]) / L0];
  let t = [-n[1], n[0]], o = at;
  if (ends) {
    let [e0, e1] = ends;
    if ((e1[0] - e0[0]) * t[0] + (e1[1] - e0[1]) * t[1] < 0) [e0, e1] = [e1, e0];
    w = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]);
    t = [(e1[0] - e0[0]) / w, (e1[1] - e0[1]) / w];
    o = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2];
  }
  const p = (s) => [o[0] + t[0] * s, o[1] + t[1] * s];
  const yaw = Math.atan2(t[0], t[1]);
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  // Колонны парами от оси (на оси — ворота), шаг по ширине.
  const step = w / cols;
  const xs = Array.from({ length: cols }, (_, k) => (k - (cols - 1) / 2) * step);
  const col = mergeBoxes([[0.95, 0.35, 0.95, 0, 0.17, 0], [0.62, h - 0.8, 0.62, 0, 0.35 + (h - 0.8) / 2, 0], [0.95, 0.45, 0.95, 0, h - 0.22, 0]]);
  addChunked(scene, col, snowyMaterial(0x4a3833, 0.3), xs.map((x) => {
    const [px, pz] = p(x);
    return { x: px, z: pz, matrix: new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(1, 1, 1)) };
  }));
  const ent = new THREE.BoxGeometry(1.1, 0.9, 1).translate(0, h + 0.45, 0); // антаблемент вдоль ограды
  addChunked(scene, ent, snowyMaterial(0xcfc3a6, 0.6), [along(p(-w / 2), p(w / 2))]);
  buildFences([{ a: p(-w / 2), b: p(w / 2), h: h - 0.5 }], scene, LATTICE);
  return [[...p(-w / 2), ...p(w / 2), 1]];
}

// --- стены и изгороди: брус по отрезку, сверху снег ---

function buildBoxes(segs, scene, mat, thick, hDefault) {
  if (!segs.length) return;
  const geo = new THREE.BoxGeometry(thick, 1, 1).translate(0, 0.5, 0);
  addChunked(scene, geo, mat, segs.map(({ a, b, h = hDefault }) => along(a, b, 0, 1, h)));
}

// --- гранитный бортик по краю газонов ---

function buildLawnKerbs(segs, scene) {
  const geo = new THREE.BoxGeometry(0.18, 0.26, 1).translate(0, 0.13, 0);
  addChunked(scene, geo, snowyMaterial(0x6a6468, 0.55), segs.filter(({ a, b }) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3).map(({ a, b }) => along(a, b)));
}

// --- скамейки (спинкой от ближайшей дорожки) и урны ---

function buildFurniture(list, roads, scene) {
  const benches = [], bins = [];
  const r = rng(77);
  for (const f of list) {
    if (f.kind === 'bin') {
      bins.push({ x: f.p[0], z: f.p[1], matrix: new THREE.Matrix4().makeTranslation(f.p[0], 0, f.p[1]) });
      continue;
    }
    // Ближайший отрезок любой дороги или дорожки: скамейка вдоль него, лицом к нему.
    let best = null, bd = 25;
    for (const rd of roads) {
      for (let i = 1; i < rd.p.length; i++) {
        const [ax, az] = rd.p[i - 1], [bx, bz] = rd.p[i];
        const d = distToSegment(f.p[0], f.p[1], ax, az, bx, bz);
        if (d < bd) { bd = d; best = [ax, az, bx, bz]; }
      }
    }
    let yaw = r() * Math.PI * 2;
    if (best) {
      const [ax, az, bx, bz] = best;
      const L = Math.hypot(bx - ax, bz - az) || 1;
      let nx = -(bz - az) / L, nz = (bx - ax) / L; // перпендикуляр к дорожке
      if ((ax - f.p[0]) * nx + (az - f.p[1]) * nz < 0) { nx = -nx; nz = -nz; } // смотрит на дорожку
      yaw = Math.atan2(nx, nz);
    }
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    benches.push({ x: f.p[0], z: f.p[1], matrix: new THREE.Matrix4().compose(new THREE.Vector3(f.p[0], 0, f.p[1]), q, new THREE.Vector3(1, 1, 1)) });
  }
  // Локально: x — вдоль скамейки, +z — вперёд (куда смотрит сидящий).
  const bench = mergeBoxes([
    [1.6, 0.06, 0.42, 0, 0.45, 0], // сиденье
    [1.6, 0.34, 0.05, 0, 0.72, -0.2], // спинка
    [0.06, 0.45, 0.42, -0.7, 0.22, 0], // боковины
    [0.06, 0.45, 0.42, 0.7, 0.22, 0],
  ]);
  addChunked(scene, bench, snowyMaterial(0x4a3524, 0.55), benches);
  const bin = new THREE.CylinderGeometry(0.22, 0.19, 0.75, 10).translate(0, 0.375, 0);
  addChunked(scene, bin, snowyMaterial(0x2c3236, 0.35), bins);
}

function mergeBoxes(list) {
  const pos = [], nrm = [];
  for (const [w, h, d, x, y, z] of list) {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function inRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
