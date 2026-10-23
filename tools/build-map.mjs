// Конвертер: сырой ответ Overpass (data/raw/center.osm.json) -> public/map.json
// Всё переводится в локальные метры вокруг ORIGIN, лишнее отбрасывается.
//
// Скачать сырые данные заново:
//   curl https://overpass.kumi.systems/api/interpreter --data-urlencode \
//   'data=[out:json][timeout:90];(nwr(59.9310,30.3180,59.9405,30.3370););out body;>;out skel qt;' \
//   -o data/raw/center.osm.json

import { readFileSync, writeFileSync } from 'node:fs';
import {
  project, normalizeRing, assembleRings, clipRing, pointInRing, centroid,
  buildingHeights, signedArea, round2,
} from './geo.mjs';

const RAW = 'data/raw/center.osm.json';
const OVERRIDES = JSON.parse(readFileSync('data/overrides.json', 'utf8'));
const OUT = 'public/map.json';

// Границы игровой зоны (то же, что в запросе Overpass) и запас вокруг под «задник».
const BBOX = { s: 59.9310, w: 30.3180, n: 59.9405, e: 30.3370 };
const MARGIN = 60;

const [minX0, maxZ0] = project(BBOX.s, BBOX.w);
const [maxX0, minZ0] = project(BBOX.n, BBOX.e);
const play = [minX0, minZ0, maxX0, maxZ0];
const ext = [minX0 - MARGIN, minZ0 - MARGIN, maxX0 + MARGIN, maxZ0 + MARGIN];
const inExt = ([x, z]) => x >= ext[0] && x <= ext[2] && z >= ext[1] && z <= ext[3];

const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const nodes = new Map();
const ways = new Map();
const rels = [];
for (const el of raw.elements) {
  if (el.type === 'node') {
    const prev = nodes.get(el.id);
    nodes.set(el.id, { ...prev, ...el, p: project(el.lat, el.lon) });
  } else if (el.type === 'way') {
    const prev = ways.get(el.id);
    ways.set(el.id, { ...prev, ...el, tags: el.tags ?? prev?.tags });
  } else if (el.type === 'relation') rels.push(el);
}

const wayPts = (w) => w.nodes.map((id) => nodes.get(id)?.p).filter(Boolean);
const tagsOf = (o) => o.tags ?? {};

// ---------- дороги ----------

const DRIVE = {
  primary: { lanes: 4, lw: 3.4 },
  secondary: { lanes: 2, lw: 3.4 },
  tertiary: { lanes: 2, lw: 3.3 },
  unclassified: { lanes: 2, lw: 3.2 },
  residential: { lanes: 2, lw: 3.2 },
  living_street: { lanes: 1, lw: 3.5 },
  service: { lanes: 1, lw: 3.5 },
};
['primary', 'secondary', 'tertiary'].forEach((k) => (DRIVE[k + '_link'] = DRIVE[k]));
const FOOT = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway']);
const PARK_HW = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street']);

const roads = [];
const driveNodeIds = new Set();
for (const w of ways.values()) {
  const t = tagsOf(w);
  const hw = t.highway;
  if (!hw || t.area === 'yes') continue;
  if (t.tunnel || t.indoor === 'yes' || hw === 'corridor' || Number(t.layer) < 0) continue;
  const drive = DRIVE[hw];
  if (!drive && !FOOT.has(hw)) continue;

  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
  let lanes = parseInt(t.lanes, 10);
  if (!Number.isFinite(lanes)) lanes = drive ? (oneway ? Math.max(1, Math.ceil(drive.lanes / 2)) : drive.lanes) : 0;
  const width = drive ? Math.max(3.2, lanes * drive.lw) : hw === 'pedestrian' ? 6 : 2.5;
  // На тихих улицах вдоль бордюров есть полоса под парковку (в OSM lanes её не считает):
  // w — от бордюра до бордюра, cw — только полосы движения.
  const parking = drive && PARK_HW.has(hw) ? 2 * 2.1 : 0;

  // Режем путь на куски внутри расширенной рамки.
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      roads.push({
        p: run.map((n) => n.p),
        ids: run.map((n) => n.id),
        kind: drive ? (hw === 'service' ? 'service' : 'drive') : 'foot',
        hw,
        name: t.name ?? null,
        oneway,
        lanes,
        w: round2(width + parking),
        cw: parking ? round2(width) : undefined,
        bridge: t.bridge && t.bridge !== 'no' ? 1 : 0,
        crossing: t.footway === 'crossing' ? (t.crossing ?? 'yes') : undefined,
      });
      if (drive && hw !== 'service') run.forEach((n) => driveNodeIds.add(n.id));
    }
    run = [];
  };
  for (const id of w.nodes) {
    const n = nodes.get(id);
    if (n && inExt(n.p)) run.push(n);
    else flush();
  }
  flush();
}

