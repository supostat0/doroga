// Казанский собор объёмом, а не рисунком на стене: колоннада по дугам контура OSM, центральный
// портик с фронтоном, торцевые павильоны крыльев с арками и пилястры на стенах самого собора.
// Свет «запечён» в цвет вершин: лицом наружу светлее, снизу тёплые прожекторы, сверху снег.
import * as THREE from 'three';

export const COL_FLOOR = 1.2; // верх стилобата
export const COL_TOP = 18.4; // низ антаблемента
const GALLERY = 3.0; // глубина галереи за колоннами
const STONE = [0.78, 0.61, 0.38]; // камень под тёплой подсветкой
const BACK = [0.13, 0.11, 0.09], CEIL = [0.07, 0.06, 0.06], FLOOR = [0.55, 0.56, 0.62];
const SNOW = [0.8, 0.81, 0.86];

// Что в контуре собора чем является. Контур — одно здание OSM на всё: корпус, крылья колоннады, портик.
export function findKazan(map) {
  const b = map.buildings.find((x) => x.name === 'Казанский собор' && x.o.length > 50);
  const nevsky = map.roads.filter((r) => r.name === 'Невский проспект' && r.kind === 'drive').flatMap((r) => r.p);
  if (!b || !nevsky.length) return null;
  const n = b.o.length;
  const pt = (i) => b.o[((i % n) + n) % n];
  const len = (i) => Math.hypot(pt(i + 1)[0] - pt(i)[0], pt(i + 1)[1] - pt(i)[1]);
  const head = (i) => Math.atan2(pt(i + 1)[0] - pt(i)[0], pt(i + 1)[1] - pt(i)[1]);
  const turn = (i) => Math.abs(Math.atan2(Math.sin(head(i + 1) - head(i)), Math.cos(head(i + 1) - head(i))));
  const nearest = (p) => nevsky.reduce((best, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1]) ? q : best));

  // Дуги колоннады (лицевая и задняя сторона каждого крыла): подряд короткие рёбра с плавным
  // поворотом, общей длиной от 30 м (маленькая апсида на востоке короче и не попадает).
  const runs = [];
  let cur = [];
  const close = () => {
    if (cur.reduce((s, i) => s + len(i), 0) >= 30) runs.push(cur);
    cur = [];
  };
  for (let i = 0; i < n; i++) {
    if (len(i) >= 8) { close(); continue; }
    cur.push(i);
    if (turn(i) > (25 * Math.PI) / 180) close();
  }
  close();
  const edges = new Set(runs.flat());

  // Портик: ребро, которое пересекает луч от купола к ближайшей точке Невского, а сам портик —
  // по центру выступа, в который это ребро входит (соседние рёбра на одной прямой).
  const dome = map.buildings.find((x) => x.roof === 'dome' && x.o.some((p) => Math.hypot(p[0] - b.o[0][0], p[1] - b.o[0][1]) < 120));
  let portico = null;
  if (dome) {
    const dc = dome.o.reduce((acc, p) => [acc[0] + p[0] / dome.o.length, acc[1] + p[1] / dome.o.length], [0, 0]);
    const np = nearest(dc);
    let bt = Infinity;
    for (let i = 0; i < n; i++) {
      const a = pt(i), c = pt(i + 1);
      const rx = np[0] - dc[0], rz = np[1] - dc[1], sx = c[0] - a[0], sz = c[1] - a[1];
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - dc[0]) * sz - (a[1] - dc[1]) * sx) / den;
      const u = ((a[0] - dc[0]) * rz - (a[1] - dc[1]) * rx) / den;
      if (u < 0 || u > 1 || t < 0 || Math.abs(1 - t) >= bt) continue;
      bt = Math.abs(1 - t);
      portico = { edge: i };
    }
  }
  if (portico) {
    const same = (j) => Math.abs(Math.atan2(Math.sin(head(j) - head(portico.edge)), Math.cos(head(j) - head(portico.edge)))) < (5 * Math.PI) / 180;
    let i0 = portico.edge, i1 = portico.edge;
    while (same(i0 - 1) && i0 - 1 !== i1) i0--;
    while (same(i1 + 1) && i1 + 1 !== i0 + n) i1++;
    const a = pt(i0), c = pt(i1 + 1);
    const [nx, nz] = edgeNormal(a, c);
    portico = { m: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], nx, nz, edges: new Set(Array.from({ length: i1 - i0 + 1 }, (_, k) => (((i0 + k) % n) + n) % n)) };
  }

  // Торцы крыльев, обращённые к Невскому: рёбра 4–12 м лицом к проспекту и ближе 75 м к нему.
  const fronts = [];
  let group = [];
  for (let i = 0; i < n; i++) {
    const a = pt(i), c = pt(i + 1), mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const q = nearest(mid), d = Math.hypot(q[0] - mid[0], q[1] - mid[1]);
    const [nx, nz] = edgeNormal(a, c);
    const facing = ((q[0] - mid[0]) * nx + (q[1] - mid[1]) * nz) / d;
    if (!edges.has(i) && len(i) >= 4 && len(i) < 12 && facing > 0.9 && d < 75) group.push(i);
    else if (group.length) { fronts.push(group); group = []; }
  }
  if (group.length) fronts.push(group);

  // Барабан под куполом виден над низкой частью вокруг него (крыша-пирамида).
  let drum = null;
  if (dome) {
    const c = centroid(dome.o);
    const low = map.buildings.filter((x) => x !== dome && x.mh === dome.mh && x.h < dome.h && Math.hypot(...sub(centroid(x.o), c)) < 3);
    drum = { b: dome, from: Math.max(dome.mh, ...low.map((x) => x.h)) };
  }

  // Сквер перед собором: фонтан и памятники Кутузову и Барклаю-де-Толли (точки из OSM).
  const near = (p, d) => portico && Math.hypot(p[0] - portico.m[0], p[1] - portico.m[1]) < d;
  const mons = map.monuments ?? [];
  const square = {
    fountains: mons.filter((x) => x.kind === 'fountain' && near(x.p, 80)),
    statues: mons.filter((x) => x.kind === 'statue' && near(x.p, 130)).map((x) => ({ ...x, face: nearest(x.p) })),
  };

  return { b, runs, edges, fronts, skip: new Set(fronts.flat()), portico, drum, square };
}

