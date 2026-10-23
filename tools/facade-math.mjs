// Математика инструмента «фото → пиксельный фасад»: выпрямление перспективы и палитра.

// Гомография: 4 точки прямоугольника (0,0),(1,0),(1,1),(0,1) → 4 точки на фото.
// Возвращает функцию (u, v) → [x, y] в пикселях фото.
export function homography(quad) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // 8 уравнений на 8 неизвестных (h33 = 1).
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = quad[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const h = solve(A, b);
  return (u, v) => {
    const w = h[6] * u + h[7] * v + 1;
    return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
  };
}

// Гаусс с выбором главного элемента.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Палитра k-средних: pixels — массив [r,g,b], k цветов. Детерминированно (старт по яркости).
export function kmeans(pixels, k, iters = 12) {
  const sorted = [...pixels].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centers = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]]);
  for (let it = 0; it < iters; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      const s = sum[nearest(centers, p)];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    centers = centers.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  return centers.map((c) => c.map(Math.round));
}

export function nearest(centers, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Стена дома: ребро i контура ring. Концы упорядочены так, чтобы для зрителя снаружи
// a был слева, b справа (как на фото). Оси: x — восток, z — юг.
export function wallInfo(ring, i) {
  return wallSpan(ring, i, (i + 1) % ring.length);
}

// То же для отрезка контура от вершины s до вершины e (по ходу контура).
export function wallSpan(ring, s, e) {
  let a = ring[s], b = ring[e];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  if (inRing([mid[0] + n[0] * 1.5, mid[1] + n[1] * 1.5], ring)) n = [-n[0], -n[1]];
  // Взгляд f = -n, правая рука = (-fz, fx).
  const right = [n[1], -n[0]];
  if ((b[0] - a[0]) * right[0] + (b[1] - a[1]) * right[1] < 0) [a, b] = [b, a];
  return { a, b, len, mid, n };
}

// Вся прямая стена вокруг ребра i: OSM дробит фасад на мелкие отрезки (выступы, пилястры).
// Растим отрезок в обе стороны, пока все вершины в пределах tol м от прямой и направление
// не уходит больше чем на maxDeg от исходного ребра. Возвращает { s, e } — вершины концов.
export function wallChain(ring, i, tol = 0.5, maxDeg = 15) {
  const n = ring.length;
  // Клик по крошечному ребру выступа: опора — самое длинное из соседних рёбер.
  const elen = (k) => Math.hypot(ring[(k + 1) % n][0] - ring[k][0], ring[(k + 1) % n][1] - ring[k][1]);
  if (elen(i) < 1.5) i = [(i - 1 + n) % n, i, (i + 1) % n].reduce((m, k) => (elen(k) > elen(m) ? k : m), i);
  const a0 = ring[i], b0 = ring[(i + 1) % n];
  const d0 = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
  const fits = (s, e) => {
    const a = ring[s], b = ring[e];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) return false;
    let dd = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) - d0);
    dd = Math.min(dd, 2 * Math.PI - dd);
    if (dd > (maxDeg * Math.PI) / 180) return false;
    for (let k = s; k !== e; k = (k + 1) % n) {
      const p = ring[k];
      if (Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L > tol) return false;
    }
    return true;
  };
  let s = i, e = (i + 1) % n;
  for (let k = 0; k < n - 2; k++) {
    const e2 = (e + 1) % n;
    if (e2 === s || !fits(s, e2)) break;
    e = e2;
  }
  for (let k = 0; k < n - 2; k++) {
    const s2 = (s - 1 + n) % n;
    if (s2 === e || !fits(s2, e)) break;
    s = s2;
  }
  return { s, e };
}

function inRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Один цвет пикселя из нескольких фото. При 3+ снимках — тот, что ближе всех к остальным
// (прохожий или машина есть только на одном кадре и отбрасывается); при 1–2 — среднее.
export function combine(samples) {
  if (samples.length < 3) {
    const n = samples.length;
    return [0, 1, 2].map((k) => samples.reduce((s, c) => s + c[k], 0) / n);
  }
  let best = samples[0], bd = Infinity;
  for (const a of samples) {
    let d = 0;
    for (const b of samples) d += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// Повторы образца по горизонтали: gray — яркости (W×H, построчно), образец — прямоугольник
// (x0, y0, tw, th). Нормированная корреляция по всей полосе; пики выше minScore,
// не ближе 0.8 ширины друг к другу. Возвращает центры по x (в пикселях), по возрастанию.
export function findRepeats(gray, W, x0, y0, tw, th, minScore = 0.55) {
  const tpl = [];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) tpl.push(gray[(y0 + y) * W + x0 + x]);
  const n = tpl.length, tm = tpl.reduce((s, v) => s + v, 0) / n;
  const tc = tpl.map((v) => v - tm), tn = Math.sqrt(tc.reduce((s, v) => s + v * v, 0)) || 1;
  const scores = [];
  for (let sx = 0; sx + tw <= W; sx++) {
    let m = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) m += gray[(y0 + y) * W + sx + x];
    m /= n;
    let num = 0, den = 0, i = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++, i++) {
      const v = gray[(y0 + y) * W + sx + x] - m;
      num += v * tc[i]; den += v * v;
    }
    scores.push({ x: sx + tw / 2, s: num / (tn * (Math.sqrt(den) || 1)) });
  }
  const picked = [];
  for (const c of [...scores].sort((a, b) => b.s - a.s)) {
    if (c.s < minScore) break;
    if (picked.every((p) => Math.abs(p - c.x) >= tw * 0.8)) picked.push(c.x);
  }
  return picked.sort((a, b) => a - b);
}

// Достроить ряд по шагу: если найденные центры стоят на ровной сетке — продолжить её на всю
// стену (окна, которые поиск не узнал из-за бликов). Иначе вернуть как есть.
export function fillGrid(cols, w, L) {
  if (cols.length < 2) return cols;
  const s = [...cols].sort((a, b) => a - b);
  const diffs = s.slice(1).map((c, i) => c - s[i]).filter((d) => d > w * 0.8);
  if (!diffs.length) return s;
  const minD = Math.min(...diffs);
  // Шаг — наименьший разрыв, уточнённый по всем (разрывы бывают кратными: пропущенные окна).
  const ks = diffs.map((d) => Math.round(d / minD));
  const step = diffs.reduce((a, d) => a + d, 0) / ks.reduce((a, k) => a + k, 0);
  if (!s.every((c) => Math.abs((c - s[0]) / step - Math.round((c - s[0]) / step)) < 0.12)) return s;
  const out = [];
  for (let u = s[0] - Math.floor((s[0] - w / 2) / step) * step; u <= L - w / 2 + 1e-6; u += step) out.push(+u.toFixed(2));
  return out;
}

// Камера для кадра из панорамы: смотрит по азимуту yaw (° от севера по часовой), наклон pitch (° вверх),
// угол обзора fov (° по горизонтали), кадр W×H. Направления в мире — [восток, вверх, север].
export function viewCamera({ yaw, pitch, fov, W, H }) {
  const f = W / 2 / Math.tan((fov * Math.PI) / 360);
  const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  const fwd = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  const right = [Math.cos(y), 0, -Math.sin(y)];
  const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    ray: (i, j) => [0, 1, 2].map((k) => fwd[k] * f + right[k] * (i - W / 2) + up[k] * (H / 2 - j)),
    project: (v) => {
      const zc = dot(v, fwd);
      return zc > 0 ? [W / 2 + (f * dot(v, right)) / zc, H / 2 - (f * dot(v, up)) / zc] : null;
    },
  };
}

// Направление → точка панорамы (доли 0…1). Центр панорамы смотрит по азимуту heading.
export function dirToPano([e, u, n], heading) {
  let du = (Math.atan2(e, n) * 180) / Math.PI / 360 - heading / 360 + 0.5;
  du -= Math.floor(du);
  return [du, 0.5 - Math.atan2(u, Math.hypot(e, n)) / Math.PI];
}
