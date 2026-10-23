// Здания: стены по контурам OSM, фасад рисуется в шейдере (окна, карнизы, руст),
// крыши под снегом, купола у частей с roof:shape.

import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { rng } from './geom.js';
import { addVoxelPortico } from './voxels.js';

// Палитра петербургских фасадов.
const PALETTE = ['#d8b67a', '#e4cd95', '#cf9a84', '#bcc4ae', '#cbb6a4', '#b1aeb3', '#d9ab8b', '#e2dac8', '#c8a46e', '#d3c29c'];

// photoWalls — стены с фасадом по разметке фото ({ a, b }): у них нет объёмной тяги и карниза
// (они бы торчали перед рисунком), вместо карниза — ровная полоса до крыши.
export function buildBuildings(map, scene, photoWalls = []) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const colr = [];
  const preset = []; // особый фасад: 0 — обычный, 10 Гостиный, 11 Зингер, 12 Пассаж, 13 Дума
  const clocks = [];
  const info = [];
  const colliders = [];
  const facades = [];
  const domes = [];
  const chimneys = [];
  const tmpC = new THREE.Color();

  // Части храмов (барабан купола и т. п.) в OSM без имени — узнаём их по контуру храма.
  const churchRings = map.buildings.filter((b) => b.name && /собор|церковь|базилика/i.test(b.name)).map((b) => b.o);
  map.buildings.forEach((b, bi) => {
    const r = rng(bi * 2654435761 + 7);
    tmpC.set(PALETTE[Math.floor(r() * PALETTE.length)]);
    if (b.color) {
      try { tmpC.setStyle(b.color); } catch { /* нестандартный цвет — остаётся палитра */ }
    }
    const isChurch = (b.name && /собор|церковь|базилика/i.test(b.name)) || churchRings.some((r) => pointInRing(b.o[0], r) && pointInRing(b.o[Math.floor(b.o.length / 2)], r));
    if (isChurch && !b.color) tmpC.set('#bdb6a8');
    // Пасмурный день: цвета приглушены.
    tmpC.lerp(new THREE.Color('#c9c6c8'), 0.3);
    tmpC.convertSRGBToLinear();
    const top = b.h;
    const base = b.mh;
    const small = top < 6;
    const seed = r();
    const presetId = { gostiny: 10, singer: 11, passage: 12, duma: 13, metro: 14 }[b.facade] ?? 0;
    if (b.clock) clocks.push(b);
    const push = (x, y, z, nx, ny, nz, u, v, roof) => {
      pos.push(x, y, z);
      nrm.push(nx, ny, nz);
      uv.push(u, v);
      colr.push(tmpC.r, tmpC.g, tmpC.b);
      info.push(top, base, seed, roof ? 1 : small ? 2 : isChurch ? 3 : 0);
      preset.push(presetId);
    };

    // Части зданий (building:part) часто стоят стена в стену с родителем — отодвигаем их
    // стены на 5 см наружу, иначе две стены в одной плоскости мерцают (z-fighting).
    const partOff = b.pt ? 0.05 : 0;
    for (const ring0 of [b.o, ...b.i]) {
      const ring = partOff ? ring0.map((_, i) => ringOffset(ring0, i, partOff)) : ring0;
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const c = ring[(i + 1) % ring.length];
        const dx = c[0] - a[0];
        const dz = c[1] - a[1];
        const L = Math.hypot(dx, dz);
        if (L < 0.01) continue;
        // Наружная нормаль: внешние кольца положительны, внутренние отрицательны.
        const nx = dz / L;
        const nz = -dx / L;
        const quad = [
          [a[0], base, a[1], u, base], [c[0], base, c[1], u + L, base], [c[0], top, c[1], u + L, top],
          [a[0], base, a[1], u, base], [c[0], top, c[1], u + L, top], [a[0], top, a[1], u, top],
        ];
        orient(quad, nx, 0, nz);
        for (const q of quad) push(q[0], q[1], q[2], nx, 0, nz, q[3], q[4], false);
        if (base < 2) colliders.push([a[0], a[1], c[0], c[1]]);
        if (ring === b.o && base < 2 && top > 6 && L > 2.5) facades.push({ a, b: c, n: [nx, nz], L, h: top, church: isChurch });
        u += L;
      }
    }

    // Объём фасада: настоящий карниз, скатная заснеженная кромка крыши и тяга над первым этажом.
    const solid = !small && top > 7 && top - base > 4;
    const roofY = solid ? top + 1.4 : top;
    if (solid) {
      const kind4 = (x, y, z, nx, ny, nz, u, roofFlag) => {
        pos.push(x, y, z);
        nrm.push(nx, ny, nz);
        uv.push(u, y);
        colr.push(tmpC.r, tmpC.g, tmpC.b);
        info.push(top, base, seed, roofFlag ? 1 : 4);
        preset.push(presetId);
      };
      // Профиль снизу вверх по наружной поверхности: [вынос наружу, высота], флаг «это крыша».
      const cornice = [[0, top - 1.1, 0], [0.16, top - 1.0, 0], [0.16, top - 0.86, 0], [0.42, top - 0.7, 0], [0.52, top - 0.45, 0], [0.52, top - 0.3, 0], [0, roofY, 1]];
      const onPhoto = (i) => photoWalls.some((w) => edgeOnWall(b.o[i], b.o[(i + 1) % b.o.length], w));
      sweep(b.o, cornice, kind4, onPhoto);
      if (base < 2 && top > 10) sweep(b.o, [[0, 4.5, 0], [0.12, 4.56, 0], [0.12, 4.8, 0], [0, 4.86, 0]], kind4, onPhoto);
      // Над фасадом по фото — стенка от верха стены до кромки крыши (без неё была бы щель).
      for (let i = 0; i < b.o.length; i++) {
        if (!onPhoto(i)) continue;
        const a = b.o[i], c = b.o[(i + 1) % b.o.length];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 0.01) continue;
        const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
        const q = [[a[0], top, a[1]], [c[0], top, c[1]], [c[0], roofY, c[1]], [a[0], top, a[1]], [c[0], roofY, c[1]], [a[0], roofY, a[1]]];
        orient(q, nx, 0, nz);
        for (const v of q) kind4(v[0], v[1], v[2], nx, 0, nz, 0, false);
      }
      // Внутренние дворы — стены до уровня крыши, чтобы не было щели.
      for (const ring of b.i) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], c = ring[(i + 1) % ring.length];
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (L < 0.01) continue;
          const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
          const q = [[a[0], top, a[1]], [c[0], top, c[1]], [c[0], roofY, c[1]], [a[0], top, a[1]], [c[0], roofY, c[1]], [a[0], roofY, a[1]]];
          orient(q, nx, 0, nz);
          for (const v of q) kind4(v[0], v[1], v[2], nx, 0, nz, 0, true);
        }
      }
      // Печные трубы на крыше.
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const i = Math.floor(r() * b.o.length);
        const p = ringOffset(b.o, i, -2.5 - r() * 3);
        if (pointInRing(p, b.o)) chimneys.push([p[0], roofY, p[1], r()]);
      }
    }

    // Крыша.
    const contour = b.o.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = b.i.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = [...b.o, ...b.i.flat()];
    for (const t of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const tri = t.map((k) => [all[k][0], roofY, all[k][1], all[k][0], all[k][1]]);
      orient(tri, 0, 1, 0);
      for (const q of tri) push(q[0], q[1], q[2], 0, 1, 0, q[3], q[4], true);
    }

    if (b.roof && ['dome', 'onion', 'cone', 'pyramidal', 'round', 'globe'].includes(b.roof)) {
      domes.push({ b, top: roofY });
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aPreset', new THREE.Float32BufferAttribute(preset, 1));
  g.computeBoundingSphere();

  const mesh = new THREE.Mesh(g, facadeMaterial());
  scene.add(mesh);
  addDomes(domes, scene);
  addChimneys(chimneys, scene);
  addClocks(clocks, scene);
  addPediment(map, scene, colliders);

  return { colliders, facades, chimneys };
}

