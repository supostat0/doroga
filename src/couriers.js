// Курьеры на электровелосипедах: объёмные, из кубиков (как пешеходы) — с любого ракурса
// выглядят правильно. Колёса, рама, курьер крутит педали, термокороб, фара и задний огонь.
// Едут у правого края проезжей части, на красный стоят, от машины игрока уходят к бордюру.
// Короба просто цветные — без логотипов сервисов.

import * as THREE from 'three';
import { lanePoint } from './roadgraph.js';
import { rng, sampleAt } from './geom.js';
import { patchMaterial } from './shaders.js';

const BOXES = ['#f2c81f', '#3fae4f', '#e0306a', '#2f7fd8'];
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

export class Couriers {
  constructor(graph, signals, scene, count = 8) {
    this.graph = graph;
    this.signals = signals;
    // Каждая поездка своя: где кто стоит, куда поедет, кто как одет — случайно (город и его дома — постоянные).
    const r = rng((Math.random() * 2 ** 31) | 0);
    this.list = [];
    const edges = graph.edges.filter((e) => e.len > 20);
    for (let i = 0; i < count && edges.length; i++) {
      const e = edges[Math.floor(r() * edges.length)];
      this.list.push({ e, s: r() * e.len, v: 0, cruise: 5 + r() * 2.5, laneOff: (r() - 0.5) * 0.6, box: i % BOXES.length, bike: true, x: 0, z: 0, dx: 1, dz: 0, side: 0, rnd: r, phase: r() * 5 });
    }
    this.build(scene);
  }

