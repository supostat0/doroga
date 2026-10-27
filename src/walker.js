// Пешком: F — выйти из машины (и сесть обратно рядом с ней). Человечок как у прохожих, W/S — идти,
// A/D — поворот, Shift — бегом. Сквозь проёмы арок проходит (они препятствие только для машины,
// 6-й элемент отрезка — 1), стены, заборы, своды арок — препятствия.

import * as THREE from 'three';

const R = 0.3; // радиус человечка
const CAM = { back: 3.4, up: 2.0, look: 3, lookUp: 1.45, fov: 62 }; // камера за спиной (для ChaseCamera)

export class Walker {
  constructor(scene) {
    this.x = 0; this.z = 0; this.h = 0; this.speed = 0;
    this.rideY = 0; this.roll = 0; this.camMode = CAM;
    this.phase = 0;
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const box = (w, h, d, y, m) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, y, 0), m); return g; };
    this.model = new THREE.Group();
    const coat = mat(0x2f4a6b), pants = mat(0x26262c), skin = mat(0xe0b896);
    this.legs = [0.1, -0.1].map((x) => { const l = box(0.15, 0.8, 0.17, -0.4, pants); l.position.set(x, 0.82, 0); return l; });
    this.arms = [0.28, -0.28].map((x) => { const a = box(0.11, 0.58, 0.12, -0.27, coat); a.position.set(x, 1.4, 0); return a; });
    const body = box(0.44, 0.62, 0.26, 0.31, coat); body.position.y = 0.82;
    const head = box(0.25, 0.25, 0.25, 0.125, skin); head.position.y = 1.46;
    const hat = box(0.28, 0.12, 0.28, 0.06, mat(0x8a2b2b)); hat.position.y = 1.7;
    this.model.add(...this.legs, ...this.arms, body, head, hat);
    this.model.userData.body = body;
    this.model.visible = false;
    scene.add(this.model);
  }

  get forward() { return [-Math.sin(this.h), -Math.cos(this.h)]; }

  // Выйти слева от машины (со стороны водителя).
  exit(car, walls) {
    const [fx, fz] = car.forward;
    this.x = car.x + fz * 1.7; this.z = car.z - fx * 1.7;
    this.h = car.h; this.speed = 0;
    this.collide(walls);
    this.model.visible = true;
  }

  near(car) { return Math.hypot(car.x - this.x, car.z - this.z) < 3.5; }

  hide() { this.model.visible = false; }

  update(dt, input, run, walls) {
    const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.h += turn * dt * 2.6;
    const want = ((input.up ? 1 : 0) - (input.down ? 0.6 : 0)) * (run ? 4.2 : 1.6);
    this.speed += (want - this.speed) * Math.min(1, dt * 8);
    const [fx, fz] = this.forward;
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;
    this.collide(walls);
    // Шаг: ноги и руки качаются в такт.
    this.phase += Math.abs(this.speed) * dt * 3.2;
    const sw = Math.sin(this.phase) * Math.min(1, Math.abs(this.speed)) * 0.6;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    this.arms[0].rotation.x = -sw; this.arms[1].rotation.x = sw;
    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.h;
  }

  // Как SegmentGrid.resolveCircle, но проёмы арок пропускаем.
  collide(walls) {
    for (const i of walls.near(this.x, this.z, R + 1, this._tmp || (this._tmp = new Set()))) {
      const [ax, az, bx, bz, , carOnly] = walls.segs[i];
      if (carOnly) continue;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((this.x - ax) * dx + (this.z - az) * dz) / l2));
      let nx = this.x - (ax + dx * t), nz = this.z - (az + dz * t);
      const d = Math.hypot(nx, nz);
      if (d < R && d > 1e-6) { this.x += (nx / d) * (R - d); this.z += (nz / d) * (R - d); }
    }
  }
}