// Протягивает профиль вдоль замкнутого контура (со стыковкой углов «на ус»).
// Нормаль сегмента профиля (Δd, Δy) наружу = (Δy, −Δd) в осях «наружу/вверх».
function sweep(ring, prof, emit, skip = () => false) {
  const n = ring.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], c = ring[(i + 1) % n];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 0.01) continue;
    if (skip(i)) { u += L; continue; }
    const ex = (c[1] - a[1]) / L, ez = -(c[0] - a[0]) / L; // наружная нормаль ребра
    for (let k = 1; k < prof.length; k++) {
      const [d0, y0] = prof[k - 1];
      const [d1, y1, roof] = prof[k];
      const p0 = ringOffset(ring, i, d0), p1 = ringOffset(ring, (i + 1) % n, d0);
      const q0 = ringOffset(ring, i, d1), q1 = ringOffset(ring, (i + 1) % n, d1);
      let nx = ex * (y1 - y0), ny = -(d1 - d0), nz = ez * (y1 - y0);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const quad = [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [q1[0], y1, q1[1]], [p0[0], y0, p0[1]], [q1[0], y1, q1[1]], [q0[0], y1, q0[1]]];
      orient(quad, nx, ny, nz);
      for (const v of quad) emit(v[0], v[1], v[2], nx, ny, nz, u, roof);
    }
    u += L;
  }
}

