// Пешеходы — объёмные «пиксельные» человечки из кубиков (голова, шапка, корпус, руки, ноги),
// шагают руками и ногами. Ходят по тротуарам OSM, на переходах ждут, от машины игрока отходят.
// Каждая часть тела — один InstancedMesh на всех: ~8 вызовов отрисовки на всю толпу.

import * as THREE from 'three';
import { cumulative, sampleAt, rng, distToPolyline } from './geom.js';
import { patchMaterial } from './shaders.js';

const COATS = ['#2b2f3a', '#7a2630', '#33465e', '#3f4a36', '#5b4636', '#1e1e22', '#8a5a2b', '#5a3d6b', '#b23a3a', '#2f5f73', '#6b6b70', '#c79a3b'];
const HATS = ['#d8d8dc', '#b8323a', '#1f2a44', '#3a3a3a', '#d2a23a', '#2f6b4a', '#7a7a80', '#e6e6ea'];
const SKINS = ['#efcfb4', '#e3b998', '#d6a785', '#f2d6c0'];
const PANTS = ['#1c1d24', '#2e3442', '#3a3430'];

export class Pedestrians {
  constructor(map, signals, scene, count = 420) {
    this.signals = signals;
    this.graph = footGraph(map);
    this.cars = () => []; // задаётся снаружи: машины, которых ждём на нерегулируемых переходах
    this.peds = [];
    // Каждая поездка своя: где кто стоит, куда поедет, кто как одет — случайно (город и его дома — постоянные).
    const r = rng((Math.random() * 2 ** 31) | 0);
    // Гуще у центра и на тротуарах вдоль проезжих улиц.
    const drive = map.roads.filter((rd) => rd.kind === 'drive');
    const pool = [];
    for (const e of this.graph.edges) {
      if (e.len < 6 || e.crossing) continue;
      const [mx, mz] = e.pts[Math.floor(e.pts.length / 2)];
      const nearStreet = drive.some((rd) => distToPolyline(mx, mz, rd.p) < rd.w / 2 + 10);
      const w = Math.round(6 * Math.exp(-Math.hypot(mx, mz) / 160) * (nearStreet ? 3 : 0.4));
      for (let k = 0; k < w; k++) pool.push(e);
    }
    for (let i = 0; i < count && pool.length; i++) {
      const e = pool[Math.floor(r() * pool.length)];
      const janitor = r() < 0.05;
      const pick = (a) => a[Math.floor(r() * a.length)];
      this.peds.push({
        e, s: r() * e.len, v: janitor ? 0.35 : 1.0 + r() * 0.5, side: (r() - 0.5) * 1.2, janitor,
        coat: janitor ? '#f07a1a' : pick(COATS), hat: pick(HATS), skin: pick(SKINS), pants: pick(PANTS),
        scale: 0.9 + r() * 0.2, phase: r() * 10, x: 0, z: 0, yaw: 0, push: [0, 0], wait: false, rnd: r,
      });
    }
    // Пары: примерно каждый восьмой идёт рядом с предыдущим (держит его маршрут и шаг).
    for (let i = 1; i < this.peds.length; i++) {
      const p = this.peds[i], l = this.peds[i - 1];
      if (r() < 0.13 && !p.janitor && !l.janitor && !l.leader) {
        p.leader = l;
        p.janitor = false;
      }
    }
    this.build(scene);
  }

  // Люди ждут на остановках: стоят у павильона лицом к дороге, переминаются.
  addWaiters(stops) {
    const r = Math.random;
    let k = 0;
    for (const s of stops) {
      const n = Math.floor(r() * 4);
      for (let j = 0; j < n && k < this.peds.length; j++) {
        // Берём случайного «одиночку» и ставим на остановку.
        const p = this.peds[Math.floor(r() * this.peds.length)];
        if (p.janitor || p.leader || p.idle) continue;
        const along = (j - n / 2) * 0.8;
        p.idle = { x: s.p[0] + Math.cos(s.yaw) * along, z: s.p[1] - Math.sin(s.yaw) * along, yaw: s.yaw + (r() - 0.5) * 0.6, until: 20 + r() * 60 };
        k++;
      }
    }
  }

