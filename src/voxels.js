// Блочные детали: кубики 40 см, наружу — только видимые грани.
// Свет «запечён» в цвет вершин: грань по стороне света + подсветка снизу, сверху снег.
import * as THREE from 'three';

const S = 0.4; // ребро кубика, м

// Грани куба: направление соседа, 4 угла (против часовой снаружи), яркость грани.
const FACES = [
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], k: 1.0 },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], k: 0.45 },
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], k: 0.72 },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], k: 0.72 },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], k: 0.9 }, // к зрителю (наружу от стены)
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], k: 0.4 },
];

const key = (x, y, z) => `${x},${y},${z}`;

// vox: Map key → [r, g, b]. light(y) — множитель подсветки по высоте (в кубиках).
function voxelGeometry(vox, light) {
  const pos = [], col = [], idx = [];
  for (const [k, c] of vox) {
    const [x, y, z] = k.split(',').map(Number);
    // Лёгкий разброс оттенка у каждого кубика — фактура камня.
    const jit = 0.92 + 0.16 * ((Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1 + 1) % 1;
    for (const f of FACES) {
      if (vox.has(key(x + f.d[0], y + f.d[1], z + f.d[2]))) continue;
      const snow = f.d[1] === 1 && c !== GLASS;
      const base = snow ? [0.86, 0.88, 0.94] : c;
      const m = snow ? 0.8 : f.k * jit * light(y);
      const n = pos.length / 3;
      for (const [cx, cy, cz] of f.c) {
        pos.push((x + cx) * S, (y + cy) * S, (z + cz) * S);
        col.push(base[0] * m, base[1] * m, base[2] * m);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const STONE = [0.78, 0.71, 0.58];
const FRIEZE = [0.7, 0.63, 0.5];
const GLASS = [0.05, 0.05, 0.06]; // глубина за колоннами

// Центральный портик Казанского собора из кубиков. m — середина колоннады на контуре,
// (nx, nz) — наружу от стены. Локально: x — вдоль фасада, z — наружу, y — вверх (в кубиках).
export function addVoxelPortico(scene, m, nx, nz) {
  const vox = new Map();
  const put = (x, y, z, c = STONE) => vox.set(key(x, y, z), c);
  const HW = 28, D = 15; // полуширина и вынос, кубиков (11.2 и 6 м)
  // Ступени стилобата.
  for (let k = 0; k < 3; k++)
    for (let x = -HW - 3 + k; x <= HW + 3 - k; x++)
      for (let z = 0; z <= D + 3 - k; z++) put(x, k, z);
  // Колонны: два ряда по шесть, база и капитель шире ствола.
  const colTop = 46;
  for (const zc of [D - 2, D - 8]) {
    for (let i = 0; i < 6; i++) {
      const xc = Math.round(-HW + 3 + (i * (2 * HW - 6)) / 5);
      for (let y = 3; y <= colTop; y++) {
        const r = y <= 4 ? 3.2 : y >= colTop - 1 ? 3.6 : y >= colTop - 3 ? 2.9 : 2.3;
        for (let dx = -4; dx <= 4; dx++)
          for (let dz = -4; dz <= 4; dz++)
            if (dx * dx + dz * dz <= r * r) put(xc + dx, y, zc + dz);
      }
    }
  }
  // Тёмная глубина галереи за колоннами — чтобы стена не светилась между ними.
  for (let x = -HW; x <= HW; x++) for (let y = 3; y <= colTop; y++) put(x, y, 0, GLASS);
  // Антаблемент: архитрав, фриз (темнее), карниз с выносом.
  for (let y = colTop + 1; y <= colTop + 9; y++) {
    const out = y >= colTop + 8 ? 1 : 0;
    for (let x = -HW - out; x <= HW + out; x++)
      for (let z = 0; z <= D + out; z++) put(x, y, z, y >= colTop + 4 && y <= colTop + 6 ? FRIEZE : STONE);
  }
  // Фронтон: ступенчатый треугольник, тимпан утоплен, рама выступает.
  const y0 = colTop + 10;
  for (let r = 0; ; r++) {
    const hw = HW + 1 - r * 2;
    if (hw < 0) break;
    for (let x = -hw; x <= hw; x++) {
      const frame = r === 0 || Math.abs(x) > hw - 2;
      for (let z = 0; z <= (frame ? D + 1 : D - 1); z++) put(x, y0 + r, z);
    }
  }
  const top = y0 + HW / 2;
  // Архитектурная подсветка: тёплые прожекторы снизу, кверху слабее.
  const warm = [1.0, 0.86, 0.66];
  const light = (y) => 1.0 + 0.3 * (1 - y / top);
  const geo = voxelGeometry(vox, light);
  const c = geo.attributes.color;
  // Яркость не выше порога bloom (0.9) — иначе вблизи портик светится на весь экран.
  for (let i = 0; i < c.count; i++) {
    const r = c.getX(i) * warm[0], g = c.getY(i) * warm[1], b = c.getZ(i) * warm[2];
    const k = Math.min(1, 0.8 / Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 1e-6));
    c.setXYZ(i, r * k, g * k, b * k);
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  // Базис: X = вдоль фасада, Z = наружу (правая тройка).
  const X = new THREE.Vector3(nz, 0, -nx), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(nx, 0, nz);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(X, Y, Z).setPosition(m[0], 0, m[1]);
  scene.add(mesh);
  // Контур стилобата — препятствие (отрезки [x1, z1, x2, z2]).
  const w = (HW + 3) * S, d = (D + 3) * S;
  const pt = (x, z) => [m[0] + X.x * x + Z.x * z, m[1] + X.z * x + Z.z * z];
  const ring = [pt(-w, 0), pt(-w, d), pt(w, d), pt(w, 0)];
  return ring.slice(1).map((q, i) => [...ring[i], ...q]);
}