export function addKazan(kz, scene, colliders) {
  const { b } = kz;
  const n = b.o.length;
  const pos = [], col = [];
  const cols = []; // матрицы колонн (колоннада и портик — одна InstancedMesh)

  // Треугольники с готовым цветом; orient — лицом по нормали.
  const quad = (p, nrm, c) => {
    orient(p, nrm);
    for (const v of p) { pos.push(...v); col.push(...c); }
  };
  // Готовая геометрия в локальных осях (x вдоль фасада, y вверх, z наружу) → мир, со «запечённым» светом.
  // flip — вывернуть (смотреть изнутри: проём арки).
  const add = (geo, m, base = STONE, flip = false) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal;
    const v = new THREE.Vector3();
    const tri = [];
    for (let i = 0; i < P.count; i++) {
      const nz = N.getZ(i) * (flip ? -1 : 1), ny = N.getY(i) * (flip ? -1 : 1), nx = N.getX(i) * (flip ? -1 : 1);
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(m);
      let c;
      if (ny > 0.7 && !flip) c = SNOW;
      else {
        const k = (0.4 + 0.5 * Math.max(0, nz) + 0.12 * Math.abs(nx) + 0.1 * Math.max(0, -ny)) * (1.0 + 0.3 * (1 - v.y / 22));
        c = capBloom(base.map((x) => x * k));
      }
      tri.push([v.x, v.y, v.z, c]);
      if (tri.length === 3) {
        if (flip) tri.reverse();
        for (const [x, y, z, cc] of tri) { pos.push(x, y, z); col.push(...cc); }
        tri.length = 0;
      }
    }
  };
  // Оси: x = (nz, −nx) — вдоль ребра от его конца к началу, z — наружу.
  const frame = (o, nx, nz) => new THREE.Matrix4().makeBasis(new THREE.Vector3(nz, 0, -nx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(o[0], 0, o[1]);
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

  // --- Колоннада: стена на дугах только цоколь и антаблемент (см. buildings.js), между ними галерея.
  for (const run of kz.runs) {
    const idx = [...run, (run[run.length - 1] + 1) % n];
    const outer = idx.map((i) => b.o[i]);
    const inner = idx.map((i, k) => {
      if (k > 0 && k < idx.length - 1) return ringOffset(b.o, i, -GALLERY);
      const e = k === 0 ? edgeNormal(b.o[i], b.o[(i + 1) % n]) : edgeNormal(b.o[(i - 1 + n) % n], b.o[i]);
      return [b.o[i][0] - e[0] * GALLERY, b.o[i][1] - e[1] * GALLERY];
    });
    for (let k = 0; k < idx.length - 1; k++) {
      const [ox, oz] = outer[k], [ox2, oz2] = outer[k + 1], [ix, iz] = inner[k], [ix2, iz2] = inner[k + 1];
      const [nx, nz] = edgeNormal(outer[k], outer[k + 1]);
      quad([[ix, COL_FLOOR, iz], [ix2, COL_FLOOR, iz2], [ix2, COL_TOP, iz2], [ix, COL_FLOOR, iz], [ix2, COL_TOP, iz2], [ix, COL_TOP, iz]], [nx, 0, nz], BACK);
      quad([[ox, COL_FLOOR, oz], [ox2, COL_FLOOR, oz2], [ix2, COL_FLOOR, iz2], [ox, COL_FLOOR, oz], [ix2, COL_FLOOR, iz2], [ix, COL_FLOOR, iz]], [0, 1, 0], FLOOR);
      quad([[ox, COL_TOP, oz], [ox2, COL_TOP, oz2], [ix2, COL_TOP, iz2], [ox, COL_TOP, oz], [ix2, COL_TOP, iz2], [ix, COL_TOP, iz]], [0, -1, 0], CEIL);
    }
    for (const k of [0, idx.length - 1]) {
      const [ox, oz] = outer[k], [ix, iz] = inner[k];
      const k2 = k === 0 ? 1 : k - 1; // торец галереи смотрит внутрь дуги
      quad([[ox, COL_FLOOR, oz], [ix, COL_FLOOR, iz], [ix, COL_TOP, iz], [ox, COL_FLOOR, oz], [ix, COL_TOP, iz], [ox, COL_TOP, oz]], [outer[k2][0] - ox, 0, outer[k2][1] - oz], BACK);
    }
    // Колонны с равным шагом, чуть внутри наружной линии.
    const seg = [];
    let total = 0;
    for (let k = 0; k < outer.length - 1; k++) {
      const L = Math.hypot(outer[k + 1][0] - outer[k][0], outer[k + 1][1] - outer[k][1]);
      seg.push([total, L, k]);
      total += L;
    }
    const count = Math.max(2, Math.round(total / 2.6));
    for (let j = 0; j < count; j++) {
      const s = ((j + 0.5) * total) / count;
      const [s0, L, k] = seg.find(([s0, L]) => s < s0 + L) ?? seg[seg.length - 1];
      const t = (s - s0) / L;
      const [nx, nz] = edgeNormal(outer[k], outer[k + 1]);
      const x = outer[k][0] + (outer[k + 1][0] - outer[k][0]) * t - nx * 0.75;
      const z = outer[k][1] + (outer[k + 1][1] - outer[k][1]) * t - nz * 0.75;
      cols.push(frame([x, z], nx, nz).setPosition(x, COL_FLOOR, z));
    }
  }

  // --- Центральный портик: ступени, два ряда по шесть колонн, антаблемент, фронтон.
  if (kz.portico) {
    const { m, nx, nz } = kz.portico;
    const M = frame(m, nx, nz);
    const HW = 11.2, D = 6;
    for (let k = 0; k < 3; k++) add(box(2 * HW + 2.4 - k * 0.8, 0.4, D + 1.2 - k * 0.4, 0, 0.2 + k * 0.4, (D + 1.2 - k * 0.4) / 2), M);
    const loc = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M).toArray();
    quad([loc(-HW, COL_FLOOR, 0.06), loc(HW, COL_FLOOR, 0.06), loc(HW, COL_TOP, 0.06), loc(-HW, COL_FLOOR, 0.06), loc(HW, COL_TOP, 0.06), loc(-HW, COL_TOP, 0.06)], [nx, 0, nz], BACK);
    quad([loc(-HW, COL_TOP, 0), loc(HW, COL_TOP, 0), loc(HW, COL_TOP, D), loc(-HW, COL_TOP, 0), loc(HW, COL_TOP, D), loc(-HW, COL_TOP, D)], [0, -1, 0], CEIL);
    for (const z of [D - 0.8, D - 3.2]) {
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Vector3(-10 + i * 4, COL_FLOOR, z).applyMatrix4(M);
        cols.push(frame([p.x, p.z], nx, nz).setPosition(p.x, COL_FLOOR, p.z));
      }
    }
    add(box(2 * HW, 1.2, D, 0, COL_TOP + 0.6, D / 2), M); // архитрав
    add(box(2 * HW - 0.4, 0.8, D - 0.2, 0, COL_TOP + 1.6, (D - 0.2) / 2), M, STONE.map((x) => x * 0.8)); // фриз
    add(box(2 * HW + 1.2, 0.6, D + 0.6, 0, COL_TOP + 2.3, (D + 0.6) / 2), M); // карниз
    // Фронтон: тимпан чуть утоплен, наклонные карнизы выступают.
    const y0 = COL_TOP + 2.6, rise = 5.2;
    const tri = new THREE.Shape([new THREE.Vector2(-HW, 0), new THREE.Vector2(HW, 0), new THREE.Vector2(0, rise)]);
    add(new THREE.ExtrudeGeometry(tri, { depth: D - 0.4, bevelEnabled: false }).translate(0, y0, 0), M, STONE.map((x) => x * 0.85));
    const slope = Math.atan2(rise, HW), rl = Math.hypot(HW + 0.6, rise + 0.3);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(rl, 0.5, D + 0.4).rotateZ(-s * slope).translate((s * (HW + 0.6)) / 2, y0 + rise / 2 + 0.1, (D + 0.4) / 2);
      add(g, M);
    }
    // Стилобат — препятствие.
    const w = HW + 1.2, d = D + 1.2;
    const ring = [loc(-w, 0, 0), loc(-w, 0, d), loc(w, 0, d), loc(w, 0, 0)].map((p) => [p[0], p[2]]);
    colliders.push(...ring.slice(1).map((q, i) => [...ring[i], ...q]));
  }

  // --- Торцевые павильоны крыльев: стена с большой аркой проезда, проём вглубь, пилястры.
  for (const fr of kz.fronts) {
    const a = b.o[fr[0]], c = b.o[(fr[fr.length - 1] + 1) % n];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const [nx, nz] = edgeNormal(a, c);
    const M = frame(c, nx, nz).multiply(new THREE.Matrix4().makeTranslation(L / 2, 0, 0)); // x = 0 — середина
    const H = b.h, R = Math.min(3, L / 2 - 2), spring = 9;
    const arch = (r) => {
      const s = new THREE.Shape();
      s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, spring); s.absarc(0, spring, r, 0, Math.PI, false); s.lineTo(-r, 0);
      return s;
    };
    const wall = new THREE.Shape([new THREE.Vector2(-L / 2, 0), new THREE.Vector2(L / 2, 0), new THREE.Vector2(L / 2, H), new THREE.Vector2(-L / 2, H)]);
    wall.holes.push(arch(R));
    add(new THREE.ShapeGeometry(wall, 16), M);
    add(new THREE.ExtrudeGeometry(arch(R), { depth: 2.5, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -2.5), M, [0.3, 0.24, 0.17], true);
    // Архивольт (П-образная рама вокруг арки) выступает, по краям — пилястры.
    const r1 = R + 0.6, ring = new THREE.Shape();
    ring.moveTo(-r1, 0); ring.lineTo(-R, 0); ring.lineTo(-R, spring); ring.absarc(0, spring, R, Math.PI, 0, true);
    ring.lineTo(R, 0); ring.lineTo(r1, 0); ring.lineTo(r1, spring); ring.absarc(0, spring, r1, 0, Math.PI, false); ring.lineTo(-r1, 0);
    add(new THREE.ExtrudeGeometry(ring, { depth: 0.35, bevelEnabled: false, curveSegments: 16 }), M);
    for (const s of [-1, 1]) add(box(1.4, COL_TOP - COL_FLOOR, 0.4, s * (L / 2 - 0.9), (COL_FLOOR + COL_TOP) / 2, 0.2), M);
  }

  // --- Барабан: пилястры на каждой вершине кольца, между ними тёмные арочные окна.
  if (kz.drum) {
    const { b: d, from } = kz.drum;
    const m = d.o.length, top = d.h - 1.2; // под карнизом барабана
    for (let i = 0; i < m; i++) {
      const a = d.o[i], c = d.o[(i + 1) % m];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const [nx, nz] = edgeNormal(a, c);
      const M = frame(c, nx, nz);
      add(box(0.7, top - from, 0.35, 0, (from + top) / 2, 0.175), M);
      const w = Math.min(0.7, L / 2 - 0.6), y0 = from + 3, y1 = top - 2.5 - w;
      if (w < 0.2 || y1 <= y0) continue;
      const win = new THREE.Shape();
      win.moveTo(-w, y0); win.lineTo(w, y0); win.lineTo(w, y1); win.absarc(0, y1, w, 0, Math.PI, false); win.lineTo(-w, y0);
      add(new THREE.ShapeGeometry(win, 8).translate(L / 2, 0, 0.03), M, [0.09, 0.08, 0.08]);
    }
  }

  // --- Пилястры на стенах корпуса (кроме колоннады, торцов павильонов и портика).
  for (let i = 0; i < n; i++) {
    if (kz.edges.has(i) || kz.skip.has(i) || kz.portico?.edges.has(i)) continue;
    const a = b.o[i], c = b.o[(i + 1) % n];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 5) continue;
    const [nx, nz] = edgeNormal(a, c);
    const M = frame(c, nx, nz);
    const k = Math.max(2, Math.round(L / 3.6) + 1);
    for (let j = 0; j < k; j++) {
      const x = 0.7 + (j * (L - 1.4)) / (k - 1);
      add(box(1.0, COL_TOP - COL_FLOOR, 0.35, x, (COL_FLOOR + COL_TOP) / 2, 0.175), M);
      add(box(1.3, 0.6, 0.5, x, COL_TOP - 0.3, 0.25), M); // капитель
    }
  }

  // --- Сквер: гранитный фонтан (чаша на постаменте в круглом бассейне) и памятники на постаментах.
  const GRANITE = [0.42, 0.33, 0.31], BRONZE = [0.3, 0.25, 0.17];
  const circle = (c, r, k = 12) => {
    for (let j = 0; j < k; j++) {
      const a0 = (j / k) * Math.PI * 2, a1 = ((j + 1) / k) * Math.PI * 2;
      colliders.push([c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r, c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r]);
    }
  };
  for (const f of kz.square.fountains) {
    const R = f.r;
    const M = kz.portico ? frame(f.p, kz.portico.nx, kz.portico.nz) : frame(f.p, 0, 1);
    // Профиль снизу вверх: так грани LatheGeometry смотрят наружу.
    const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20);
    add(lathe([[R - 0.4, 0.75], [R - 0.4, 0], [R, 0], [R, 0.7], [R - 0.05, 0.8], [R - 0.4, 0.75]]), M, GRANITE); // бортик (замкнутый профиль — грани наружу)
    add(new THREE.CircleGeometry(R - 0.4, 20).rotateX(-Math.PI / 2).translate(0, 0.4, 0), M); // лёд под снегом
    add(lathe([[0.9, 0.0], [0.9, 0.4], [0.55, 0.4], [0.5, 2.2], [1.8, 2.45], [1.7, 2.6], [0.25, 2.9], [0.35, 3.3], [0.01, 3.4]]), M, GRANITE); // чаша на постаменте
    circle(f.p, R);
  }
  for (const s of kz.square.statues) {
    const d = sub(s.face, s.p), dl = Math.hypot(...d) || 1;
    const M = frame(s.p, d[0] / dl, d[1] / dl); // лицом к Невскому
    add(box(3.0, 0.5, 3.0, 0, 0.25, 0), M, GRANITE);
    add(box(2.2, 3.4, 2.2, 0, 2.2, 0), M, GRANITE);
    add(box(2.6, 0.35, 2.6, 0, 4.07, 0), M, GRANITE);
    // Фигура: ноги в плаще, торс, голова, рука с жезлом вперёд.
    const y0 = 4.25;
    add(new THREE.CylinderGeometry(0.38, 0.55, 1.7, 10).translate(0, y0 + 0.85, 0), M, BRONZE);
    add(new THREE.CylinderGeometry(0.42, 0.38, 0.9, 10).translate(0, y0 + 2.15, 0), M, BRONZE);
    add(new THREE.SphereGeometry(0.24, 10, 8).translate(0, y0 + 2.85, 0), M, BRONZE);
    add(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6).rotateX(Math.PI / 3).translate(0.45, y0 + 2.1, 0.45), M, BRONZE);
    const ring = [[-1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]].map(([x, z]) => {
      const p = new THREE.Vector3(x, 0, z).applyMatrix4(M);
      return [p.x, p.z];
    });
    for (let j = 0; j < 4; j++) colliders.push([...ring[j], ...ring[j + 1]]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true })));

  const inst = new THREE.InstancedMesh(columnGeometry(COL_TOP - COL_FLOOR), new THREE.MeshBasicMaterial({ vertexColors: true }), cols.length);
  cols.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.computeBoundingSphere();
  scene.add(inst);
}

