// Карта городского света: тёплые пятна от фонарей, свет витрин на тротуарах,
// цветные отсветы вывесок. Одна текстура вместо сотен настоящих источников.

import * as THREE from 'three';
import { LIGHT_UNIFORMS } from './shaders.js';

const SIZE = 1024;

// extra — [{ p, r?, a?, rgb? }]: метро, остановки.
export function buildLightMap(map, facades, signs, extra = []) {
  const [x0, z0, x1, z1] = map.ext;
  const sx = SIZE / (x1 - x0);
  const sz = SIZE / (z1 - z0);
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const c = cv.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, SIZE, SIZE);
  c.globalCompositeOperation = 'lighter';
  const X = (x) => (x - x0) * sx;
  const Z = (z) => (z - z0) * sz;
  // Стены домов — препятствия для света (иначе фонарь со двора светит сквозь дом на улицу).
  const edges = new Map();
  const CELL = 16;
  const key = (i, j) => i * 100003 + j;
  for (const bld of map.buildings) {
    if (bld.mh > 2 || bld.h < 2.5) continue;
    for (const ring of [bld.o, ...bld.i]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], q = ring[(i + 1) % ring.length];
        const i0 = Math.floor(Math.min(a[0], q[0]) / CELL), i1 = Math.floor(Math.max(a[0], q[0]) / CELL);
        const j0 = Math.floor(Math.min(a[1], q[1]) / CELL), j1 = Math.floor(Math.max(a[1], q[1]) / CELL);
        for (let ci = i0; ci <= i1; ci++) {
          for (let cj = j0; cj <= j1; cj++) {
            const k = key(ci, cj);
            if (!edges.has(k)) edges.set(k, []);
            edges.get(k).push([a, q]);
          }
        }
      }
    }
  }
  const nearEdges = (x, z, r) => {
    const out = new Set();
    for (let ci = Math.floor((x - r) / CELL); ci <= Math.floor((x + r) / CELL); ci++) {
      for (let cj = Math.floor((z - r) / CELL); cj <= Math.floor((z + r) / CELL); cj++) {
        for (const e of edges.get(key(ci, cj)) ?? []) out.add(e);
      }
    }
    return out;
  };
  // Пятно света рисуется на отдельном холсте, из него вырезаются тени стен, потом — на карту.
  const tmp = document.createElement('canvas');
  const t = tmp.getContext('2d');
  // dir — если задано, пятно вытягивается поперёк dir (вдоль улицы) и сжимается по dir.
  const blob = (x, z, r, rgb, a, dir = null, hard = false) => {
    const px = Math.ceil(r * 2 * sx) + 2;
    tmp.width = tmp.height = px;
    const cx = px / 2, cz = px / 2;
    t.save();
    t.translate(cx, cz);
    if (dir) {
      t.rotate(Math.atan2(dir[1], dir[0]));
      t.scale(0.6, 1); // по направлению к дороге уже, вдоль улицы шире
    }
    const g = t.createRadialGradient(0, 0, 0, 0, 0, r * sx);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    if (hard) {
      g.addColorStop(0.55, `rgba(${rgb},${a * 0.75})`);
      g.addColorStop(0.85, `rgba(${rgb},${a * 0.2})`);
    }
    g.addColorStop(1, `rgba(${rgb},0)`);
    t.fillStyle = g;
    t.fillRect(-px, -px, px * 2, px * 2);
    t.restore();
    t.globalCompositeOperation = 'destination-out';
    t.fillStyle = '#000';
    const L = (wx, wz) => [cx + (wx - x) * sx, cz + (wz - z) * sz];
    for (const [a, q] of nearEdges(x, z, r)) {
      // Тень стены: от отрезка вдаль, прочь от источника.
      const far = (p) => {
        const dx = p[0] - x, dz = p[1] - z;
        const l = Math.hypot(dx, dz) || 1;
        return [p[0] + (dx / l) * r * 3, p[1] + (dz / l) * r * 3];
      };
      const fa = far(a), fq = far(q);
      t.beginPath();
      t.moveTo(...L(a[0], a[1]));
      t.lineTo(...L(q[0], q[1]));
      t.lineTo(...L(fq[0], fq[1]));
      t.lineTo(...L(fa[0], fa[1]));
      t.closePath();
      t.fill();
    }
    t.globalCompositeOperation = 'source-over';
    c.drawImage(tmp, X(x) - cx, Z(z) - cz);
  };

  // Витрины: тёплая полоса перед первым этажом.
  c.lineCap = 'round';
  for (const f of facades) {
    if (f.church) continue; // у храмов витрин нет
    const ox = f.n[0] * 1.0, oz = f.n[1] * 1.0;
    c.strokeStyle = 'rgba(255,170,90,0.1)';
    c.lineWidth = 2.4 * sx;
    c.beginPath();
    c.moveTo(X(f.a[0] + ox), Z(f.a[1] + oz));
    c.lineTo(X(f.b[0] + ox), Z(f.b[1] + oz));
    c.stroke();
  }
  // Фонари: лампа на кронштейне светит вниз — пятно под ней, чуть на дорогу.
  for (const [x, z, dx = 0, dz = 0] of map.lamps) {
    blob(x + dx * 1.6, z + dz * 1.6, 7.5, '255,196,120', 0.85, [dx, dz], true);
  }
  // Вывески: отсвет их цвета.
  for (const s of signs) {
    const f = s.f;
    const dx = (f.b[0] - f.a[0]) / f.L, dz = (f.b[1] - f.a[1]) / f.L;
    const x = f.a[0] + dx * s.c + f.n[0] * 2.5;
    const z = f.a[1] + dz * s.c + f.n[1] * 2.5;
    blob(x, z, 4.5 + s.w * 0.6, s.glow, 0.45);
  }

  // Метро и остановки: холодный белый.
  for (const m of extra) blob(m.p[0], m.p[1], m.r ?? 6, m.rgb ?? '200,220,255', m.a ?? 0.45);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  // Строка 0 холста — это z0, как и в шейдере. Без этого свет ложится зеркально по z.
  tex.flipY = false;
  LIGHT_UNIFORMS.uLight.value = tex;
  LIGHT_UNIFORMS.uLightRect.value.set(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0));
  return cv;
}
