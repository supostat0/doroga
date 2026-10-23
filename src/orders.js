// Необязательная цель: развоз заказов. O — включить/выключить. Без таймеров и штрафов:
// забери в кафе (жёлтый луч), отвези по адресу (зелёный луч), остановись рядом.
// Заведения — настоящие, из OSM (те же, что на вывесках).

import * as THREE from 'three';

const FOOD = /amenity:(cafe|restaurant|fast_food|bar|pub)|shop:(bakery|confectionery)/;

export class Orders {
  constructor(signs, scene, sound) {
    this.sound = sound;
    // Точка у входа: на тротуаре перед вывеской.
    this.places = signs.map((s) => {
      const f = s.f;
      const dx = (f.b[0] - f.a[0]) / f.L, dz = (f.b[1] - f.a[1]) / f.L;
      return { name: s.name, cat: s.cat, x: f.a[0] + dx * s.c + f.n[0] * 2.2, z: f.a[1] + dz * s.c + f.n[1] * 2.2 };
    });
    this.food = this.places.filter((p) => FOOD.test(p.cat));
    this.on = false;
    this.done = 0;
    this.stage = null; // 'pickup' | 'drop'
    this.el = document.getElementById('order');
    this.beam = makeBeam(scene);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyO') this.toggle();
    });
  }

  toggle() {
    this.on = !this.on;
    this.beam.visible = this.on;
    this.stage = null;
    this.el.hidden = !this.on;
  }

  pick(list, from, min, max) {
    const ok = list.filter((p) => {
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      return d > min && d < max;
    });
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : list[Math.floor(Math.random() * list.length)];
  }

  update(dt, t, car) {
    if (!this.on) return;
    if (!this.stage) {
      this.from = this.pick(this.food, car, 80, 350);
      this.stage = 'pickup';
      this.wait = 0;
    }
    const target = this.stage === 'pickup' ? this.from : this.to;
    const d = Math.hypot(target.x - car.x, target.z - car.z);
    // Остановился рядом — секунда, и готово.
    this.wait = d < 9 && car.speed < 1.5 ? this.wait + dt : 0;
    if (this.wait > 1) {
      if (this.stage === 'pickup') {
        this.to = this.pick(this.places.filter((p) => p !== this.from), car, 150, 450);
        this.stage = 'drop';
      } else {
        this.done++;
        this.stage = null;
      }
      this.sound?.chime();
      this.wait = 0;
      return;
    }
    // Луч над точкой.
    this.beam.position.set(target.x, 0, target.z);
    this.beam.userData.mat.color.set(this.stage === 'pickup' ? 0xffc23a : 0x4bea8a).multiplyScalar(1.6);
    this.beam.userData.mat.opacity = 0.35 + 0.1 * Math.sin(t * 3);
    // Подсказка: куда и сколько.
    const [fx, fz] = car.forward;
    const ax = target.x - car.x, az = target.z - car.z;
    const ang = Math.atan2(ax * -fz + az * fx, ax * fx + az * fz); // > 0 — справа
    const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    const arrow = arrows[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
    const what = this.stage === 'pickup' ? `Забери заказ в «${target.name}»` : `Отвези: «${target.name}»`;
    this.el.textContent = `${what} · ${Math.round(d)} м ${arrow}${this.done ? `   ·   доставлено: ${this.done}` : ''}`;
  }
}

function makeBeam(scene) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 30, 10, 1, true), mat);
  beam.position.y = 15;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 24).rotateX(-Math.PI / 2), mat);
  ring.position.y = 0.2;
  g.add(beam, ring);
  g.userData.mat = mat;
  g.visible = false;
  scene.add(g);
  return g;
}
