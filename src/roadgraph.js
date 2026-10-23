// Граф дорог для NPC: рёбра между перекрёстками, направленные, со смещением по полосам.

import { cumulative, sampleAt } from './geom.js';

export function buildRoadGraph(map, signalIds) {
  const roads = map.roads.filter((r) => r.kind === 'drive');
  const crossingIds = new Set(map.crossings.map((c) => c.id));
  const use = new Map();
  for (const r of roads) for (const id of r.ids) use.set(id, (use.get(id) || 0) + 1);

  const edges = [];
  const out = new Map();
  const addEdge = (pts, ids, r, lanesDir, roadId) => {
    const cum = cumulative(pts);
    // В OSM светофор стоит на каждом переходе — и до перекрёстка, и после него.
    // Стоп-линия у машины одна: сигнал сразу за перекрёстком (< 12 м от начала ребра)
    // и сигнал в 25 м после предыдущего пропускаем.
    const signals = [];
    ids.forEach((id, i) => {
      if (!signalIds.has(id) || cum[i] < 12) return;
      if (signals.length && cum[i] - signals[signals.length - 1].d < 25) return;
      // Стоп-линия: передний бампер — в 1.5 м до зебры (зебра ±2 м от узла перехода,
      // полкорпуса машины 2.3 м). Переход может быть на самом узле светофора или чуть раньше.
      let first = cum[i];
      ids.forEach((cid, j) => {
        if (crossingIds.has(cid) && cum[j] <= cum[i] + 0.5 && cum[j] > cum[i] - 15) first = Math.min(first, cum[j]);
      });
      signals.push({ d: cum[i], id, stopD: first - 2 - 1.5 - 2.3 });
    });
    const e = {
      i: edges.length, from: ids[0], to: ids[ids.length - 1], ids, pts, cum, len: cum[cum.length - 1],
      w: r.w, cw: r.cw ?? r.w, lanes: lanesDir, oneway: r.oneway, name: r.name, hw: r.hw, signals, roadId,
      lw: (r.oneway ? (r.cw ?? r.w) : (r.cw ?? r.w) / 2) / lanesDir,
    };
    edges.push(e);
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
  };

  roads.forEach((r, ri) => {
    let start = 0;
    for (let i = 1; i < r.ids.length; i++) {
      if (i === r.ids.length - 1 || use.get(r.ids[i]) > 1) {
        const pts = r.p.slice(start, i + 1);
        const ids = r.ids.slice(start, i + 1);
        if (pts.length > 1) {
          const lanesDir = r.oneway ? Math.max(1, r.lanes) : Math.max(1, Math.floor(r.lanes / 2));
          addEdge(pts, ids, r, lanesDir, ri);
          if (!r.oneway) addEdge(pts.slice().reverse(), ids.slice().reverse(), r, lanesDir, ri);
        }
        start = i;
      }
    }
  });
  return { edges, out };
}

// Точка на полосе: k = 0 — крайняя правая.
export function lanePoint(e, s, k) {
  const p = sampleAt(e.pts, e.cum, Math.max(0, Math.min(e.len, s)));
  const l = Math.hypot(p.dx, p.dz) || 1;
  const off = e.cw / 2 - e.lw * (k + 0.5); // от края полос движения (без парковки)
  return { x: p.x + (-p.dz / l) * off, z: p.z + (p.dx / l) * off, dx: p.dx / l, dz: p.dz / l };
}
