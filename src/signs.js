// Вывески: названия заведений из OSM на ближайшем уличном фасаде.
// Логотипы не используем — только текст, стиль зависит от категории.

import * as THREE from 'three';

const CELL_W = 384, CELL_H = 72;
const ATLAS_W = 1920, ATLAS_H = 4032; // 5 × 56 ячеек
const PER_ATLAS = (ATLAS_W / CELL_W) * (ATLAS_H / CELL_H);
const SIGN_H = 0.72;
const SIGN_Y = 4.1;

const STYLES = [
  [/amenity:cafe/, { bg: '#2f4a3a', fg: '#f1e6c8', font: 'italic 600 40px Georgia, serif' }],
  [/amenity:restaurant/, { bg: '#5a1e24', fg: '#e8c77a', font: '600 40px Georgia, serif' }],
  [/amenity:(bar|pub|nightclub)/, { bg: '#1d1a1a', fg: '#ff9a3c', font: '800 40px "Arial Black", sans-serif', up: true }],
  [/amenity:fast_food/, { bg: '#c8102e', fg: '#ffd84a', font: '800 40px Arial, sans-serif' }],
  [/shop:(clothes|shoes|fashion|bag|boutique)/, { bg: '#121214', fg: '#ffffff', font: '300 38px "Helvetica Neue", Arial, sans-serif', up: true, track: 4 }],
  [/shop:jewelry|shop:watches/, { bg: '#141414', fg: '#d4af37', font: '500 38px Georgia, serif', up: true, track: 3 }],
  [/amenity:bank|amenity:bureau_de_change/, { bg: '#123c7a', fg: '#ffffff', font: '700 38px Arial, sans-serif' }],
  [/amenity:pharmacy|shop:chemist/, { bg: '#ffffff', fg: '#1a8f3c', font: '700 38px Arial, sans-serif', cross: true }],
  [/shop:(convenience|supermarket|alcohol)/, { bg: '#d9101e', fg: '#ffffff', font: '800 40px Arial, sans-serif' }],
  [/tourism:(hotel|hostel|guest_house|apartment)/, { bg: '#1b2a4a', fg: '#e8d9a8', font: '500 38px Georgia, serif', up: true, track: 2 }],
  [/tourism:(museum|gallery)|amenity:theatre/, { bg: '#e8e2d0', fg: '#3a2a1a', font: '600 36px Georgia, serif' }],
  [/shop:(bakery|confectionery|pastry)/, { bg: '#f3e3c6', fg: '#7a3b1f', font: 'italic 700 40px Georgia, serif' }],
  [/shop:(books|stationery)/, { bg: '#2a2140', fg: '#f0e6ff', font: '600 38px Georgia, serif' }],
  [/shop:(gift|souvenir)/, { bg: '#0f4d5c', fg: '#ffe9b0', font: '700 38px Arial, sans-serif' }],
];
const DEFAULT = { bg: '#2b2d33', fg: '#f2f2f2', font: '600 38px Arial, sans-serif' };

const styleOf = (cat) => STYLES.find(([re]) => re.test(cat))?.[1] ?? DEFAULT;

export function buildSigns(map, facades, scene) {
  const placed = place(map.pois, facades);
  const atlases = [];
  const groups = [];
  placed.forEach((s, i) => {
    const ai = Math.floor(i / PER_ATLAS);
    if (!atlases[ai]) {
      const cv = document.createElement('canvas');
      cv.width = ATLAS_W;
      cv.height = ATLAS_H;
      atlases[ai] = cv.getContext('2d');
      groups[ai] = { pos: [], nrm: [], uv: [] };
    }
    const k = i % PER_ATLAS;
    const cx = (k % (ATLAS_W / CELL_W)) * CELL_W;
    const cy = Math.floor(k / (ATLAS_W / CELL_W)) * CELL_H;
    const st = styleOf(s.cat);
    const usedW = drawSign(atlases[ai], cx, cy, s.name, st);
    s.glow = glowOf(st);
    s.w = SIGN_H * (usedW / CELL_H);
    quad(groups[ai], s, cx / ATLAS_W, (cx + usedW) / ATLAS_W, 1 - (cy + CELL_H) / ATLAS_H, 1 - cy / ATLAS_H);
  });

  atlases.forEach((ctx, ai) => {
    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(groups[ai].pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(groups[ai].nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(groups[ai].uv, 2));
    // Ночью вывески светятся сами; яркость > 1 подхватывает bloom.
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.2, 1.2, 1.2) });
    scene.add(new THREE.Mesh(g, mat));
  });
  return placed;
}

// Цвет отсвета на снегу — от более яркого из фона и текста.
function glowOf(st) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [a, b] = [lum(st.bg), lum(st.fg)];
  const pick = a[0] + a[1] + a[2] > b[0] + b[1] + b[2] ? a : b;
  return pick.join(',');
}