  build(scene) {
    const lit = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), {
      emissive: true,
      colorCode: /* glsl */ `
        vec3 base = vec3(1.0);
        #ifdef USE_COLOR
          base = vColor;
        #endif
        // Слабее, чем у пешеходов: яркие короба у фонаря иначе пересвечиваются в сплошное пятно.
        gEmit = base * cityLight(vWorld.xz) * 0.55;
      `,
    });
    const box = (w, h, d, ox, oy, oz) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(ox, oy, oz);
      return g;
    };
    const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.06, 10);
    wheel.rotateZ(Math.PI / 2);
    // Локально: +z — вперёд по ходу. Ноги — с центром вращения в каретке (педали).
    const defs = {
      wheelF: [wheel, '#141418', 1], wheelR: [wheel, '#141418', 1],
      frame: [box(0.06, 0.08, 1.0, 0, 0.55, 0), '#5a5e66', 1],
      fork: [box(0.05, 0.55, 0.05, 0, 0.62, 0.48), '#5a5e66', 1],
      body: [box(0.36, 0.55, 0.24, 0, 0.27, 0), '#3a3f4c', 1],
      head: [box(0.24, 0.26, 0.26, 0, 0.13, 0), '#c9ccd4', 1], // светлый шлем — читается в темноте
      legL: [box(0.13, 0.55, 0.15, 0, -0.27, 0), '#1c1d24', 1],
      legR: [box(0.13, 0.55, 0.15, 0, -0.27, 0), '#1c1d24', 1],
      arms: [box(0.42, 0.1, 0.42, 0, 0, 0.2), '#2a2d36', 1],
      bag: [box(0.44, 0.44, 0.38, 0, 0.22, 0), null, 1],
    };
    const n = this.list.length;
    this.meshes = {};
    const c = new THREE.Color();
    for (const [name, [geo, col]] of Object.entries(defs)) {
      const m = new THREE.InstancedMesh(geo, lit, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.list.forEach((k, i) => m.setColorAt(i, c.set(col ?? BOXES[k.box])));
      m.frustumCulled = false;
      scene.add(m);
      this.meshes[name] = m;
    }
    // Фара и задний огонь: яркость > 1 — светятся через bloom.
    const lampF = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.9, 2.6) });
    const lampR = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.12, 0.08) });
    this.meshes.lightF = new THREE.InstancedMesh(box(0.08, 0.06, 0.04, 0, 0, 0), lampF, n);
    this.meshes.lightR = new THREE.InstancedMesh(box(0.08, 0.05, 0.03, 0, 0, 0), lampR, n);
    for (const m of [this.meshes.lightF, this.meshes.lightR]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._b = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  // Матрицы всех частей одного курьера: base — положение и курс, crank — угол педалей.
  pose(i, x, y, z, yaw, crank, spin) {
    const { _m: m, _b: base, _q: q, _e: e } = this;
    base.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), ONE);
    const part = (name, ox, oy, oz, rx = 0) => {
      m.compose(new THREE.Vector3(ox, oy, oz), q.setFromEuler(e.set(rx, 0, 0)), ONE);
      this.meshes[name].setMatrixAt(i, m.premultiply(base));
    };
    part('wheelF', 0, 0.33, 0.55, spin);
    part('wheelR', 0, 0.33, -0.5, spin);
    part('frame', 0, 0, 0);
    part('fork', 0, 0, 0);
    part('body', 0, 0.98, -0.12, 0.35);      // наклон вперёд
    part('head', 0, 1.5, 0.05);
    part('arms', 0, 1.18, 0.12, 0.6);
    part('legL', -0.11, 0.98, -0.12, Math.sin(crank) * 0.7);
    part('legR', 0.11, 0.98, -0.12, -Math.sin(crank) * 0.7);
    part('bag', 0, 1.12, -0.42, 0.2);
    part('lightF', 0, 0.85, 0.52);
    part('lightR', 0, 0.62, -0.62);
  }

  update(dt, t, player, cam) {
    this.list.forEach((k, i) => {
      if (k.walk) return this.updateWalk(k, i, dt, cam);
      // Уехал далеко — тихо появляется снова на улице в 80–150 м от камеры (за туманом), чтобы
      // курьеры попадались, а не терялись на окраинах карты.
      if (cam && Math.hypot(k.x - cam.x, k.z - cam.z) > 220) this.respawnNear(k, cam);
      // Условие «мало рядом»: двое съехались ближе 20 м — второй переезжает, но только там,
      // где этого не видно (дальше 110 м от камеры). Рядом с игроком — просто притормаживает.
      else if (cam && this.list.some((o, j) => j < i && Math.hypot(o.x - k.x, o.z - k.z) < 20)) {
        if (Math.hypot(k.x - cam.x, k.z - cam.z) > 130) this.respawnNear(k, cam);
      }
      const e = k.e;
      let target = k.cruise;
      // Красный впереди — стоим у стоп-линии.
      for (const sg of e.signals) {
        const d = (sg.stopD ?? sg.d - 5) + 1.5 - k.s; // у велосипеда перёд ближе к центру
        if (d > -1 && d < 20) {
          const p = lanePoint(e, sg.d, 0);
          if (this.signals.state(this.signals.axisOf(p.dx, p.dz)) !== 'green') target = Math.min(target, Math.max(0, d) * 0.8);
        }
      }
      // Машина игрока впереди на пути — тормозим (без «отталкивания»: курьер — обычный участник движения).
      if (player) {
        const rx = player.x - k.x, rz = player.z - k.z;
        const along = rx * k.dx + rz * k.dz;
        const side = Math.abs(rx * -k.dz + rz * k.dx);
        // Мешает, только если машина реально перекрывает его линию (полкорпуса машины + велосипед).
        if (along > 0 && along < 9 && side < 1.15) {
          target = Math.min(target, Math.max(0, (along - 3) * 1.5));
          k.blocked = true; // мешаешь проехать — позвонит
        } else k.blocked = false;
      }
      // Курьер впереди в ту же сторону: держим дистанцию и обгоняем слева — без «паровозиков».
      let ahead = null;
      for (const o of this.list) {
        if (o === k || o.dx * k.dx + o.dz * k.dz < 0.7) continue;
        const rx = o.x - k.x, rz = o.z - k.z;
        const along = rx * k.dx + rz * k.dz;
        // Включая того, кто уже поравнялся (along до −3 м) — иначе на середине обгона съезжаем обратно в него.
        if (along > -3 && along < 10 && Math.abs(rx * -k.dz + rz * k.dx) < 1.6) ahead = { o, along };
      }
      k.pass = ahead ? -1.5 : 0;
      const passed = (k.passOff ?? 0) < -1.1;
      if (ahead && !passed && ahead.along > 0) target = Math.min(target, Math.max(ahead.o.v, (ahead.along - 3) * 1.2));
      if (ahead && passed) target = Math.max(target, ahead.o.v + 1.5); // уже сбоку — обходим
      k.passOff = (k.passOff ?? 0) + (k.pass - (k.passOff ?? 0)) * Math.min(1, dt * 1.5);
      // Машина игрока — твёрдая: если впереди по ходу (в 2.5 м) кузов — стоим; если игрок
      // наехал и курьер оказался внутри — отъезжаем вбок от машины.
      // Машины — игрока и NPC (такси с аварийкой, пробка) — твёрдые.
      // Кузов + полширины велосипеда (0.2 м): где реально есть место — проезжает.
      const bodies = this.cars ? this.cars() : [];
      let car = null;
      for (const o of bodies) {
        if (Math.abs(o.x - k.x) > 9 || Math.abs(o.z - k.z) > 9) continue;
        const ofx = -Math.sin(o.h), ofz = -Math.cos(o.h);
        const half = (o.half ?? 2.2) + 0.2;
        const inBody = (x, z) => {
          const rx = x - o.x, rz = z - o.z;
          return Math.abs(rx * ofx + rz * ofz) < half && Math.abs(rx * -ofz + rz * ofx) < 1.1;
        };
        if (inBody(k.x + k.dx * 1.5, k.z + k.dz * 1.5) || inBody(k.x, k.z)) {
          car = { o, ofx, ofz, inside: inBody(k.x, k.z) };
          break;
        }
      }
      if (player || car) {
        const pfx = car ? car.ofx : 0, pfz = car ? car.ofz : 0;
        const blockedByCar = !!car;
        // Объезд: постоял больше секунды — смещается в сторону от машины (хоть на бордюр) и едет.
        k.stuckT = blockedByCar ? (k.stuckT ?? 0) + dt : Math.max(0, (k.stuckT ?? 0) - dt * 0.5);
        if (k.stuckT > 1 && car) {
          const side = (k.x - car.o.x) * -pfz + (k.z - car.o.z) * pfx; // где курьер относительно оси машины
          const mySide = -k.dz * -pfz + k.dx * pfx; // как его «вправо» смотрит относительно машины
          k.avoid = Math.sign(side * mySide || 1) * 1.8;
        } else if (k.stuckT <= 0) k.avoid = 0;
        if (blockedByCar) {
          target = 0;
          k.v = Math.min(k.v, 0.2);
          if (car.inside) {
            const side = (k.x - car.o.x) * -pfz + (k.z - car.o.z) * pfx;
            const away = side * (-k.dz * -pfz + k.dx * pfx) >= 0 ? 1 : -1; // в какую сторону своей оси «наружу»
            k.passOff = (k.passOff ?? 0) + away * 2.5 * dt;
          }
        }
      }
      k.v += Math.sign(target - k.v) * Math.min(Math.abs(target - k.v), (target < k.v ? 6 : 3) * dt);
      k.s += k.v * dt;
      if (k.s > e.len) {
        const outs = (this.graph.out.get(e.to) ?? []).filter((o) => !(o.to === e.from && o.roadId === e.roadId));
        // Тупик (край карты): разворот по встречной стороне той же улицы. Переносим в другое
        // место только если это не видно (дальше 110 м от камеры) — иначе курьер «пропадал» на глазах.
        const back = (this.graph.out.get(e.to) ?? []).filter((o) => o.to === e.from && o.roadId === e.roadId);
        const far = !cam || Math.hypot(k.x - cam.x, k.z - cam.z) > 130;
        if (outs.length) {
          k.e = outs[Math.floor(k.rnd() * outs.length)];
          k.s = 0;
        } else if (back.length) {
          k.e = back[0];
          k.s = 0;
        } else if (far) {
          this.respawnNear(k, cam ?? { x: k.x, z: k.z });
        } else {
          k.s = e.len; // односторонний тупик рядом с игроком — стоит, пока не уйдёт из виду
          k.v = 0;
        }
      }
      // У правого края проезжей части.
      const p = lanePoint(k.e, Math.min(k.s, k.e.len), 0);
      k.avoidOff = (k.avoidOff ?? 0) + ((k.avoid ?? 0) - (k.avoidOff ?? 0)) * Math.min(1, dt * 1.8);
      const edge = k.e.lw * 0.5 - 0.7 + k.laneOff + (k.passOff ?? 0) + k.avoidOff;
      let x = p.x + -p.dz * edge, z = p.z + p.dx * edge;
      k.x = x;
      k.z = z;
      k.dx += (p.dx - k.dx) * Math.min(1, dt * 6);
      k.dz += (p.dz - k.dz) * Math.min(1, dt * 6);
      k.crank = (k.crank ?? 0) + k.v * dt * 1.6;
      k.spin = (k.spin ?? 0) + (k.v / 0.33) * dt;
      this.pose(i, x, 0, z, Math.atan2(k.dx, k.dz), k.crank, k.spin);
    });
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
  }
}