// Колонна высотой H: база, ствол, расширяющаяся капитель и абака.
function columnGeometry(H) {
  const parts = [
    new THREE.BoxGeometry(1.5, 0.5, 1.5).translate(0, 0.25, 0),
    new THREE.CylinderGeometry(0.55, 0.62, H - 1.7, 12).translate(0, 0.5 + (H - 1.7) / 2, 0),
    new THREE.CylinderGeometry(0.82, 0.56, 0.8, 12).translate(0, H - 1.2 + 0.4, 0),
    new THREE.BoxGeometry(1.8, 0.4, 1.8).translate(0, H - 0.2, 0),
  ].map((p) => p.toNonIndexed());
  const pos = [], col = [];
  for (const p of parts) {
    const P = p.attributes.position, N = p.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      const k = (0.4 + 0.5 * Math.max(0, N.getZ(i)) + 0.12 * Math.abs(N.getX(i))) * (1.0 + 0.3 * (1 - y / H));
      pos.push(P.getX(i), y, P.getZ(i));
      col.push(...capBloom(STONE.map((x) => x * k)));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Яркость не выше порога bloom (0.9) — иначе вблизи камень светится на весь экран.
function capBloom([r, g, b]) {
  const k = Math.min(1, 0.8 / Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 1e-6));
  return [r * k, g * k, b * k];
}

function centroid(o) {
  return o.reduce((s, p) => [s[0] + p[0] / o.length, s[1] + p[1] / o.length], [0, 0]);
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function edgeNormal(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
}

// Вершина контура, сдвинутая по биссектрисе на d (минус — внутрь).
function ringOffset(ring, i, d) {
  const n = ring.length;
  const n1 = edgeNormal(ring[(i - 1 + n) % n], ring[i]), n2 = edgeNormal(ring[i], ring[(i + 1) % n]);
  let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
  const ml = Math.hypot(mx, mz) || 1;
  mx /= ml; mz /= ml;
  const k = 1 / Math.max(0.5, mx * n2[0] + mz * n2[1]);
  return [ring[i][0] + mx * d * k, ring[i][1] + mz * d * k];
}

// Треугольники лицом по нормали n.
function orient(v, [nx, ny, nz]) {
  for (let i = 0; i < v.length; i += 3) {
    const [a, b, c] = [v[i], v[i + 1], v[i + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    if ((uy * wz - uz * wy) * nx + (uz * wx - ux * wz) * ny + (ux * wy - uy * wx) * nz < 0) { v[i + 1] = c; v[i + 2] = b; }
  }
}
