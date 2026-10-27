// Правила поиска архитектурных элементов в данных OSM (см. src/catalog.js).
// Чистые функции без three.js — покрыты тестами (tests/elements.test.mjs).

// Размеры арки по виду дороги: проезд для машин и проход для людей.
export const PASSAGE = { drive: { w: 3.5, h: 4.3 }, foot: { w: 2.4, h: 3.4 } };

// Арки-проезды: дорога с tunnel=building_passage пересекает стену дома — в стене арка.
// buildings — как в map.json ({ o, i, mh, pt }), lines — [{ p: [[x, z]…], kind: 'drive'|'foot', w?, h? }].
// Возвращает [{ b, r, e, u, w, h }]: дом, кольцо (0 — наружное, 1… — дворы), ребро, центр арки
// вдоль ребра от его начала (м), ширина и высота.
export function findPassages(buildings, lines) {
  const out = [];
  buildings.forEach((bd, b) => {
    if (bd.pt || (bd.mh || 0) > 2) return; // части зданий и дома на опорах не режем
    const box = bbox(bd.o);
    [bd.o, ...(bd.i || [])].forEach((ring, r) => {
      for (const line of lines) {
        if (!overlaps(box, bbox(line.p), 1)) continue;
        const size = { ...PASSAGE[line.kind], ...(line.w && { w: line.w }), ...(line.h && { h: line.h }) };
        for (let k = 1; k < line.p.length; k++) {
          for (let e = 0; e < ring.length; e++) {
            const a = ring[e], c = ring[(e + 1) % ring.length];
            const t = hit(line.p[k - 1], line.p[k], a, c);
            if (t === null) continue;
            const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
            const half = size.w / 2 + 0.3; // арка целиком в ребре, с простенком 30 см
            if (L < 2 * half) continue;
            const u = Math.min(L - half, Math.max(half, t * L));
            if (out.some((q) => q.b === b && q.r === r && q.e === e && Math.abs(q.u - u) < size.w)) continue;
            out.push({ b, r, e, u: Math.round(u * 100) / 100, ...size });
          }
        }
      }
    });
  });
  return out;
}

// Доля пути по ребру cd, где его пересекает отрезок ab (null — не пересекает).
function hit(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den; // по cd
  const s = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den; // по ab
  return t >= 0 && t <= 1 && s >= 0 && s <= 1 ? t : null;
}

function bbox(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}

function overlaps(a, b, pad) {
  return a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];
}

// Ризалит: прямой объём шириной w перед стеной в точке at, лицом к точке face; выступает на out,
// уходит вглубь дома на 6 м. Контур — [левый перед, правый перед, правый зад, левый зад].
export function risalitRing({ at, face, w, out = 1 }) {
  const L = Math.hypot(face[0] - at[0], face[1] - at[1]);
  const n = [(face[0] - at[0]) / L, (face[1] - at[1]) / L], t = [-n[1], n[0]];
  const p = (s, d) => [at[0] + t[0] * s + n[0] * d, at[1] + t[1] * s + n[1] * d];
  return [p(-w / 2, out), p(w / 2, out), p(w / 2, -6), p(-w / 2, -6)];
}

// Точки OSM на стенах домов (ворота, входы): ближайшее ребро в пределах tol м.
// points — [{ p, …теги }] → [{ b, r, e, u, …теги }] (u — от начала ребра).
export function attachToWalls(buildings, points, tol = 0.6) {
  const out = [];
  for (const pt of points) {
    let best = null;
    buildings.forEach((bd, b) => {
      if (bd.pt || (bd.mh || 0) > 2) return;
      [bd.o, ...(bd.i || [])].forEach((ring, r) => {
        for (let e = 0; e < ring.length; e++) {
          const a = ring[e], c = ring[(e + 1) % ring.length];
          const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
          if (L < 0.5) continue;
          const t = Math.max(0, Math.min(1, ((pt.p[0] - a[0]) * dx + (pt.p[1] - a[1]) * dz) / (L * L)));
          const d = Math.hypot(pt.p[0] - a[0] - dx * t, pt.p[1] - a[1] - dz * t);
          if (d < tol && (!best || d < best.d)) best = { d, b, r, e, u: t * L, L };
        }
      });
    });
    if (best) {
      const { p, ...rest } = pt;
      out.push({ ...rest, b: best.b, r: best.r, e: best.e, u: Math.round(best.u * 100) / 100, L: best.L });
    }
  }
  return out;
}

