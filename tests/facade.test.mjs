import test from 'node:test';
import assert from 'node:assert/strict';
import { homography, kmeans } from '../tools/facade-math.mjs';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('homography: углы и центр квадрата в трапецию', () => {
  const quad = [[10, 20], [110, 30], [100, 200], [0, 180]];
  const H = homography(quad);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
    const [x, y] = H(u, v);
    assert.ok(near(x, quad[i][0]) && near(y, quad[i][1]), `угол ${i}`);
  });
  // Центр — пересечение диагоналей (перспектива сохраняет прямые).
  const [cx, cy] = H(0.5, 0.5);
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  assert.ok(Math.abs(cross(quad[0], quad[2], [cx, cy])) < 1e-6, 'на диагонали 0-2');
  assert.ok(Math.abs(cross(quad[1], quad[3], [cx, cy])) < 1e-6, 'на диагонали 1-3');
});

test('homography: прямоугольник → обычное масштабирование', () => {
  const H = homography([[0, 0], [200, 0], [200, 100], [0, 100]]);
  const [x, y] = H(0.25, 0.5);
  assert.ok(near(x, 50) && near(y, 50));
});

test('kmeans: два явных кластера', () => {
  const px = [...Array(50).fill([250, 10, 10]), ...Array(50).fill([10, 10, 240])];
  const c = kmeans(px, 2).sort((a, b) => a[2] - b[2]);
  assert.deepEqual(c, [[250, 10, 10], [10, 10, 240]]);
});

test('wallInfo: южная стена квадрата — снаружи (с юга) запад слева', async () => {
  const { wallInfo } = await import('../tools/facade-math.mjs');
  // Квадрат 0..10; юг = +z. Ребро (10,10)→(0,10) — южная стена, в любом обходе.
  for (const ring of [[[0, 0], [10, 0], [10, 10], [0, 10]], [[0, 10], [10, 10], [10, 0], [0, 0]]]) {
    const i = ring.findIndex((p, k) => p[1] === 10 && ring[(k + 1) % 4][1] === 10);
    const w = wallInfo(ring, i);
    assert.deepEqual(w.n.map((v) => v + 0), [0, 1], 'нормаль на юг');
    // Стоя на юге лицом на север, слева запад (x=0), справа восток (x=10).
    assert.equal(w.a[0], 0);
    assert.equal(w.b[0], 10);
    assert.equal(w.len, 10);
  }
});

test('combine: прохожий на одном из трёх кадров отбрасывается', async () => {
  const { combine } = await import('../tools/facade-math.mjs');
  const wall = [120, 160, 200], person = [20, 15, 10];
  assert.deepEqual(combine([wall, person, [122, 158, 201]]).map(Math.round), [120, 160, 200]);
  assert.deepEqual(combine([[0, 0, 0], [100, 100, 100]]), [50, 50, 50]);
});

test('findRepeats: находит все окна в ряду по одному образцу', async () => {
  const { findRepeats } = await import('../tools/facade-math.mjs');
  // Стена 100×20, тёмные «окна» 6×10 с центрами 10, 30, 50, 70, 90.
  const W = 100, H = 20, gray = new Array(W * H).fill(200);
  for (const c of [10, 30, 50, 70, 90]) for (let y = 5; y < 15; y++) for (let x = c - 3; x < c + 3; x++) gray[y * W + x] = 30;
  // Образец — второе окно с полями.
  assert.deepEqual(findRepeats(gray, W, 25, 3, 10, 14), [10, 30, 50, 70, 90]);
});

test('fillGrid: достраивает ряд по шагу, неровный оставляет', async () => {
  const { fillGrid } = await import('../tools/facade-math.mjs');
  // Стена 20 м, окна 1.4 м с шагом 4.5: найдены только 2-е и 3-е.
  assert.deepEqual(fillGrid([6.5, 11], 1.4, 20), [2, 6.5, 11, 15.5]);
  // Пропуск в середине (разрыв в два шага) тоже закрывается.
  assert.deepEqual(fillGrid([2, 6.5, 15.5], 1.4, 20), [2, 6.5, 11, 15.5]);
  // Неровные центры — как есть.
  assert.deepEqual(fillGrid([2, 5.8, 11], 1.4, 20), [2, 5.8, 11]);
});

test('wallChain: мелкие выступы фасада — одна стена, поворот за угол — граница', async () => {
  const { wallChain, wallSpan } = await import('../tools/facade-math.mjs');
  // Южный фасад 0..20 с «пилястрами» — выступы 0.2 м, дальше угол на север.
  const ring = [[0, 0], [20, 0], [20, 10], [12, 10], [12, 10.2], [11, 10.2], [11, 10], [0, 10]];
  const { s, e } = wallChain(ring, 4); // ребро выступа
  assert.deepEqual([s, e], [2, 7]); // от угла (20,10) до угла (0,10)
  const w = wallSpan(ring, s, e);
  assert.equal(w.len, 20);
  assert.deepEqual(w.n.map((v) => v + 0), [0, 1]); // наружу — на юг
  // Клик по поперечному ребру выступа — та же стена.
  assert.deepEqual(Object.values(wallChain(ring, 3)), [2, 7]);
});

test('viewCamera: луч пикселя проецируется обратно в тот же пиксель; центр смотрит по азимуту', async () => {
  const { viewCamera, dirToPano } = await import('../tools/facade-math.mjs');
  const cam = viewCamera({ yaw: 130, pitch: 12, fov: 80, W: 1600, H: 1000 });
  for (const [i, j] of [[0, 0], [800, 500], [1500, 900], [321, 77]]) {
    const [x, y] = cam.project(cam.ray(i, j));
    assert.ok(Math.abs(x - i) < 1e-6 && Math.abs(y - j) < 1e-6, `${i},${j}`);
  }
  // Центр кадра без наклона — точно по азимуту: восток (90°) при центре панорамы на севере → u = 0.75.
  const c = viewCamera({ yaw: 90, pitch: 0, fov: 60, W: 100, H: 100 }).ray(50, 50);
  assert.deepEqual(dirToPano(c, 0).map((v) => +v.toFixed(6)), [0.75, 0.5]);
  // Север при центре на севере — середина панорамы; вверх 45° — четверть высоты.
  assert.deepEqual(dirToPano([0, 1, 1], 0).map((v) => +v.toFixed(6)), [0.5, 0.25]);
});

test('unproject: обратна project', async () => {
  const { project, unproject } = await import('../tools/geo.mjs');
  const [lat, lon] = unproject(-35.5, 22.8);
  const [x, z] = project(lat, lon);
  assert.ok(Math.abs(x + 35.5) < 0.01 && Math.abs(z - 22.8) < 0.01);
});