  build(scene) {
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), {
      emissive: true,
      // Ночью человечек освещён городом (фонари, витрины) — цвет части тела берём из instanceColor.
      colorCode: /* glsl */ `
        vec3 base = vec3(1.0);
        #ifdef USE_COLOR
          base = vColor; // во фрагментном шейдере цвет инстанса приходит под флагом USE_COLOR
        #endif
        gEmit = base * cityLight(vWorld.xz) * 1.1;
      `,
    });
    const box = (w, h, d, oy) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(0, oy, 0);
      return g;
    };
    // Геометрия частей в своих осях: ноги и руки — с центром вращения в бедре/плече.
    const parts = {
      legL: box(0.15, 0.8, 0.17, -0.4), legR: box(0.15, 0.8, 0.17, -0.4),
      body: box(0.44, 0.62, 0.26, 0.31),
      armL: box(0.11, 0.58, 0.12, -0.27), armR: box(0.11, 0.58, 0.12, -0.27),
      head: box(0.25, 0.25, 0.25, 0.125),
      hat: box(0.28, 0.12, 0.28, 0.06),
    };
    const n = this.peds.length;
    this.meshes = {};
    const tmp = new THREE.Color();
    for (const [name, geo] of Object.entries(parts)) {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.peds.forEach((p, i) => {
        const c = { legL: p.pants, legR: p.pants, body: p.coat, armL: p.coat, armR: p.coat, head: p.skin, hat: p.hat }[name];
        tmp.set(c);
        if (name.startsWith('arm')) tmp.multiplyScalar(0.8);
        m.setColorAt(i, tmp);
      });
      m.frustumCulled = false;
      scene.add(m);
      this.meshes[name] = m;
    }
    // Лопата у дворников.
    this.janitors = this.peds.filter((p) => p.janitor);
    this.janitors.forEach((p, k) => (p.toolIdx = k));
    const shovel = box(0.05, 1.3, 0.05, -0.55);
    const blade = new THREE.BoxGeometry(0.3, 0.04, 0.26);
    blade.translate(0, -1.2, 0.08);
    this.tool = new THREE.InstancedMesh(mergeTool(shovel, blade), new THREE.MeshLambertMaterial({ color: 0x7a6a58 }), Math.max(1, this.janitors.length));
    this.tool.count = this.janitors.length;
    // Светоотражающие полосы на жилете дворника: два белых пояса вокруг корпуса.
    const band = (y) => new THREE.BoxGeometry(0.46, 0.06, 0.28).translate(0, y, 0);
    this.stripes = new THREE.InstancedMesh(mergeTool(band(0.2), band(0.42)), new THREE.MeshLambertMaterial({ color: 0xe8ecf0, emissive: 0x9aa0a8, emissiveIntensity: 0.6 }), Math.max(1, this.janitors.length));
    this.stripes.count = this.janitors.length;
    this.stripes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stripes.frustumCulled = false;
    scene.add(this.stripes);
    this.tool.frustumCulled = false;
    scene.add(this.tool);
    // Тень-пятно под ногами.
    const shadowGeo = new THREE.CircleGeometry(0.38, 10);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.InstancedMesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }), n);
    this.shadow.frustumCulled = false;
    scene.add(this.shadow);
    this._m = new THREE.Matrix4();
    this._b = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  update(dt, t, player) {
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      if (p.idle) {
        // Ждёт на остановке; со временем уходит дальше пешком.
        p.idle.until -= dt;
        if (p.idle.until <= 0) p.idle = null;
        else {
          p.x = p.idle.x;
          p.z = p.idle.z;
          p.yaw = p.idle.yaw + Math.sin(t * 0.7 + p.phase) * 0.15;
          this.pose(i, p, p.x, 0.14, p.z, 0);
          continue;
        }
      }
      if (p.jay) {
        // Перебегает дорогу не по переходу — быстрым шагом по прямой.
        const j = p.jay;
        j.t += (1.9 * dt) / j.len;
        const x = j.a[0] + (j.b[0] - j.a[0]) * Math.min(1, j.t), z = j.a[1] + (j.b[1] - j.a[1]) * Math.min(1, j.t);
        p.x = x;
        p.z = z;
        p.yaw = Math.atan2(j.b[0] - j.a[0], j.b[1] - j.a[1]);
        const y = this.roadAt ? 0.14 * (1 - Math.min(1, Math.max(0, (this.roadAt(x, z) - 0.25) / 0.35))) : 0;
        this.pose(i, p, x, y, z, Math.sin(t * 9 + p.phase) * 0.7);
        if (j.t >= 1) this.resumeAt(p, j.b);
        continue;
      }
      if (p.leader && !p.leader.idle && !p.leader.jay) {
        // Идёт рядом с напарником.
        const l = p.leader;
        p.e = l.e;
        p.s = Math.max(0, l.s - 0.3);
        p.v = l.v;
        p.side = l.side + 0.65;
        p.wait = l.wait;
        p.pause = l.pause;
      }
      // Иногда останавливается поглазеть на витрину.
      p.pause = Math.max(0, (p.pause ?? 0) - dt);
      if (!p.leader && !p.janitor && p.pause <= 0 && Math.random() < dt / 90) p.pause = 2 + Math.random() * 4;
      if (!p.leader && Math.random() < dt / 1500) this.tryJaywalk(p); // редко: пара человек на весь центр
      if (p.s >= p.e.len) {
        p.e = this.pickNext(p);
        p.s = 0;
      }
      // Перед проезжей частью: со светофором ждём красного для машин, без — разрыва в потоке.
      // На проезжей части все (и дворники с лопатой) идут быстрым шагом.
      const onRoad = this.roadAt && this.roadAt(p.x, p.z) > 0.5;
      const move = (onRoad ? Math.max(p.v, 1.4) : p.v) * dt;
      const cr = p.e.cross.find((k) => k.d - 1 > p.s - 0.01);
      // Ждём только стоя на тротуаре: если уже на дороге (середина Невского) — доходим до конца.
      const onWalk = !this.roadAt || this.roadAt(p.x, p.z) < 0.3;
      p.wait = !!cr && onWalk && p.s + move >= cr.d - 1 - (p.phase % 3) * 0.7 && !this.mayCross(cr);
      // Ожидающие встают не в одну точку, а небольшой толпой.
      if (p.wait) p.s = Math.max(p.s, cr.d - 1 - (p.phase % 3) * 0.7);
      else if (!(p.pause > 0)) p.s += move;
      const sp = sampleAt(p.e.pts, p.e.cum, Math.min(p.e.len, p.s));
      const l = Math.hypot(sp.dx, sp.dz) || 1;
      let x = sp.x + (-sp.dz / l) * p.side;
      let z = sp.z + (sp.dx / l) * p.side;

      // Не проходить сквозь машину игрока: если следующий шаг внутри кузова — стоим.
      if (player) {
        const [fx, fz] = player.forward;
        const inCar = (px, pz) => {
          const rx = px - player.x, rz = pz - player.z;
          return Math.abs(rx * fx + rz * fz) < 2.7 && Math.abs(rx * -fz + rz * fx) < 1.35;
        };
        if (inCar(x + p.push[0], z + p.push[1])) {
          // Уже внутри (машина наехала) — выходим к ближайшему борту.
          const rx = x + p.push[0] - player.x, rz = z + p.push[1] - player.z;
          const side = rx * -fz + rz * fx;
          const out = (side >= 0 ? 1 : -1) * (1.36 - Math.abs(side)); // ровно до борта — без «отлёта»
          p.push[0] += -fz * out;
          p.push[1] += fx * out;
          p.s = Math.max(0, p.s - move); // и не идём дальше этот кадр
        }
      }
      p.push[0] *= Math.exp(-dt * 0.3);
      p.push[1] *= Math.exp(-dt * 0.3);
      x += p.push[0];
      z += p.push[1];

      p.x = x;
      p.z = z;
      // Смотрит по ходу движения (поворачивается плавно).
      if (!p.wait) {
        let dy = Math.atan2(sp.dx, sp.dz) - p.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        p.yaw += dy * Math.min(1, dt * 8);
      }
      const y = this.roadAt ? 0.14 * (1 - Math.min(1, Math.max(0, (this.roadAt(x, z) - 0.25) / 0.35))) : 0;
      const swing = p.wait || p.pause > 0 ? 0 : Math.sin(t * p.v * 5.5 + p.phase) * (p.janitor ? 0.25 : 0.55);
      this.pose(i, p, x, y, z, swing);
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
    this.tool.instanceMatrix.needsUpdate = true;
    this.stripes.instanceMatrix.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
  }

  // Собирает матрицы всех частей тела одного человечка.
  pose(i, p, x, y, z, swing) {
    const { _m: m, _b: base, _q: q, _e: e } = this;
    const s = p.scale;
    base.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, p.yaw), new THREE.Vector3(s, s, s));
    const part = (mesh, ox, oy, oz, rx) => {
      m.compose(new THREE.Vector3(ox, oy, oz), q.setFromEuler(e.set(rx, 0, 0)), ONE);
      mesh.setMatrixAt(i, m.premultiply(base));
    };
    const M = this.meshes;
    part(M.legL, -0.11, 0.82, 0, swing);
    part(M.legR, 0.11, 0.82, 0, -swing);
    part(M.body, 0, 0.82, 0, 0);
    part(M.armL, -0.29, 1.4, 0, -swing * 0.8);
    part(M.armR, 0.29, 1.4, 0, p.janitor ? -0.6 : swing * 0.8);
    part(M.head, 0, 1.45, 0, 0);
    part(M.hat, 0, 1.69, 0, 0);
    m.compose(new THREE.Vector3(x, y + 0.01, z), q.identity(), ONE);
    this.shadow.setMatrixAt(i, m);
    if (p.janitor) {
      m.compose(new THREE.Vector3(0.33, 1.15, 0.25), q.setFromEuler(e.set(-0.5, 0, 0)), ONE);
      this.tool.setMatrixAt(p.toolIdx, m.premultiply(base));
      m.compose(new THREE.Vector3(0, 0.82, 0), q.identity(), ONE);
      this.stripes.setMatrixAt(p.toolIdx, m.premultiply(base));
    }
  }

  // Перебежка: только если рядом проезжая часть и машин в 35 м нет.
  tryJaywalk(p) {
    if (!this.roadAt || !this.drive || p.janitor) return;
    let best = null;
    let bd = 12;
    for (const r of this.drive) {
      if (r.hw === 'primary') continue; // через Невский не бегают
      for (let i = 1; i < r.p.length; i++) {
        const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / l2));
        const qx = ax + ex * t, qz = az + ez * t;
        const d = Math.hypot(p.x - qx, p.z - qz);
        if (d < bd && d > r.w / 2) { bd = d; best = { q: [qx, qz], d, w: r.w }; }
      }
    }
    if (!best) return;
    if (this.cars().some((c) => Math.hypot(c.x - best.q[0], c.z - best.q[1]) < 35)) return;
    const nx = (best.q[0] - p.x) / best.d, nz = (best.q[1] - p.z) / best.d;
    const b = [best.q[0] + nx * (best.w / 2 + 1.5), best.q[1] + nz * (best.w / 2 + 1.5)];
    if (this.roadAt(b[0], b[1]) > 0.3) return;
    p.jay = { a: [p.x, p.z], b, t: 0, len: Math.hypot(b[0] - p.x, b[1] - p.z) };
  }

  // После перебежки — на ближайший тротуар.
  resumeAt(p, pt) {
    p.jay = null;
    let best = null;
    let bd = Infinity;
    for (const e of this.graph.edges) {
      if (e.crossing) continue;
      for (let i = 0; i < e.pts.length; i++) {
        const d = Math.hypot(e.pts[i][0] - pt[0], e.pts[i][1] - pt[1]);
        if (d < bd) { bd = d; best = { e, s: e.cum[i] }; }
      }
    }
    if (best) {
      p.e = best.e;
      p.s = best.s;
      p.push = [0, 0];
    }
  }

  pickNext(p) {
    const outs = this.graph.out.get(p.e.to) ?? [];
    // Разворот назад — только в тупике.
    const fwd = outs.filter((o) => o.i !== p.e.twin);
    const list = fwd.length ? fwd : outs;
    if (!p.next || p.nextFrom !== p.e) {
      p.next = list[Math.floor(p.rnd() * list.length)];
      p.nextFrom = p.e;
    }
    return p.next;
  }

  mayCross(k) {
    if (k.signal) {
      // Заходим, только пока у поперечной улицы зелёный — успеем дойти до смены сигнала.
      const axis = this.signals.axisOf(k.dir[0], k.dir[1]);
      return this.signals.state(axis) === 'red' && this.signals.state(1 - axis) === 'green';
    }
    // Нерегулируемый: никто не подъезжает ближе 16 м (стоящая машина не мешает).
    for (const c of this.cars()) {
      const v = c.speed ?? c.v; // у игрока speed, у NPC v
      if (v > 1 && Math.hypot(c.x - k.x, c.z - k.z) < 16) return false;
    }
    return true;
  }
}

