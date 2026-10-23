// Светофоры: общий цикл по времени (одинаковый у всех игроков), две фазы — вдоль Невского и поперёк.

import * as THREE from 'three';
import { SIGNAL_CYCLE } from './config.js';
import { sampleAt } from './geom.js';

const { green: G, yellow: Y, allRed: R } = SIGNAL_CYCLE;
const CYCLE = 2 * (G + Y + R);

// Состояние фазы: 'green' | 'yellow' | 'red'. t — секунды общего времени.
export function phaseState(axis, t) {
  let c = ((t % CYCLE) + CYCLE) % CYCLE;
  if (axis === 1) c = (c + G + Y + R) % CYCLE;
  if (c < G) return 'green';
  if (c < G + Y) return 'yellow';
  return 'red';
}

export class Signals {
  constructor(map, graph, scene, roadAt = null) {
    this.nevsky = nevskyDir(map);
    this.byId = new Map(map.signals.map((s) => [s.id, s]));
    this.heads = [];
    this.lastState = ['', ''];
    this.time = 0;

    // Головы светофоров: для каждого ребра, проходящего через сигнал, — справа по ходу перед узлом.
    const seen = [];
    for (const e of graph.edges) {
      for (const sg of e.signals) {
        // Стойка — справа у бордюра перед перекрёстком. Узел OSM лежит на оси широкой улицы
        // (Невский), поэтому отступаем назад вдоль своей улицы, пока место не окажется на тротуаре.
        const half = e.w / 2;
        const node = this.byId.get(sg.id).p;
        let x = null, z = null, dx = 0, dz = 0;
        for (let back = 3; back <= 30 && x === null; back += 1) {
          const p = sampleAt(e.pts, e.cum, Math.max(0, sg.d - back));
          const l = Math.hypot(p.dx, p.dz) || 1;
          dx = p.dx / l;
          dz = p.dz / l;
          const cx = p.x + -dz * (half + 0.9), cz = p.z + dx * (half + 0.9);
          if (!roadAt || roadAt(cx, cz) < 0.3) {
            x = cx;
            z = cz;
            sg.stop = back + 0.5; // стоп-линия для NPC — у светофора, а не на оси перекрёстка
          }
        }
        if (x === null) continue;
        if (seen.some((s) => Math.hypot(s[0] - x, s[1] - z) < 4)) continue;
        seen.push([x, z]);
        this.heads.push({ x, z, yaw: Math.atan2(dx, dz), axis: this.axisOf(dx, dz), node, dx, dz, w: e.w });
      }
    }
    this.build(scene);
    // Для учёта проезда на красный: ось и направление у каждого сигнала.
    this.watch = this.heads.map((h) => ({ ...h, prev: null }));
  }

  axisOf(dx, dz) {
    return Math.abs(dx * this.nevsky[0] + dz * this.nevsky[1]) > 0.7071 ? 0 : 1;
  }

  state(axis) {
    return phaseState(axis, this.time);
  }

  build(scene) {
    const n = this.heads.length;
    const metal = new THREE.MeshLambertMaterial({ color: 0x2a2c31 });
    const snow = new THREE.MeshLambertMaterial({ color: 0xeceef4 });
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8);
    poleGeo.translate(0, 1.7, 0);
    const boxGeo = new THREE.BoxGeometry(0.34, 0.95, 0.24);
    boxGeo.translate(0, 3.0, 0);
    const capGeo = new THREE.BoxGeometry(0.38, 0.06, 0.28);
    capGeo.translate(0, 3.5, 0);
    const poles = new THREE.InstancedMesh(poleGeo, metal, n);
    const boxes = new THREE.InstancedMesh(boxGeo, metal, n);
    const caps = new THREE.InstancedMesh(capGeo, snow, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    this.heads.forEach((h, i) => {
      // Лицом к встречному потоку.
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw + Math.PI);
      m.compose(new THREE.Vector3(h.x, 0, h.z), q, one);
      poles.setMatrixAt(i, m);
      boxes.setMatrixAt(i, m);
      caps.setMatrixAt(i, m);
    });
    scene.add(poles, boxes, caps);

    // Лампы: по InstancedMesh на цвет и фазу, материалы переключаем раз в смену фазы.
    const colors = { red: 0xff2a1f, yellow: 0xffb21a, green: 0x2bff7a };
    const BRIGHT = 3.5; // > 1 — для bloom
    const ys = { red: 3.3, yellow: 3.0, green: 2.7 };
    this.lamps = [[], []];
    const lampGeo = new THREE.CircleGeometry(0.1, 12);
    for (const axis of [0, 1]) {
      for (const [name, c] of Object.entries(colors)) {
        const ids = this.heads.map((h, i) => (h.axis === axis ? i : -1)).filter((i) => i >= 0);
        if (!ids.length) continue;
        const mat = new THREE.MeshBasicMaterial({ color: 0x222222, fog: true });
        const mesh = new THREE.InstancedMesh(lampGeo, mat, ids.length);
        ids.forEach((hi, k) => {
          const h = this.heads[hi];
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw + Math.PI);
          const off = new THREE.Vector3(0, ys[name], 0.125).applyQuaternion(q);
          m.compose(new THREE.Vector3(h.x + off.x, off.y, h.z + off.z), q, one);
          mesh.setMatrixAt(k, m);
        });
        scene.add(mesh);
        this.lamps[axis].push({ name, mat, on: new THREE.Color(c).multiplyScalar(BRIGHT), off: new THREE.Color(0x2a2a2e) });
      }
    }
  }

  update(t) {
    this.time = t;
    for (const axis of [0, 1]) {
      const s = this.state(axis);
      if (s === this.lastState[axis]) continue;
      this.lastState[axis] = s;
      for (const l of this.lamps[axis]) l.mat.color.copy(l.name === s ? l.on : l.off);
    }
  }

  // Возвращает true, если игрок только что пересёк стоп-линию на красный.
  checkRunRed(car) {
    let ran = false;
    for (const w of this.watch) {
      const rx = car.x - w.node[0], rz = car.z - w.node[1];
      if (rx * rx + rz * rz > 400) {
        w.prev = null;
        continue;
      }
      const along = rx * w.dx + rz * w.dz;
      const side = Math.abs(rx * -w.dz + rz * w.dx);
      // Едет в ту же сторону, что и поток этой головы.
      const moving = car.vx * w.dx + car.vz * w.dz > 1;
      if (w.prev !== null && w.prev < 0 && along >= 0 && moving && side < w.w / 2 + 1 && this.state(w.axis) === 'red') ran = true;
      w.prev = along;
    }
    return ran;
  }
}

function nevskyDir(map) {
  // Общее направление Невского — по крайним точкам самого длинного куска.
  let best = null;
  let bl = 0;
  for (const r of map.roads) {
    if (r.name !== 'Невский проспект' || r.kind !== 'drive') continue;
    const a = r.p[0], b = r.p[r.p.length - 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > bl) {
      bl = l;
      best = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    }
  }
  return best ?? [1, 0];
}
