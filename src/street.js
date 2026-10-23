// Обустройство улицы по маске проезжей части: гранитный бордюр, снежные валы вдоль него
// и фонари ровной линией у бордюра (в OSM фонарей мало, достраиваем).

import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { offsetPolyline, rng } from './geom.js';
import { addChunked } from './chunks.js';
import { parkedCarGeometries } from './car.js';

const KERB_H = 0.14;
const KERB_W = 0.3;
const STEP = 1; // шаг проверки вдоль края, м

export function buildStreet(map, ground, scene) {
  const junctions = junctionPoints(map);
  const crossings = [...map.crossings.map((c) => c.p), ...crossingWays(map)];
  const near = (pts, x, z, r) => pts.some((p) => Math.abs(p[0] - x) < r && Math.abs(p[1] - z) < r && Math.hypot(p[0] - x, p[1] - z) < r);

  // Кромки проезжей части, за которыми не дорога (тротуар) — там и бордюр.
  const runs = [];
  for (const r of map.roads) {
    if (r.kind !== 'drive' || r.bridge) continue;
    // У односторонки слева — встречная половина улицы или разделитель, бордюра там нет.
    for (const side of r.oneway ? [1] : [-1, 1]) {
      const edge = offsetPolyline(r.p, side * (r.w / 2 + KERB_W / 2));
      const outer = offsetPolyline(r.p, side * (r.w / 2 + 0.9));
      let run = [];
      for (let i = 1; i < edge.length; i++) {
        const L = Math.hypot(edge[i][0] - edge[i - 1][0], edge[i][1] - edge[i - 1][1]);
        const n = Math.max(1, Math.round(L / STEP));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          const x = edge[i - 1][0] + (edge[i][0] - edge[i - 1][0]) * t;
          const z = edge[i - 1][1] + (edge[i][1] - edge[i - 1][1]) * t;
          const ox = outer[i - 1][0] + (outer[i][0] - outer[i - 1][0]) * t;
          const oz = outer[i - 1][1] + (outer[i][1] - outer[i - 1][1]) * t;
          const ok = ground.roadAt(ox, oz) < 0.25 && ground.roadAt(x, z) < 0.75;
          if (ok) run.push({ x, z, ox, oz });
          else if (run.length) {
            if (run.length > 2) runs.push(Object.assign(run, { road: r, side }));
            run = [];
          }
        }
      }
      if (run.length > 2) runs.push(Object.assign(run, { road: r, side }));
    }
  }

  buildKerbs(runs, scene);
  const parked = buildParked(runs, junctions, crossings, near, scene);
  buildBanks(runs, [...crossings, ...parked.map((c) => [c.x, c.z])], near, scene);
  const lamps = placeLamps(map, ground, runs, junctions, crossings, near);
  return { lamps, parked };
}

function buildKerbs(runs, scene) {
  const pos = [];
  const push = (a, b, c) => pos.push(...a, ...b, ...c);
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const p = run[i - 1], q = run[i];
      // Нормаль к дороге: от внешней точки к кромке.
      const nx = p.x - p.ox, nz = p.z - p.oz;
      const nl = Math.hypot(nx, nz) || 1;
      const hx = (nx / nl) * (KERB_W / 2), hz = (nz / nl) * (KERB_W / 2);
      const a0 = [p.x + hx, 0, p.z + hz], b0 = [q.x + hx, 0, q.z + hz];
      const a1 = [p.x + hx, KERB_H, p.z + hz], b1 = [q.x + hx, KERB_H, q.z + hz];
      const c1 = [p.x - hx, KERB_H, p.z - hz], d1 = [q.x - hx, KERB_H, q.z - hz];
      push(a0, b0, b1); push(a0, b1, a1); // грань к дороге
      push(a1, b1, d1); push(a1, d1, c1); // верх
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), {
    emissive: true,
    colorCode: /* glsl */ `
      vec3 granite = vec3(0.42, 0.4, 0.43) * (0.8 + 0.35 * vnoise(vWorld.xz * 4.0));
      float joint = step(0.96, fract((vWorld.x + vWorld.z) * 0.5));
      granite *= 1.0 - joint * 0.4;
      // Сверху лежит снег, на грани к дороге — грязная каша.
      float top = step(${(KERB_H - 0.01).toFixed(3)}, vWorld.y);
      col = mix(granite * mix(0.7, 1.0, vWorld.y / ${KERB_H.toFixed(2)}), vec3(0.85, 0.86, 0.92), top * smoothstep(0.35, 0.6, fbm(vWorld.xz * 1.5)));
      gEmit = col * cityLight(vWorld.xz) * 0.9;
    `,
  });
  scene.add(new THREE.Mesh(g, mat));
}