// Граф тротуаров: рёбра между узлами, общими для нескольких пешеходных путей.
// Рёбра ненаправленные, но храним каждое в обе стороны, чтобы ходить без разворотов.
function footGraph(map) {
  const roads = map.roads.filter((r) => r.kind === 'foot' && !r.bridge);
  const drive = map.roads.filter((r) => r.kind === 'drive' && !r.bridge);
  const signals = map.signals.map((sg) => sg.p);
  const use = new Map();
  for (const r of roads) for (const id of r.ids) use.set(id, (use.get(id) || 0) + 1);
  const edges = [];
  const out = new Map();
  const add = (pts, ids, crossing) => {
    const e = { i: edges.length, pts, cum: cumulative(pts), from: ids[0], to: ids[ids.length - 1], crossing };
    e.len = e.cum[e.cum.length - 1];
    e.cross = findCrossings(e, drive, signals);
    edges.push(e);
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
    return e;
  };
  for (const r of roads) {
    let start = 0;
    for (let i = 1; i < r.ids.length; i++) {
      if (i === r.ids.length - 1 || use.get(r.ids[i]) > 1) {
        const pts = r.p.slice(start, i + 1);
        const ids = r.ids.slice(start, i + 1);
        const a = add(pts, ids, r.crossing);
        const b = add(pts.slice().reverse(), ids.slice().reverse(), r.crossing);
        a.twin = b.i;
        b.twin = a.i;
        start = i;
      }
    }
  }
  return { edges, out };
}