// Ребро p→q лежит на стене w (оба конца в 0.6 м от её прямой и в её пределах).
function edgeOnWall(p, q, w) {
  const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz);
  const on = ([x, z]) => {
    const t = ((x - w.a[0]) * dx + (z - w.a[1]) * dz) / L;
    return t > -0.5 && t < L + 0.5 && Math.abs((x - w.a[0]) * dz - (z - w.a[1]) * dx) / L < 0.6;
  };
  return on(p) && on(q);
}

// Точка контура i, сдвинутая наружу на d (d < 0 — внутрь), с митрой на углу.
function ringOffset(ring, i, d) {
  const n = ring.length;
  const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
  const n1 = edgeNormal(a, b), n2 = edgeNormal(b, c);
  let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
  const ml = Math.hypot(mx, mz) || 1;
  mx /= ml; mz /= ml;
  const k = 1 / Math.max(0.5, mx * n2[0] + mz * n2[1]);
  return [b[0] + mx * d * k, b[1] + mz * d * k];
}

function edgeNormal(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function addChimneys(list, scene) {
  if (!list.length) return;
  const geo = new THREE.BoxGeometry(0.7, 1.4, 0.7);
  geo.translate(0, 0.7, 0);
  const cap = new THREE.BoxGeometry(0.85, 0.14, 0.85);
  cap.translate(0, 1.47, 0);
  const brick = new THREE.MeshLambertMaterial({ color: 0x5a3e36 });
  const snow = new THREE.MeshLambertMaterial({ color: 0xdfe2ea });
  const a = new THREE.InstancedMesh(geo, brick, list.length);
  const b = new THREE.InstancedMesh(cap, snow, list.length);
  const m = new THREE.Matrix4();
  list.forEach(([x, y, z, s], i) => {
    m.makeScale(1, 0.8 + s * 0.8, 1).setPosition(x, y, z);
    a.setMatrixAt(i, m);
    b.setMatrixAt(i, m);
  });
  scene.add(a, b);
}

// Ставит обход треугольников под заданную нормаль.
function orient(verts, nx, ny, nz) {
  for (let i = 0; i < verts.length; i += 3) {
    const [a, b, c] = [verts[i], verts[i + 1], verts[i + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz < 0) {
      verts[i + 1] = c;
      verts[i + 2] = b;
    }
  }
}

// Особые фасады узнаваемых домов Невского (рисуем сами по их архитектуре).
const PRESETS_GLSL = /* glsl */ `
  float lit = 0.0;
  if (vPreset < 10.5) {
    // Гостиный двор: двухъярусная аркада, белые колонны, балюстрада.
    float bay = 5.6;
    float fx = fract(u / bay);
    float d = abs(fx - 0.5);
    float cell = floor(u / bay);
    col = wall;
    float col1 = step(0.44, d); // колонны между арками
    if (y < 7.0) {
      float arch = step(d, 0.36) * step(0.15, y) * step(y, 4.4 + 1.9 * sqrt(max(0.0, 1.0 - pow(d / 0.36, 2.0))));
      float frameA = step(d, 0.4) * step(y, 4.6 + 2.1 * sqrt(max(0.0, 1.0 - pow(d / 0.4, 2.0)))) - arch;
      col = mix(col, vec3(0.92, 0.9, 0.84), max(col1, frameA * 0.8));
      // Внутри арки — галерея с витринами.
      float shop = arch * step(y, 3.6) * step(d, 0.3);
      col = mix(col, vec3(0.08, 0.07, 0.07), arch);
      gEmit += shop * vec3(1.0, 0.78, 0.48) * (0.55 + 0.25 * step(0.5, hash12(vec2(cell, 3.0))));
      gEmit += arch * (1.0 - shop) * vec3(0.5, 0.36, 0.22) * 0.25 * smoothstep(6.0, 1.0, y);
    } else if (y < 7.6) {
      col = vec3(0.9, 0.88, 0.82); // антаблемент
    } else if (y < top - 1.4) {
      float arch = step(d, 0.28) * step(8.0, y) * step(y, top - 3.6 + 1.2 * sqrt(max(0.0, 1.0 - pow(d / 0.28, 2.0))));
      col = mix(col, vec3(0.92, 0.9, 0.84), col1);
      col = mix(col, vec3(0.1, 0.11, 0.14), arch);
      lit = step(0.5, hash12(vec2(cell, 9.0)));
      gEmit += arch * lit * vec3(1.0, 0.8, 0.55) * 0.35;
    } else {
      // Балюстрада.
      float bal = step(0.5, fract(u * 3.0));
      col = mix(vec3(0.9, 0.88, 0.82), vec3(0.2), bal * step(top - 1.25, y) * step(y, top - 0.75));
    }
  } else if (vPreset < 11.5) {
    // Дом Зингера: тёмный гранит, вертикальные эркеры с большими окнами, сияющий книжный внизу.
    float bay = 3.2;
    float fx = fract(u / bay);
    float d = abs(fx - 0.5);
    float cell = floor(u / bay);
    col = wall * 0.85;
    if (y < 5.2) {
      float glass = step(d, 0.44) * step(0.3, y) * step(y, 4.8);
      float mull = step(d, 0.01) + step(abs(y - 3.7), 0.05);
      col = mix(col, vec3(0.1), glass);
      gEmit += glass * (1.0 - min(1.0, mull)) * vec3(1.0, 0.86, 0.62) * 0.75;
    } else if (y < top - 1.2) {
      float fy = mod(y - 5.2, 3.6);
      float win = step(d, 0.38) * step(0.35, fy) * step(fy, 3.2);
      float pier = step(0.43, d);
      col = mix(col, wall * 1.15, pier);
      col = mix(col, vec3(0.08, 0.09, 0.12), win);
      col = mix(col, vec3(0.5, 0.45, 0.35), win * (step(d, 0.012) + step(abs(fy - 2.3), 0.04)));
      lit = step(0.35, hash12(vec2(cell, floor((y - 5.2) / 3.6)) + 4.0));
      gEmit += win * lit * mix(vec3(1.0, 0.85, 0.6), vec3(0.75, 0.85, 1.0), step(0.6, hash12(vec2(cell, 2.0)))) * 0.42;
    }
  } else if (vPreset < 12.5) {
    // Пассаж: светлый фасад, большие арочные окна второго этажа.
    float bay = 4.2;
    float fx = fract(u / bay);
    float d = abs(fx - 0.5);
    float cell = floor(u / bay);
    col = wall;
    if (y < 4.6) {
      float shop = step(d, 0.4) * step(0.3, y) * step(y, 3.9);
      col = mix(col, vec3(0.1), shop);
      gEmit += shop * vec3(1.0, 0.82, 0.55) * 0.6;
    } else if (y < 10.0) {
      float arch = step(d, 0.3) * step(5.2, y) * step(y, 8.4 + 1.2 * sqrt(max(0.0, 1.0 - pow(d / 0.3, 2.0))));
      col = mix(col, vec3(0.1, 0.11, 0.13), arch);
      gEmit += arch * vec3(1.0, 0.82, 0.58) * 0.45;
    } else if (y < top - 1.2) {
      float fy = mod(y - 10.0, 3.6);
      float win = step(d, 0.2) * step(0.8, fy) * step(fy, 2.9);
      col = mix(col, vec3(0.1, 0.11, 0.14), win);
      lit = step(0.5, hash12(vec2(cell, floor(y / 3.6))));
      gEmit += win * lit * vec3(1.0, 0.75, 0.45) * 0.4;
    }
  } else {
    // Башня думы: терракота, белые пояса, узкие арочные окна.
    float fy = mod(y, 4.0);
    float fx = fract(u / 2.2);
    float d = abs(fx - 0.5);
    col = wall;
    col = mix(col, vec3(0.9, 0.88, 0.84), step(3.6, fy));
    float win = step(d, 0.14) * step(0.8, fy) * step(fy, 2.6 + 0.5 * sqrt(max(0.0, 1.0 - pow(d / 0.14, 2.0))));
    col = mix(col, vec3(0.08), win);
    gEmit += win * vec3(1.0, 0.78, 0.5) * 0.3 * step(0.5, hash12(vec2(floor(u / 2.2), floor(y / 4.0))));
    // Подсветка башни снизу.
    gEmit += col * vec3(1.0, 0.8, 0.6) * 0.25;
  }
  // Архитектурная подсветка фасада (как у этих домов ночью в жизни).
  float flood = vPreset < 10.5 ? 0.55 : vPreset < 11.5 ? 0.12 : vPreset < 12.5 ? 0.35 : 0.0;
  gEmit += col * vec3(1.0, 0.86, 0.66) * flood * (0.6 + 0.4 * smoothstep(top, 0.0, y));
`;

// Центральный портик Казанского собора (из кубиков) над серединой колоннады,
// обращённой к Невскому (точка контура, ближайшая к оси проспекта).
function addPediment(map, scene, colliders) {
  const kazan = map.buildings.find((b) => b.name === 'Казанский собор' && b.o.length > 50);
  const nevsky = map.roads.filter((r) => r.name === 'Невский проспект' && r.kind === 'drive');
  if (!kazan || !nevsky.length) return;
  // Луч от купола к ближайшей точке Невского: первое пересечение с контуром со стороны проспекта —
  // середина колоннады.
  const dome = map.buildings.find((b) => b.roof === 'dome' && b.o.some((p) => Math.hypot(p[0] - kazan.o[0][0], p[1] - kazan.o[0][1]) < 120));
  if (!dome) return;
  const dc = dome.o.reduce((acc, p) => [acc[0] + p[0] / dome.o.length, acc[1] + p[1] / dome.o.length], [0, 0]);
  let np = null;
  let nd = Infinity;
  for (const r of nevsky) for (const p of r.p) {
    const d = Math.hypot(p[0] - dc[0], p[1] - dc[1]);
    if (d < nd) { nd = d; np = p; }
  }
  let best = null;
  let bt = Infinity;
  for (let i = 0; i < kazan.o.length; i++) {
    const a = kazan.o[i], c = kazan.o[(i + 1) % kazan.o.length];
    const rx = np[0] - dc[0], rz = np[1] - dc[1], sx = c[0] - a[0], sz = c[1] - a[1];
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - dc[0]) * sz - (a[1] - dc[1]) * sx) / den;
    const u = ((a[0] - dc[0]) * rz - (a[1] - dc[1]) * rx) / den;
    if (u < 0 || u > 1 || t < 0) continue;
    const dist = Math.abs(1 - t); // ближе всего к Невскому
    if (dist < bt) { bt = dist; best = { m: [dc[0] + rx * t, dc[1] + rz * t], a, c }; }
  }
  if (!best) return;
  const { m, a, c } = best;
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L; // наружу
  colliders.push(...addVoxelPortico(scene, m, nx, nz));
}