// Припаркованные машины: вдоль бордюров тихих улиц, по-питерски наполовину на тротуаре.
// На Невском и других главных улицах парковки нет.
const PARK_ON = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street']);
const PARK_COLORS = [0x1d1f24, 0xe8e8ea, 0x9aa0a8, 0x2a3550, 0x6b1f22, 0x3d4a3a, 0xc9c9cc, 0x55585e, 0x8a7a64, 0xb8a040];

function buildParked(runs, junctions, crossings, near, scene) {
  const r = rng(555);
  const cars = [];
  for (const run of runs) {
    if (!PARK_ON.has(run.road.hw) || r() > 0.8) continue;
    let next = 3 + r() * 6;
    let acc = 0;
    for (let i = 1; i < run.length; i++) {
      acc += STEP;
      if (acc < next) continue;
      acc = 0;
      next = 5.4 + r() * 2.2 + (r() < 0.15 ? 6 + r() * 8 : 0); // иногда свободное место
      const p = run[i], q = run[i - 1];
      if (near(junctions, p.x, p.z, 12) || near(crossings, p.x, p.z, 7)) continue;
      // В полосе парковки у бордюра (центр — в 1.15 м от бордюра к дороге).
      const nx = p.x - p.ox, nz = p.z - p.oz;
      const nl = Math.hypot(nx, nz) || 1;
      const x = p.x + (nx / nl) * 1.2, z = p.z + (nz / nl) * 1.2;
      // Смотрит по ходу движения своей стороны улицы.
      const yaw = Math.atan2(-(p.x - q.x), -(p.z - q.z)) + (run.side < 0 ? Math.PI : 0);
      cars.push({ x, z, yaw, color: new THREE.Color(PARK_COLORS[Math.floor(r() * PARK_COLORS.length)]).lerp(new THREE.Color(0xd8dce4), 0.15) });
    }
  }
  const { paint, fixed } = parkedCarGeometries();
  const lit = (vertexColors) => patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors }), {
    emissive: true,
    colorCode: /* glsl */ `
      vec3 base = vec3(1.0);
      #ifdef USE_COLOR
        base = vColor;
      #endif
      gEmit = base * cityLight(vWorld.xz) * 0.9;
    `,
  });
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion(); // стоит ровно, на асфальте
  const items = cars.map((c) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw).multiply(roll);
    return { x: c.x, z: c.z, color: c.color, matrix: new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), q, new THREE.Vector3(1, 1, 1)) };
  });
  addChunked(scene, paint, lit(false), items);
  addChunked(scene, fixed, lit(true), items.map(({ color, ...it }) => it));
  return cars;
}