// ---------- многоугольники (здания, вода, газоны) ----------

// Возвращает [{outer, inners}] для пути или мультиполигона.
function polygonsOf(el) {
  if (el.type === 'way') {
    if (el.nodes[0] !== el.nodes[el.nodes.length - 1]) return [];
    return [{ outer: wayPts(el), inners: [] }];
  }
  const outerParts = [];
  const innerParts = [];
  for (const m of el.members ?? []) {
    if (m.type !== 'way') continue;
    const w = ways.get(m.ref);
    if (!w?.nodes) continue;
    (m.role === 'inner' ? innerParts : outerParts).push(w.nodes);
  }
  const toPts = (ring) => ring.map((id) => nodes.get(id)?.p).filter(Boolean);
  const outers = assembleRings(outerParts).map(toPts);
  const inners = assembleRings(innerParts).map(toPts);
  return outers.map((outer) => ({
    outer,
    inners: inners.filter((r) => r.length && pointInRing(r[0], outer)),
  }));
}

const clean = (ring, positive) => normalizeRing(ring.map((p) => [p[0], p[1]]), positive);

const polyEls = [...ways.values(), ...rels.filter((r) => tagsOf(r).type === 'multipolygon' || tagsOf(r).type === 'building')];

const buildingsRaw = [];
const water = [];
const snowAreas = [];
const GREEN = { landuse: ['grass', 'flowerbed', 'meadow'], leisure: ['park', 'garden', 'playground'], natural: ['wood', 'scrub', 'shrub', 'grassland'] };

for (const el of polyEls) {
  const t = tagsOf(el);
  const isBuilding = t.building && t.building !== 'no' && t.building !== 'roof';
  const isPart = !!t['building:part'] && t['building:part'] !== 'no';
  const isWater = t.natural === 'water';
  const isGreen = Object.entries(GREEN).some(([k, vs]) => vs.includes(t[k]));
  if (!isBuilding && !isPart && !isWater && !isGreen) continue;
  if (t.location === 'underground' || Number(t.layer) < 0) continue;

  for (const { outer, inners } of polygonsOf(el)) {
    if (outer.length < 3) continue;
    if (isWater) {
      const o = clipRing(clean(outer, true), ...ext);
      if (o.length < 3) continue;
      water.push({ o: normalizeRing(o, true), i: inners.map((r) => clipRing(clean(r, false), ...ext)).filter((r) => r.length > 2), name: t.name ?? null });
      continue;
    }
    const o = clean(outer, true);
    if (!inExt(centroid(o))) continue;
    if (isGreen) {
      snowAreas.push(o);
      continue;
    }
    const { h, minH } = buildingHeights(t);
    buildingsRaw.push({
      o,
      i: inners.map((r) => clean(r, false)).filter((r) => r.length > 2),
      h,
      mh: minH,
      part: isPart,
      roof: t['roof:shape'] ?? null,
      rh: parseFloat(t['roof:height']) || null,
      color: t['building:colour'] ?? null,
      name: t.name ?? null,
      kind: t.building ?? null,
      id: el.id,
    });
    const ov = OVERRIDES[`${el.type}/${el.id}`];
    if (ov) {
      const { note, partsH, ...fields } = ov;
      Object.assign(buildingsRaw[buildingsRaw.length - 1], fields, { ov });
    }
  }
}