function addClocks(list, scene) {
  if (!list.length) return;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#f4ecd2';
  c.beginPath();
  c.arc(32, 32, 30, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#2a2420';
  c.lineWidth = 3;
  c.stroke();
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(32, 32); c.lineTo(32, 12); // минутная
  c.moveTo(32, 32); c.lineTo(45, 38); // часовая
  c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.3, 1.25, 1.1) });
  for (const b of list) {
    for (let i = 0; i < b.o.length; i++) {
      const a = b.o[i], q = b.o[(i + 1) % b.o.length];
      const L = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (L < 2) continue;
      const nx = (q[1] - a[1]) / L, nz = -(q[0] - a[0]) / L;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(Math.min(1.4, L * 0.32), 20), mat);
      disc.position.set((a[0] + q[0]) / 2 + nx * 0.06, b.h - 7, (a[1] + q[1]) / 2 + nz * 0.06);
      disc.rotation.y = Math.atan2(nx, nz);
      scene.add(disc);
    }
    // Шпиль над башней.
    let cx = 0, cz = 0;
    for (const [x, z] of b.o) { cx += x; cz += z; }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.6, 9, 6), new THREE.MeshLambertMaterial({ color: 0x3b4a45, emissive: 0x2a2a22 }));
    spire.position.set(cx / b.o.length, b.h + 4.5, cz / b.o.length);
    scene.add(spire);
  }
}

function facadeMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const patched = patchMaterial(m, {
    emissive: true,
    vertexHeader: 'attribute vec4 aInfo; attribute vec3 aColor; attribute vec2 aUv; attribute float aPreset; varying vec4 vInfo; varying vec2 vUv2; varying vec3 vCol; varying vec3 vWN; varying float vPreset;',
    vertexMain: 'vInfo = aInfo; vUv2 = aUv; vCol = aColor; vPreset = aPreset; vWN = normalize(mat3(modelMatrix) * objectNormal);',
    header: 'varying vec4 vInfo; varying vec2 vUv2; varying vec3 vCol; varying vec3 vWN; varying float vPreset;',
    colorCode: /* glsl */ `
      vec3 wall = vCol;
      float top = vInfo.x;
      float seed = vInfo.z;
      float kind = vInfo.w;
      float u = vUv2.x;
      float y = vUv2.y;
      float grime = fbm(vec2(u * 0.15, y * 0.3) + seed * 40.0);
      if (kind > 0.5 && kind < 1.5) {
        // Крыша под снегом.
        col = vec3(0.88, 0.89, 0.94) * (0.93 + 0.07 * fbm(vWorld.xz * 0.3));
        gEmit = col * cityLight(vWorld.xz) * 0.25;
      } else {
        wall *= 0.86 + 0.2 * grime;
        // Цоколь темнее и с грязью от реагентов.
        wall *= mix(0.72, 1.0, smoothstep(0.0, 0.8, y));
        col = wall;
        // Фонари и витрины подсвечивают низ фасада, выше — мягкий отсвет города.
        gEmit = wall * (cityLight(vWorld.xz) * exp(-max(y - 1.0, 0.0) / 9.0) * 1.1 + vec3(0.05, 0.045, 0.06));
        if (kind > 2.5 && kind < 3.5) {
          // Храм: колоннада, антаблемент, цоколь.
          float fx = fract(u / 2.4);
          float column = smoothstep(0.26, 0.3, abs(fx - 0.5)) ;
          float shaft = 1.0 - column;
          float shadeC = 0.75 + 0.35 * sin((fx - 0.5) * 3.1416 / 0.44 * 0.5 + 1.57);
          vec3 stone = wall * 1.05;
          col = mix(stone * 0.12, stone * shadeC, shaft); // между колоннами — глубина галереи
          float entab = step(top - 4.0, y);
          col = mix(col, stone * (0.95 - 0.12 * step(fract((y - top) / 1.3), 0.12)), entab);
          col = mix(col, stone * 0.8, step(y, 1.4));
          col = mix(col, vec3(0.9, 0.9, 0.95), step(top - 4.1, y) * step(y, top - 3.95));
          // Архитектурная подсветка: тёплые прожекторы снизу.
          gEmit += col * vec3(1.0, 0.82, 0.6) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, top, y))) * (0.4 + 0.6 * shaft);
        } else if (kind > 3.5) {
          // Карниз и тяга: чуть светлее стены, сверху снег.
          col = wall * 1.12;
          col = mix(col, vec3(0.88, 0.89, 0.94), smoothstep(0.6, 0.9, vWN.y));
          gEmit = col * (cityLight(vWorld.xz) * exp(-max(y - 1.0, 0.0) / 9.0) + vec3(0.05, 0.045, 0.06));
        } else if (kind < 0.5 && vPreset > 9.5 && vPreset < 13.5) {
          ${PRESETS_GLSL}
        } else if (kind < 0.5) {
          float floorH = 3.8;
          float groundH = 4.6;
          float corniceY = top - 1.1; // низ настоящего (геометрического) карниза
          // Стиль дома: 0 доходный с сандриками, 1 классицизм с пилястрами, 2 модерн с арками, 3 эклектика с балконами.
          float style = vPreset > 13.5 ? 0.0 : floor(fract(seed * 7.0) * 4.0);

          float spacing = 2.7 + fract(seed * 13.0) * 0.5;
          float cell = floor(u / spacing);
          float fx = fract(u / spacing);
          float lit = hash12(vec2(cell, floor(y / floorH)) + seed * 91.0);
          if (y < groundH && vPreset > 13.5) {
            // Вестибюль метро (как в жизни): бирюзовая стена, узкие арочные двери в белых наличниках,
            // внутри тёплый свет; между дверями — гладкая стена.
            float bay = 4.0;
            float ax = fract(u / bay);
            float d = abs(ax - 0.5);
            float archTop = 2.7 + 0.55 * sqrt(max(0.0, 1.0 - pow(d / 0.2, 2.0)));
            float door = step(d, 0.2) * step(0.1, y) * step(y, archTop);
            float trim = step(d, 0.26) * step(y, archTop + 0.22) - door;
            col = mix(col, vec3(0.9, 0.92, 0.94), trim);
            col = mix(col, vec3(0.06), door);
            gEmit += door * vec3(1.0, 0.85, 0.62) * 0.45 * smoothstep(0.1, 1.5, y);
            gEmit += trim * vec3(0.5, 0.55, 0.6) * 0.15;
          } else if (y < groundH) {
            // Первый этаж: руст и большие витрины.
            float rust = step(0.92, fract(y / 0.55));
            col = mix(col, col * 0.75, rust);
            float shop = step(0.12, fx) * step(fx, 0.88) * step(0.35, y) * step(y, 3.6);
            vec3 glass = mix(vec3(0.05, 0.055, 0.07), vec3(0.16, 0.17, 0.2), smoothstep(0.35, 3.6, y));
            col = mix(col, glass, shop);
            // Витрина: рама, фрамуга сверху, внутри — силуэты товаров и полок.
            float mull = step(abs(fx - 0.5), 0.012) + step(abs(y - 2.85), 0.035);
            float goods = step(0.45, vnoise(vec2(u * 3.0, floor(y * 2.2)) + seed * 17.0)) * step(y, 2.4) * step(0.6, y);
            float shelf = step(fract(y * 2.2), 0.08) * step(y, 2.4);
            vec3 shopLight = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.9, 0.75), hash12(vec2(cell, 7.0) + seed));
            float inside = shop * (1.0 - min(1.0, mull)) * (1.0 - goods * 0.6) * (1.0 - shelf * 0.5);
            // Глубина проёма: тень от верхнего откоса.
            inside *= 1.0 - 0.5 * step(3.35, y);
            col = mix(col, vec3(0.1), shop * min(1.0, mull));
            gEmit += inside * shopLight * (0.4 + 0.3 * smoothstep(3.6, 0.35, y)) * step(0.25, lit);
            // Тень под межэтажной тягой.
            col *= 1.0 - 0.35 * smoothstep(4.0, 4.5, y) * (1.0 - shop);
          } else if (y < corniceY) {
            float fy = mod(y - groundH, floorH);
            float floorN = floor((y - groundH) / floorH);
            float dxw = abs(fx - 0.5);
            // Верх окна: у модерна — арка.
            float winTop = style == 2.0 ? 2.5 + 0.4 * sqrt(max(0.0, 1.0 - pow(dxw / 0.18, 2.0))) : 2.9;
            float win = step(dxw, 0.18) * step(0.9, fy) * step(fy, winTop);
            float frame = step(dxw, 0.2) * step(0.8, fy) * step(fy, winTop + 0.12) - win;
            float sill = step(dxw, 0.22) * step(0.72, fy) * step(fy, 0.86);
            float mullion = win * (step(dxw, 0.012) + step(abs(fy - 2.2), 0.04));
            vec3 glass = mix(vec3(0.1, 0.11, 0.14), vec3(0.34, 0.35, 0.4), smoothstep(0.9, 2.9, fy) * 0.6);
            // Окна живут: у каждого свой период, иногда свет гаснет или зажигается.
            float period = 25.0 + lit * 70.0;
            float epoch = floor((uTime + lit * 997.0) / period);
            float on = step(0.5, hash12(vec2(cell * 1.7 + epoch, floor(y / floorH) + seed * 31.0)));

            // Пилястры (классицизм): светлые с тенью сбоку — читаются как выступ.
            if (style == 1.0) {
              float px = min(fx, 1.0 - fx);
              float pil = step(px, 0.07);
              col = mix(col, wall * 1.12, pil);
              col = mix(col, wall * 0.62, step(0.07, px) * step(px, 0.1) * step(0.5, fx));
            }
            // Сандрики над окнами: светлый верх, тёмная тень под ним; у эклектики — фронтончики.
            if (style == 0.0 || style == 3.0) {
              float h0 = winTop + 0.16;
              float tri = style == 3.0 && mod(floorN, 2.0) == 0.0 ? 0.3 * (1.0 - dxw / 0.25) : 0.12;
              float crown = step(dxw, 0.25) * step(h0, fy) * step(fy, h0 + max(0.06, tri));
              col = mix(col, wall * 1.2, crown);
              col = mix(col, wall * 0.55, step(dxw, 0.25) * step(h0 - 0.06, fy) * step(fy, h0));
            }
            // Балкон (эклектика): плита и решётка на втором этаже в середине фасада.
            if (style == 3.0 && floorN == 0.0 && mod(cell, 5.0) == 2.0) {
              float slab = step(dxw, 0.42) * step(0.55, fy) * step(fy, 0.7);
              float bars = step(dxw, 0.42) * step(0.7, fy) * step(fy, 1.6) * (step(fract(fx * 22.0), 0.25) + step(1.5, fy));
              col = mix(col, vec3(0.12), max(slab * 0.7, min(1.0, bars) * 0.85));
              col = mix(col, vec3(0.88, 0.89, 0.94), step(dxw, 0.42) * step(0.68, fy) * step(fy, 0.72));
            }

            col = mix(col, vPreset > 13.5 ? vec3(0.88, 0.9, 0.92) : wall * 1.15, frame);
            col = mix(col, glass, win);
            col = mix(col, vec3(0.92), mullion * 0.9);
            col = mix(col, vec3(0.9, 0.9, 0.95), sill);
            // Глубина окна: тень от верхнего и левого откоса.
            float reveal = win * max(step(winTop - 0.22, fy), step(dxw, 0.18) * step(fx, 0.36));
            col *= 1.0 - 0.45 * reveal;
            // Тень под карнизом.
            col *= 1.0 - 0.45 * smoothstep(corniceY - 0.8, corniceY, y);
            if (vPreset > 13.5) gEmit += col * vec3(0.55, 0.75, 0.85) * 0.22; // фасад вестибюля подсвечен
            float tint = hash12(vec2(cell, floor(y / floorH)) + seed * 13.0);
            vec3 wc = tint < 0.12 ? vec3(0.55, 0.7, 1.0) : mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.6), tint);
            float curtain = smoothstep(0.32, 0.4, fx) * smoothstep(0.68, 0.6, fx);
            gEmit += win * (1.0 - mullion) * on * wc * (0.35 + 0.45 * curtain) * (1.0 - 0.5 * reveal);
          }
        }
      }
    `,
  });
  // Храмы (подсвеченные ориентиры) туман съедает слабее — Казанский видно с Невского издалека.
  const base = patched.onBeforeCompile;
  patched.onBeforeCompile = (sh) => {
    base(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        float fogD = fogDensity * (vInfo.w > 2.5 && vInfo.w < 3.5 ? 0.45 : 1.0);
        float fogFactor = 1.0 - exp(-pow(fogD * vFogDepth, 2.0));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      #endif`);
  };
  return patched;
}