// Снежные валы за бордюром — как после уборки; на переходах разрывы.
function buildBanks(runs, crossings, near, scene) {
  const r = rng(321);
  const spots = [];
  for (const run of runs) {
    // «Волна» вдоль улицы: где-то высокий вал после уборки, где-то почти чисто.
    const ph1 = r() * 6.28, ph2 = r() * 6.28, f1 = 0.08 + r() * 0.06, f2 = 0.21 + r() * 0.1;
    let gap = 0;
    for (let i = 1; i < run.length; i++) {
      const p = run[i];
      if (near(crossings, p.x, p.z, 4.5)) continue;
      const wave = 0.5 + 0.35 * Math.sin(i * f1 + ph1) + 0.15 * Math.sin(i * f2 + ph2); // 0..1
      if (gap > 0) { gap--; continue; }
      if (r() < 0.04) { gap = 1 + Math.floor(r() * 4); continue; } // прокопанный проход
      if (wave < 0.22 || r() > 0.35 + wave) continue; // чистые участки и разреженность
      const t = 0.65 + r() * 0.4;
      const yaw = Math.atan2(p.x - run[i - 1].x, p.z - run[i - 1].z);
      const heap = r() < 0.04 ? 1.8 + r() * 0.8 : 1; // изредка — большая куча
      const size = (0.55 + wave * 0.9) * heap * (0.8 + r() * 0.4);
      spots.push([p.x + (p.ox - p.x) * t, p.z + (p.oz - p.z) * t, yaw, size]);
    }
  }
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), {
    emissive: true,
    colorCode: /* glsl */ `
      col = vec3(0.84, 0.85, 0.91) * (0.9 + 0.1 * vnoise(vWorld.xz * 3.0));
      // Низ вала — серый от реагентов и брызг.
      col = mix(vec3(0.45, 0.45, 0.5), col, smoothstep(0.02, 0.25, vWorld.y));
      gEmit = col * cityLight(vWorld.xz);
    `,
  });
  const q = new THREE.Quaternion();
  addChunked(scene, geo, mat, spots.map(([x, z, yaw, size]) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + (r() - 0.5) * 0.4);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.05, z), q, new THREE.Vector3(0.45 * size, 0.28 * size, (0.8 + r() * 0.6) * Math.min(size, 1.4)));
    return { x, z, matrix };
  }));
}

// Фонари: парами по обеим сторонам через 25 м, у бордюра; не у перекрёстков и переходов.
// Настоящие фонари из OSM оставляем, если они не на проезжей части.
function placeLamps(map, ground, runs, junctions, crossings, near) {
  const lamps = [];
  for (const run of runs) {
    let acc = 8;
    for (let i = 1; i < run.length; i++) {
      acc += STEP;
      if (acc < 25) continue;
      const p = run[i];
      if (near(junctions, p.x, p.z, 11) || near(crossings, p.x, p.z, 4)) continue;
      // Опора — в 0.5 м за бордюром.
      const t = 0.45;
      const x = p.x + (p.ox - p.x) * t, z = p.z + (p.oz - p.z) * t;
      if (near(lamps, x, z, 12)) continue;
      const dl = Math.hypot(p.x - p.ox, p.z - p.oz) || 1;
      lamps.push([x, z, (p.x - p.ox) / dl, (p.z - p.oz) / dl]); // [x, z, направление к дороге]
      acc = 0;
    }
  }
  const roads = map.roads.filter((r) => r.kind === 'drive');
  for (const l of map.lamps) {
    const ringRoad = [[3, 0], [-3, 0], [0, 3], [0, -3]].filter(([dx, dz]) => ground.roadAt(l[0] + dx, l[1] + dz) > 0.5).length;
    if (ground.roadAt(l[0], l[1]) < 0.2 && ringRoad < 3 && !near(lamps, l[0], l[1], 8)) lamps.push([l[0], l[1], ...toNearestRoad(l, roads)]);
  }
  return lamps;
}

function toNearestRoad(p, roads) {
  let best = [1, 0];
  let bd = Infinity;
  for (const r of roads) {
    for (let i = 1; i < r.p.length; i++) {
      const [ax, az] = r.p[i - 1];
      const [bx, bz] = r.p[i];
      const ex = bx - ax, ez = bz - az;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - az) * ez) / (ex * ex + ez * ez || 1)));
      const qx = ax + ex * t - p[0], qz = az + ez * t - p[1];
      const d = Math.hypot(qx, qz);
      if (d < bd && d > 0.01) {
        bd = d;
        best = [qx / d, qz / d];
      }
    }
  }
  return best;
}

function junctionPoints(map) {
  const use = new Map();
  const pos = new Map();
  for (const r of map.roads) {
    if (r.kind !== 'drive') continue;
    r.ids.forEach((id, i) => {
      use.set(id, (use.get(id) || 0) + 1);
      pos.set(id, r.p[i]);
    });
  }
  return [...use].filter(([, n]) => n > 1).map(([id]) => pos.get(id));
}

// Середины пешеходных переходов, нарисованных линиями (footway=crossing).
function crossingWays(map) {
  return map.roads.filter((r) => r.crossing).map((r) => r.p[Math.floor(r.p.length / 2)]);
}
