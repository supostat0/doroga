// 2D-геометрия на плоскости (x, z).

export function len(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az);
}

// Смещённая ломаная: offset > 0 — вправо по ходу движения (при z на юг).
export function offsetPolyline(pts, offset) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let nx = 0, nz = 0;
    if (i > 0) {
      const [x, z] = normalOf(prev, pts[i]);
      nx += x; nz += z;
    }
    if (i < n - 1) {
      const [x, z] = normalOf(pts[i], next);
      nx += x; nz += z;
    }
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    // Митра: компенсируем сужение на изломе, но не больше чем в 2.5 раза.
    let k = 1;
    if (i > 0 && i < n - 1) {
      const [ax, az] = normalOf(prev, pts[i]);
      k = 1 / Math.max(0.4, nx * ax + nz * az);
    }
    out.push([pts[i][0] + nx * offset * k, pts[i][1] + nz * offset * k]);
  }
  return out;
}

// Правая нормаль отрезка a->b (x на восток, z на юг: вправо по ходу = (-dz, dx)).
export function normalOf(a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return s;
}

// Точка и направление на расстоянии d вдоль ломаной.
export function sampleAt(pts, cum, d) {
  const n = pts.length;
  if (d <= 0) return { x: pts[0][0], z: pts[0][1], dx: pts[1][0] - pts[0][0], dz: pts[1][1] - pts[0][1], i: 0 };
  let i = 1;
  while (i < n - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.min(1, (d - cum[i - 1]) / seg);
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: b[0] - a[0], dz: b[1] - a[1], i };
}

export function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return cum;
}

export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function distToPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(px, pz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return best;
}

// Простой детерминированный ГПСЧ, чтобы город выглядел одинаково у всех игроков.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