function addDomes(list, scene) {
  const mats = {
    onion: new THREE.MeshLambertMaterial({ color: 0xd8b25a, emissive: 0xa07a28, emissiveIntensity: 1.2 }), // золото
    // Позеленевшая медь (как у Казанского), подсвечена снизу.
    dome: new THREE.MeshLambertMaterial({ color: 0x3f7a5c, emissive: 0x2f6a4c, emissiveIntensity: 1.1 }),
    round: new THREE.MeshLambertMaterial({ color: 0x7c938a, emissive: 0x8a7a62, emissiveIntensity: 1.6 }),
    cone: new THREE.MeshLambertMaterial({ color: 0x4f5a63 }),
    pyramidal: new THREE.MeshLambertMaterial({ color: 0x5b6670 }),
    globe: new THREE.MeshLambertMaterial({ color: 0x4a6a86, emissive: 0x5a8ab0, emissiveIntensity: 1.4, flatShading: true }),
  };
  // Подсвеченные купола видны над крышами издалека: туман на них слабее.
  for (const m of Object.values(mats)) {
    m.customProgramCacheKey = () => 'landmark-fog';
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          float fogFactor = 1.0 - exp(-pow(fogDensity * 0.4 * vFogDepth, 2.0));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #endif`);
    };
  }
  for (const { b, top } of list) {
    let area = 0;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of b.o) { cx += x; cz += z; }
    cx /= b.o.length;
    cz /= b.o.length;
    for (let i = 0; i < b.o.length; i++) {
      const [x1, z1] = b.o[i];
      const [x2, z2] = b.o[(i + 1) % b.o.length];
      area += x1 * z2 - x2 * z1;
    }
    const r = Math.sqrt(Math.abs(area / 2) / Math.PI);
    const h = b.rh ?? { onion: r * 1.7, dome: r * 0.9, round: r, cone: r * 2.2, pyramidal: r * 0.8, globe: r * 2 }[b.roof];
    const prof = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let w;
      if (b.roof === 'onion') w = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 + 0.35 * Math.sin(Math.PI * t)) * (1 - t * 0.2);
      else if (b.roof === 'cone' || b.roof === 'pyramidal') w = 1 - t;
      else if (b.roof === 'globe') w = Math.sin(Math.PI * t) * (h / 2 / r);
      else w = Math.cos((t * Math.PI) / 2);
      prof.push(new THREE.Vector2(Math.max(0.01, w * r), t * h));
    }
    const geo = new THREE.LatheGeometry(prof, b.roof === 'pyramidal' ? 4 : b.roof === 'globe' ? 14 : 24);
    const mesh = new THREE.Mesh(geo, mats[b.roof]);
    mesh.position.set(cx, top, cz);
    scene.add(mesh);
    // Крест/шпиль.
    if (b.roof === 'onion' || b.roof === 'dome' || b.roof === 'globe') {
      // Шпиль с крестом.
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, r * 0.8, 6), mats.onion);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(r * 0.35, 0.12, 0.12), mats.onion);
      bar.position.set(cx, top + h + r * 0.62, cz);
      scene.add(bar);
      spire.position.set(cx, top + h + r * 0.4, cz);
      scene.add(spire);
    }
  }
}