// Сквозные проходы: от арки на наружной стене луч внутрь дома; если в 25 м он выходит во двор
// этого же дома или с другой его стороны (двор между соседними домами) — проём насквозь (depth, open),
// а у арки на выходе свой свод не нужен (vault: 0).
// Двор без единого входа получает пешеходную арку там, где дом к улице тоньше всего (auto: 1).
// streets — отрезки проездов [[ax, az, bx, bz]…]. Меняет и дополняет passages.
export function throughPassages(buildings, passages, streets) {
  const wall = (b, r, e) => { const ring = [buildings[b].o, ...(buildings[b].i || [])][r]; return [ring[e], ring[(e + 1) % ring.length]]; };
  const inward = (a, c) => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); return [-(c[1] - a[1]) / L, (c[0] - a[0]) / L]; };
  // Первый выход луча p + dir·t из дома (во двор или с другой стороны): { r, e, u, t }.
  const toCourt = (b, p, dir) => {
    let hit = null;
    [buildings[b].o, ...(buildings[b].i || [])].forEach((ring, r) => {
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e], c = ring[(e + 1) % ring.length];
        const t = ray(p, dir, a, c);
        if (t && t.t > 0.3 && t.t < 25 && (!hit || t.t < hit.t)) hit = { r, e, u: t.s * Math.hypot(c[0] - a[0], c[1] - a[1]), t: t.t };
      }
    });
    return hit;
  };
  const link = (q) => {
    const [a, c] = wall(q.b, q.r, q.e);
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const p = [a[0] + ((c[0] - a[0]) * q.u) / L, a[1] + ((c[1] - a[1]) * q.u) / L];
    const hit = toCourt(q.b, p, inward(a, c));
    if (!hit || (hit.r === 0 && hit.t < 2)) return; // угол дома, а не выход
    q.depth = Math.round(hit.t * 100) / 100;
    q.open = 1;
    const twin = passages.find((x) => x.b === q.b && x.r === hit.r && x.e === hit.e && Math.abs(x.u - hit.u) < 3);
    if (twin) twin.vault = 0;
    else passages.push({ b: q.b, r: hit.r, e: hit.e, u: Math.round(hit.u * 100) / 100, w: q.w, h: q.h, vault: 0 });
  };
  for (const q of passages.filter((x) => x.r === 0 && x.vault !== 0 && !x.open)) link(q);
  // Дворы без входа.
  buildings.forEach((bd, b) => {
    if (bd.pt || (bd.mh || 0) > 2) return;
    (bd.i || []).forEach((_, k) => {
      if (passages.some((x) => x.b === b && x.r === k + 1)) return;
      let best = null;
      for (let e = 0; e < bd.o.length; e++) {
        const a = bd.o[e], c = bd.o[(e + 1) % bd.o.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const half = PASSAGE.foot.w / 2 + 0.3;
        if (L < 2 * half + 1) continue;
        const n = inward(a, c);
        for (let u = half; u <= L - half; u += 1) {
          const p = [a[0] + ((c[0] - a[0]) * u) / L, a[1] + ((c[1] - a[1]) * u) / L];
          const hit = toCourt(b, p, n);
          if (!hit || hit.r !== k + 1) continue;
          const street = Math.min(...streets.map(([ax, az, bx, bz]) => segDist(p, [ax, az], [bx, bz])));
          if (street > 30) continue;
          const score = hit.t + street * 0.3;
          if (!best || score < best.score) best = { score, e, u };
        }
      }
      if (best) {
        const q = { b, r: 0, e: best.e, u: Math.round(best.u * 100) / 100, ...PASSAGE.foot, auto: 1 };
        passages.push(q);
        link(q);
      }
    });
  });
  return passages;
}

// Луч p + dir·t и отрезок ab: { t, s } (s — доля по ab) или null.
function ray(p, dir, a, b) {
  const sx = b[0] - a[0], sz = b[1] - a[1];
  const den = dir[0] * sz - dir[1] * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / den;
  const s = ((a[0] - p[0]) * dir[1] - (a[1] - p[1]) * dir[0]) / den;
  return s >= 0 && s <= 1 ? { t, s } : null;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
