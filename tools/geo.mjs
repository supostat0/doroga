// Геометрия для конвертера карты. Чистые функции — покрыты тестами в tests/geo.test.mjs.

export const ORIGIN = { lat: 59.9357, lon: 30.3275 }; // метро «Невский проспект»

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

// Локальные метры: x — на восток, z — на юг (как в three.js, где север = -z).
export function project(lat, lon) {
  return [
    round2((lon - ORIGIN.lon) * M_PER_DEG_LON),
    round2(-(lat - ORIGIN.lat) * M_PER_DEG_LAT),
  ];
}

// Обратно: локальные метры → [lat, lon].
export function unproject(x, z) {
  return [ORIGIN.lat - z / M_PER_DEG_LAT, ORIGIN.lon + x / M_PER_DEG_LON];
}

export function round2(v) {
  return Math.round(v * 100) / 100 + 0; // +0 убирает -0
}

// Площадь со знаком в плоскости (x, z). > 0 — против часовой в этих осях.
export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

// Убирает дубль последней точки и приводит обход к нужному знаку площади.
export function normalizeRing(ring, positive) {
  let r = ring.slice();
  if (r.length > 1 && samePt(r[0], r[r.length - 1])) r.pop();
  if (signedArea(r) > 0 !== positive) r.reverse();
  return r;
}

export function samePt(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

// Склеивает куски линий (массивы id узлов) в замкнутые кольца.
// Незамкнувшиеся остатки отбрасываются.
export function assembleRings(parts) {
  const pool = parts.filter((p) => p.length > 1).map((p) => p.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    let grown = true;
    while (cur[0] !== cur[cur.length - 1] && grown) {
      grown = false;
      const end = cur[cur.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (p[0] === end) cur = cur.concat(p.slice(1));
        else if (p[p.length - 1] === end) cur = cur.concat(p.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (cur.length > 3 && cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}

// Отсечение многоугольника прямоугольником (Сазерленд — Ходжмен).
export function clipRing(ring, minX, minZ, maxX, maxZ) {
  const edges = [
    (p) => p[0] >= minX, (a, b) => lerpAt(a, b, 0, minX),
    (p) => p[0] <= maxX, (a, b) => lerpAt(a, b, 0, maxX),
    (p) => p[1] >= minZ, (a, b) => lerpAt(a, b, 1, minZ),
    (p) => p[1] <= maxZ, (a, b) => lerpAt(a, b, 1, maxZ),
  ];
  let out = ring;
  for (let e = 0; e < 8; e += 2) {
    const inside = edges[e];
    const cut = edges[e + 1];
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

function lerpAt(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [round2(a[0] + (b[0] - a[0]) * t), round2(a[1] + (b[1] - a[1]) * t)];
}

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(ring) {
  let x = 0, z = 0, a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const f = x1 * z2 - x2 * z1;
    x += (x1 + x2) * f;
    z += (z1 + z2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [round2(x / (3 * a)), round2(z / (3 * a))];
}

// "25", "25 m", "25.5м" -> 25.5; мусор -> null
export function parseMeters(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const FLOOR_H = 3.8; // этаж в старом фонде центра

export function buildingHeights(tags) {
  const levels = parseMeters(tags['building:levels']);
  const minLevel = parseMeters(tags['building:min_level']);
  let h = parseMeters(tags.height);
  if (h == null && levels != null) h = levels * FLOOR_H + (tags['building:part'] ? 0 : 1.5);
  let minH = parseMeters(tags.min_height);
  if (minH == null && minLevel != null) minH = minLevel * FLOOR_H;
  return { h, minH: minH ?? 0 };
}
