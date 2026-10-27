// Сетка отрезков-препятствий (стены домов, парапеты набережных) для столкновений и камеры.

const CELL = 8;

export class SegmentGrid {
  constructor() {
    this.cells = new Map();
    this.segs = [];
  }

  add(seg) {
    const i = this.segs.push(seg) - 1;
    const [ax, az, bx, bz] = seg;
    const x0 = Math.floor(Math.min(ax, bx) / CELL);
    const x1 = Math.floor(Math.max(ax, bx) / CELL);
    const z0 = Math.floor(Math.min(az, bz) / CELL);
    const z1 = Math.floor(Math.max(az, bz) / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = x * 100003 + z;
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(i);
      }
    }
  }

  near(x, z, r, out = new Set()) {
    out.clear();
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.cells.get(cx * 100003 + cz);
        if (c) for (const i of c) out.add(i);
      }
    }
    return out;
  }

  // Выталкивает круг из стен. Возвращает нормаль последнего удара или null.
  resolveCircle(p, r) {
    let hit = null;
    for (const i of this.near(p.x, p.z, r + 1, this._tmp || (this._tmp = new Set()))) {
      const [ax, az, bx, bz] = this.segs[i];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2));
      const qx = ax + dx * t, qz = az + dz * t;
      let nx = p.x - qx, nz = p.z - qz;
      const d = Math.hypot(nx, nz);
      if (d < r && d > 1e-6) {
        nx /= d;
        nz /= d;
        p.x += nx * (r - d);
        p.z += nz * (r - d);
        hit = { nx, nz };
      }
    }
    return hit;
  }

  // Доля пути a->b до первого препятствия (1 — свободно). Низкие (5-й элемент — 1: заборы,
  // изгороди) не считаются — камера смотрит поверх них.
  raycast(ax, az, bx, bz) {
    let best = 1;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const r = Math.hypot(bx - ax, bz - az) / 2 + 1;
    for (const i of this.near(mx, mz, r, this._tmp2 || (this._tmp2 = new Set()))) {
      const [cx, cz, dx, dz, low] = this.segs[i];
      if (low) continue;
      const t = segIntersect(ax, az, bx, bz, cx, cz, dx, dz);
      if (t !== null && t < best) best = t;
    }
    return best;
  }
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az;
  const sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