// Правки по координатам: ключ «at:x,z» — ближайшее к точке здание (в пределах 6 м).
for (const [key, ov] of Object.entries(OVERRIDES)) {
  if (!key.startsWith('at:')) continue;
  const [px, pz] = key.slice(3).split(',').map(Number);
  let best = null;
  let bd = 6;
  for (const b of buildingsRaw) {
    for (let i = 0; i < b.o.length; i++) {
      const a = b.o[i], c = b.o[(i + 1) % b.o.length];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
  }
  if (best) {
    const { note, partsH, ...fields } = ov;
    Object.assign(best, fields, { ov });
  } else console.warn(`overrides: у точки ${key} нет здания`);
}

// Правки здания наследуют его части (в OSM части часто без имени и тегов).
for (const parent of buildingsRaw.filter((b) => b.ov && !b.part)) {
  const { note, partsH, h, mh, roof, rh, ...inherit } = parent.ov;
  for (const p of buildingsRaw) {
    if (!p.part || p.ov || !pointInRing(centroid(p.o), parent.o)) continue;
    Object.assign(p, inherit);
    if (partsH) p.h = Math.max(p.h ?? 0, partsH);
  }
}
for (const b of buildingsRaw) delete b.ov;

// Если части (building:part) покрывают большую часть контура — рисуем только их.
// Иначе (как у Казанского собора, где частями описан лишь купол) оставляем и контур.
const parts = buildingsRaw.filter((b) => b.part).map((p) => ({ c: centroid(p.o), a: Math.abs(signedArea(p.o)) }));
const buildings = buildingsRaw.filter((b) => {
  if (b.part) return true;
  const covered = parts.filter((p) => pointInRing(p.c, b.o)).reduce((s, p) => s + p.a, 0);
  return covered < 0.6 * Math.abs(signedArea(b.o));
});
// Здания без высоты: типичный дом центра — 5–6 этажей.
for (const b of buildings) {
  if (b.h == null) {
    const small = Math.abs(signedArea(b.o)) < 60 || b.kind === 'kiosk';
    b.h = small ? 4 : round2(19 + ((b.id * 7919) % 70) / 10);
  }
}

// ---------- точечные объекты ----------

const signals = [];
const crossings = [];
const trees = [];
const lamps = [];
const pois = [];
const metro = [];
const stops = [];
const giveway = [];

const POI_SKIP = new Set([
  'bench', 'waste_basket', 'waste_disposal', 'parking', 'bicycle_parking', 'vending_machine', 'atm',
  'toilets', 'post_box', 'telephone', 'fountain', 'drinking_water', 'clock', 'shelter', 'parking_entrance',
  'charging_station', 'recycling', 'bicycle_rental', 'taxi', 'loading_dock', 'smoking_area', 'grave_yard',
]);
const TOURISM_KEEP = new Set(['hotel', 'hostel', 'museum', 'gallery', 'guest_house', 'apartment']);

function poiCategory(t) {
  if (t.shop) return 'shop:' + t.shop;
  if (t.amenity && !POI_SKIP.has(t.amenity)) return 'amenity:' + t.amenity;
  if (t.tourism && TOURISM_KEEP.has(t.tourism)) return 'tourism:' + t.tourism;
  if (t.craft) return 'craft:' + t.craft;
  return null;
}

for (const n of nodes.values()) {
  const t = n.tags;
  if (!t || !inExt(n.p)) continue;
  const onDrive = driveNodeIds.has(n.id);
  if (onDrive && (t.highway === 'traffic_signals' || t.crossing === 'traffic_signals')) {
    signals.push({ id: n.id, p: n.p, ped: t.highway === 'crossing' || t.crossing === 'traffic_signals' ? 1 : 0 });
  }
  if (onDrive && (t.highway === 'crossing' || t.crossing) && t.crossing !== 'unmarked' && t.crossing !== 'no') {
    crossings.push({ id: n.id, p: n.p, signal: t.crossing === 'traffic_signals' ? 1 : 0 });
  }
  if (t.natural === 'tree') trees.push(n.p);
  if (t.highway === 'street_lamp') lamps.push(n.p);
  if (onDrive && t.highway === 'give_way') giveway.push(n.id);
  if (t.highway === 'bus_stop') stops.push({ p: n.p, name: t.name ?? null });
  if (t.railway === 'subway_entrance') metro.push({ p: n.p, name: t.name ?? 'Метро', colour: t.colour ?? null, ref: t.ref ?? null });
  const cat = t.name && poiCategory(t);
  if (cat) pois.push({ p: n.p, name: t.name, cat });
}
for (const w of ways.values()) {
  const t = tagsOf(w);
  if (t.natural === 'tree_row') {
    const pts = wayPts(w);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      for (let d = 0; d < len; d += 8) trees.push([round2(x1 + ((x2 - x1) * d) / len), round2(z1 + ((z2 - z1) * d) / len)]);
    }
  }
  const cat = t.name && !t.building && poiCategory(t);
  if (cat && w.nodes[0] === w.nodes[w.nodes.length - 1]) {
    const c = centroid(wayPts(w));
    if (inExt(c)) pois.push({ p: c, name: t.name, cat });
  }
}


const out = {
  attribution: '© участники OpenStreetMap, ODbL',
  origin: { lat: 59.9357, lon: 30.3275 },
  play,
  ext,
  roads,
  buildings: buildings.map(({ id, kind, part, ...b }) => (part ? { ...b, pt: 1 } : b)),
  water,
  snowAreas,
  signals,
  crossings,
  trees: trees.filter(inExt),
  lamps,
  pois,
  metro,
  stops,
  giveway,
};
writeFileSync(OUT, JSON.stringify(out));

const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`map.json: ${kb} КБ`);
console.log(`дороги ${roads.length} (едут: ${roads.filter((r) => r.kind === 'drive').length}), здания ${buildings.length}, вода ${water.length}, газоны ${snowAreas.length}`);
console.log(`входы в метро ${metro.length}, остановки ${stops.length}`);
console.log(`светофоры ${signals.length}, переходы ${crossings.length}, деревья ${trees.length}, фонари ${lamps.length}, заведения ${pois.length}`);