// Где пешеходное ребро пересекает проезжую часть: расстояние вдоль ребра, точка,
// направление улицы и есть ли рядом светофор.
function findCrossings(e, drive, signals) {
  const out = [];
  for (let i = 1; i < e.pts.length; i++) {
    const [ax, az] = e.pts[i - 1];
    const [bx, bz] = e.pts[i];
    for (const r of drive) {
      for (let j = 1; j < r.p.length; j++) {
        const [cx, cz] = r.p[j - 1];
        const [dx, dz] = r.p[j];
        const ex = bx - ax, ez = bz - az, fx = dx - cx, fz = dz - cz;
        const den = ex * fz - ez * fx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * fz - (cz - az) * fx) / den;
        const u = ((cx - ax) * ez - (cz - az) * ex) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const x = ax + ex * t, z = az + ez * t;
        const fl = Math.hypot(fx, fz) || 1;
        // Ждём у бордюра: точка ожидания — за полширины улицы до осевой.
        const d = e.cum[i - 1] + Math.hypot(ex, ez) * t - r.w / 2;
        const signal = signals.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 14);
        out.push({ d: Math.max(0, d), x, z, dir: [fx / fl, fz / fl], signal });
      }
    }
  }
  // Две половины одной улицы (Невский) — один переход: вторую половину не ждём отдельно.
  out.sort((a, b) => a.d - b.d);
  return out.filter((k, i) => i === 0 || k.d - out[i - 1].d > 16);
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function mergeTool(a, b) {
  const pos = [...a.toNonIndexed().attributes.position.array, ...b.toNonIndexed().attributes.position.array];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