// Раскладка: ближайший фасад в пределах 22 м, без наложений на одном фасаде.
function place(pois, facades) {
  const occupied = new Map();
  const out = [];
  const seen = new Set();
  for (const poi of pois) {
    const key = poi.name + '|' + Math.round(poi.p[0] / 30) + '|' + Math.round(poi.p[1] / 30);
    if (seen.has(key)) continue;
    seen.add(key);
    let best = null;
    let bd = 22;
    for (const f of facades) {
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1];
      const t = Math.max(0, Math.min(1, ((poi.p[0] - f.a[0]) * dx + (poi.p[1] - f.a[1]) * dz) / (f.L * f.L)));
      const qx = f.a[0] + dx * t, qz = f.a[1] + dz * t;
      const d = Math.hypot(poi.p[0] - qx, poi.p[1] - qz);
      // Точка должна быть внутри здания или перед фасадом, а не позади него.
      if (d < bd) {
        bd = d;
        best = { f, t };
      }
    }
    if (!best) continue;
    const { f } = best;
    const w = Math.min(f.L - 0.6, estimateWidth(poi.name));
    if (w < 1.2) continue;
    let c = Math.max(w / 2 + 0.3, Math.min(f.L - w / 2 - 0.3, best.t * f.L));
    const occ = occupied.get(f) ?? [];
    // Сдвигаем вдоль фасада, пока не найдём свободное место.
    let ok = false;
    for (let tries = 0; tries < 12 && !ok; tries++) {
      const shift = (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * (w * 0.55);
      const cc = c + shift;
      if (cc - w / 2 < 0.3 || cc + w / 2 > f.L - 0.3) continue;
      if (occ.every(([a, b]) => cc + w / 2 + 0.4 < a || cc - w / 2 - 0.4 > b)) {
        c = cc;
        ok = true;
      }
    }
    if (!ok) continue;
    occ.push([c - w / 2, c + w / 2]);
    occupied.set(f, occ);
    out.push({ ...poi, f, c });
  }
  return out;
}

function estimateWidth(name) {
  return Math.min(CELL_W / CELL_H, 0.6 + name.length * 0.24) * SIGN_H;
}

let measure;
function drawSign(ctx, x, y, name, st) {
  measure ??= document.createElement('canvas').getContext('2d');
  const text = st.up ? name.toUpperCase() : name;
  ctx.save();
  ctx.font = st.font;
  if (st.track) ctx.letterSpacing = st.track + 'px';
  const pad = 22 + (st.cross ? 50 : 0);
  const tw = ctx.measureText(text).width;
  const w = Math.min(CELL_W, Math.max(CELL_H * 1.6, tw + pad * 2));
  ctx.fillStyle = st.bg;
  ctx.fillRect(x, y, w, CELL_H);
  // Тонкая рамка и снежок по верхнему краю.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 3, y + 3, w - 6, CELL_H - 6);
  ctx.fillStyle = 'rgba(240,242,248,0.95)';
  ctx.fillRect(x, y, w, 5);
  if (st.cross) {
    ctx.fillStyle = st.fg;
    ctx.fillRect(x + 22, y + 30, 36, 12);
    ctx.fillRect(x + 34, y + 18, 12, 36);
  }
  ctx.fillStyle = st.fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const avail = w - pad * 2;
  const cx = x + pad + avail / 2 + (st.cross ? 0 : 0);
  ctx.translate(cx, y + CELL_H / 2 + 2);
  if (tw > avail) ctx.scale(avail / tw, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
  return w;
}

function quad(g, s, u0, u1, v0, v1) {
  const { f, c, w } = s;
  const dx = (f.b[0] - f.a[0]) / f.L, dz = (f.b[1] - f.a[1]) / f.L;
  const [nx, nz] = f.n;
  const ox = f.a[0] + dx * c + nx * 0.14, oz = f.a[1] + dz * c + nz * 0.14;
  // Смотрим на фасад снаружи: правая сторона — против направления обхода.
  const lx = ox + dx * (w / 2), lz = oz + dz * (w / 2);
  const rx = ox - dx * (w / 2), rz = oz - dz * (w / 2);
  const y0 = SIGN_Y - SIGN_H / 2, y1 = SIGN_Y + SIGN_H / 2;
  const v = [
    [lx, y0, lz, u0, v0], [rx, y0, rz, u1, v0], [rx, y1, rz, u1, v1],
    [lx, y0, lz, u0, v0], [rx, y1, rz, u1, v1], [lx, y1, lz, u0, v1],
  ];
  // Обход треугольников под наружную нормаль.
  for (let i = 0; i < 6; i += 3) {
    const [a, b, cc] = [v[i], v[i + 1], v[i + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = cc[0] - a[0], wy = cc[1] - a[1], wz = cc[2] - a[2];
    const cxn = uy * wz - uz * wy, czn = ux * wy - uy * wx;
    if (cxn * nx + czn * nz < 0) {
      v[i + 1] = cc;
      v[i + 2] = b;
    }
  }
  for (const p of v) {
    g.pos.push(p[0], p[1], p[2]);
    g.nrm.push(nx, 0, nz);
    g.uv.push(p[3], p[4]);
  }
}