// Часть курьеров — по тротуарам и пешеходным переходам (граф пешеходов): медленнее,
// объезжают людей, на регулируемом переходе ждут, как пешеходы.
Couriers.prototype.initWalkers = function (peds, roadAt) {
  this.peds = peds;
  this.roadAt = roadAt;
  const edges = peds.graph.edges.filter((e) => e.len > 10 && !e.crossing);
  this.list.forEach((k, i) => {
    if (i % 3 !== 1 || !edges.length) return; // примерно каждый третий
    k.walk = true;
    k.e = edges[Math.floor(k.rnd() * edges.length)];
    k.s = k.rnd() * k.e.len;
    k.cruise = 3.2 + k.rnd() * 1.2;
  });
};

Couriers.prototype.updateWalk = function (k, i, dt, cam) {
  const P = this.peds;
  if (cam && Math.hypot(k.x - cam.x, k.z - cam.z) > 220) {
    const edges = P.graph.edges.filter((e) => !e.crossing && e.len > 10);
    for (let t = 0; t < 20; t++) {
      const e = edges[Math.floor(k.rnd() * edges.length)];
      const p = e.pts[0];
      const d = Math.hypot(p[0] - cam.x, p[1] - cam.z);
      if (d > 125 && d < 175) { k.e = e; k.s = 0; break; }
    }
  }
  let target = k.cruise;
  // Люди впереди — притормаживаем (тротуар общий).
  for (const q of P.peds) {
    const rx = q.x - k.x, rz = q.z - k.z;
    if (Math.abs(rx) > 6 || Math.abs(rz) > 6) continue;
    const along = rx * k.dx + rz * k.dz;
    if (along > 0 && along < 4 && Math.abs(rx * -k.dz + rz * k.dx) < 0.8) target = Math.min(target, 1.2);
  }
  // Переход со светофором — ждём, как пешеходы.
  const cr = k.e.cross?.find((c) => c.d - 1 > k.s - 0.01);
  if (cr && k.s + k.v * dt >= cr.d - 1 && this.roadAt(k.x, k.z) < 0.3 && !P.mayCross(cr)) target = 0;
  k.v += Math.sign(target - k.v) * Math.min(Math.abs(target - k.v), 4 * dt);
  k.s += k.v * dt;
  if (k.s >= k.e.len) {
    const outs = (P.graph.out.get(k.e.to) ?? []).filter((o) => o.i !== k.e.twin);
    const list = outs.length ? outs : P.graph.out.get(k.e.to) ?? [];
    // Нет продолжения — разворачивается на этом же тротуаре (а не прыгает в начало).
    k.e = list.length ? list[Math.floor(k.rnd() * list.length)] : P.graph.edges[k.e.twin] ?? k.e;
    k.s = 0;
  }
  const sp = sampleAt(k.e.pts, k.e.cum, Math.min(k.e.len, k.s));
  const l = Math.hypot(sp.dx, sp.dz) || 1;
  const x = sp.x + (-sp.dz / l) * 0.6, z = sp.z + (sp.dx / l) * 0.6; // правее середины тротуара
  k.x = x;
  k.z = z;
  k.dx += (sp.dx / l - k.dx) * Math.min(1, dt * 6);
  k.dz += (sp.dz / l - k.dz) * Math.min(1, dt * 6);
  k.crank = (k.crank ?? 0) + k.v * dt * 1.6;
  k.spin = (k.spin ?? 0) + (k.v / 0.33) * dt;
  const y = 0.14 * (1 - Math.min(1, Math.max(0, (this.roadAt(x, z) - 0.25) / 0.35)));
  this.pose(i, x, y, z, Math.atan2(k.dx, k.dz), k.crank, k.spin);
};

Couriers.prototype.respawnNear = function (k, cam) {
  for (let tries = 0; tries < 20; tries++) {
    const e = this.graph.edges[Math.floor(k.rnd() * this.graph.edges.length)];
    const p = e.pts[Math.floor(e.pts.length / 2)];
    const d = Math.hypot(p[0] - cam.x, p[1] - cam.z);
    // Только туда, где в 60 м нет других курьеров.
    const busy = this.list.some((o) => o !== k && Math.hypot(o.x - p[0], o.z - p[1]) < 60);
    if (d > 125 && d < 175 && !busy) { // за туманом — появление не видно
      k.e = e;
      k.s = e.len * (0.2 + k.rnd() * 0.6);
      k.cruise = 5 + k.rnd() * 2.5;
      k.v = k.cruise;
      k.x = p[0];
      k.z = p[1];
      return;
    }
  }
};
