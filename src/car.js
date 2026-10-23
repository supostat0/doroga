// Модель машины (выдавленный профиль седана) и управление игрока.
// Управление в духе slow roads: плавный разгон и торможение, руль мягче на скорости,
// кузов на пружинах — крен в поворотах, клевок при торможении, приседание при разгоне.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEELBASE = 2.65;

export function makeCarModel(color = 0xf2f2f4, { taxi = false } = {}) {
  const car = new THREE.Group();
  const body = new THREE.Group(); // качается на подвеске
  car.add(body);

  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x3a3f52 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1b20 });
  const snow = new THREE.MeshLambertMaterial({ color: 0xeceef4 });
  // Свет: интенсивность > 1 — чтобы светилось через bloom.
  const tail = new THREE.MeshLambertMaterial({ color: 0x2a0406, emissive: 0xff1a14, emissiveIntensity: 0.7 });
  const head = new THREE.MeshLambertMaterial({ color: 0xdddde6, emissive: 0xfff0d8, emissiveIntensity: 2.4 });
  const reverse = new THREE.MeshLambertMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0 });
  const blinkL = new THREE.MeshLambertMaterial({ color: 0x553300, emissive: 0xff9a1a, emissiveIntensity: 0 });
  const blinkR = blinkL.clone();

  // Кузов седана: боковой профиль (длина × высота), выдавленный на ширину.
  // u — вдоль машины (перед = +u), v — высота.
  body.add(new THREE.Mesh(profile([
    [-2.2, 0.3], [2.18, 0.3], [2.25, 0.52], [2.17, 0.76], [1.2, 0.92], [-1.4, 0.95], [-2.13, 0.9], [-2.26, 0.62],
  ], 1.76), paint));
  // Салон: стёкла.
  body.add(new THREE.Mesh(profile([[1.2, 0.9], [0.32, 1.4], [-0.86, 1.42], [-1.52, 0.93]], 1.5, 0.03), glass));
  // Крыша и стойки — цвета кузова, чтобы салон не читался тёмным кубом.
  body.add(new THREE.Mesh(profile([[0.36, 1.36], [-0.88, 1.38], [-0.86, 1.45], [0.3, 1.44]], 1.54, 0.02), paint));
  const roofSnow = new THREE.Mesh(profile([[0.25, 1.45], [-0.8, 1.46], [-0.75, 1.52], [0.2, 1.51]], 1.36, 0.02), snow);
  body.add(roofSnow);
  for (const x of [-0.765, 0.765]) {
    for (const [a, b] of [[[1.2, 0.9], [0.32, 1.4]], [[-0.86, 1.42], [-1.52, 0.93]], [[-0.22, 0.93], [-0.24, 1.41]]]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, 0.09), paint);
      pillar.position.set(x, (a[1] + b[1]) / 2, -(a[0] + b[0]) / 2);
      pillar.rotation.x = -Math.atan2(b[0] - a[0], b[1] - a[1]);
      body.add(pillar);
    }
  }
  for (const x of [-0.62, 0.62]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.06), tail);
    t.position.set(x, 0.78, 2.3);
    body.add(t);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), head);
    h.position.set(x, 0.7, -2.29);
    body.add(h);
  }
  // Поворотники на углах: видны и спереди/сзади, и сбоку.
  for (const [x, mat] of [[-0.8, blinkL], [0.8, blinkR]]) {
    for (const [z, y] of [[-2.31, 0.56], [2.33, 0.64]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.08), mat);
      b.position.set(x, y, z);
      body.add(b);
    }
  }
  const rev = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), reverse);
  rev.position.set(0, 0.66, 2.33);
  body.add(rev);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.08), dark);
  bumper.position.set(0, 0.42, 2.3);
  body.add(bumper);

  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.22), new THREE.MeshLambertMaterial({ color: 0xffd23a, emissive: 0x332200 }));
    sign.position.set(0, 1.6, 0.4);
    body.add(sign);
    const checks = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.1, 2.2), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    checks.position.set(0, 0.82, 0.1);
    body.add(checks);
  }

  mergeByMaterial(body); // ~25 деталей → ~10 мешей: меньше вызовов отрисовки на машину

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.82, -1.35], [0.82, -1.35], [-0.82, 1.35], [0.82, 1.35]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.34, z);
    const w = new THREE.Mesh(wheelGeo, dark);
    pivot.add(w);
    car.add(pivot);
    wheels.push({ pivot, mesh: w, front: z < 0 });
  }
  const setLights = ({ brake = false, back = false, left = false, right = false }) => {
    tail.emissiveIntensity = brake ? 3.2 : 0.7;
    reverse.emissiveIntensity = back ? 2.2 : 0;
    blinkL.emissiveIntensity = left ? 3 : 0;
    blinkR.emissiveIntensity = right ? 3 : 0;
  };
  car.userData = { body, wheels, setLights };
  return car;
}

// Троллейбус: длинный кузов, светящийся салон, штанги до проводов. Тот же интерфейс, что у машины.
export function makeTrolleyModel(wireY) {
  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);
  const blue = new THREE.MeshLambertMaterial({ color: 0x2f64a8 });
  const white = new THREE.MeshLambertMaterial({ color: 0xd8dade });
  const salon = new THREE.MeshLambertMaterial({ color: 0x302820, emissive: 0xffe2b0, emissiveIntensity: 0.55 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1b20 });
  const snow = new THREE.MeshLambertMaterial({ color: 0xe6e8ee });
  const tail = new THREE.MeshLambertMaterial({ color: 0x2a0406, emissive: 0xff1a14, emissiveIntensity: 0.7 });
  const head = new THREE.MeshLambertMaterial({ color: 0xdddde6, emissive: 0xfff0d8, emissiveIntensity: 2.4 });
  const blinkL = new THREE.MeshLambertMaterial({ color: 0x553300, emissive: 0xff9a1a, emissiveIntensity: 0 });
  const blinkR = blinkL.clone();
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    body.add(m);
  };
  add(new THREE.BoxGeometry(2.5, 1.0, 11.6), blue, 0, 0.85, 0);
  add(new THREE.BoxGeometry(2.52, 1.25, 11.2), salon, 0, 2.0, 0.1);   // окна — светящийся салон
  add(new THREE.BoxGeometry(2.5, 0.35, 11.6), white, 0, 2.78, 0);
  add(new THREE.BoxGeometry(2.3, 0.12, 10.8), snow, 0, 3.0, 0.2);
  for (const z of [-3.4, 0, 3.4]) add(new THREE.BoxGeometry(2.56, 1.25, 0.12), white, 0, 2.0, z); // простенки
  for (const x of [-0.85, 0.85]) {
    add(new THREE.BoxGeometry(0.4, 0.14, 0.06), head, x, 0.8, -5.82);
    add(new THREE.BoxGeometry(0.4, 0.16, 0.06), tail, x, 0.9, 5.82);
    add(new THREE.BoxGeometry(0.18, 0.12, 0.08), x < 0 ? blinkL : blinkR, x * 1.25, 0.6, -5.83);
    add(new THREE.BoxGeometry(0.18, 0.12, 0.08), x < 0 ? blinkL : blinkR, x * 1.25, 0.65, 5.83);
  }
  // Штанги: от крыши сзади вперёд-вверх до проводов (±0.3 м).
  for (const x of [-0.3, 0.3]) {
    const len = Math.hypot(wireY - 3.1, 5.2);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 4), dark);
    pole.position.set(x, (wireY + 3.1) / 2, 3.2 - 2.6);
    pole.rotation.x = -Math.atan2(5.2, wireY - 3.1);
    body.add(pole);
  }
  mergeByMaterial(body);
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1.1, -3.8], [1.1, -3.8], [-1.1, 3.4], [1.1, 3.4]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.5, z);
    const w = new THREE.Mesh(wheelGeo, dark);
    pivot.add(w);
    car.add(pivot);
    wheels.push({ pivot, mesh: w, front: z < 0 });
  }
  const setLights = ({ brake = false, left = false, right = false }) => {
    tail.emissiveIntensity = brake ? 3.2 : 0.7;
    blinkL.emissiveIntensity = left ? 3 : 0;
    blinkR.emissiveIntensity = right ? 3 : 0;
  };
  car.userData = { body, wheels, setLights };
  return car;
}

// Припаркованная машина под снегом: две геометрии для инстансинга —
// paint (кузов, цвет задаётся на инстанс) и fixed (стёкла, колёса, снег — цвет в вершинах).
export function parkedCarGeometries() {
  const strip = (g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  };
  const paint = mergeGeometries([
    profile([[-2.2, 0.3], [2.18, 0.3], [2.25, 0.52], [2.17, 0.76], [1.2, 0.92], [-1.4, 0.95], [-2.13, 0.9], [-2.26, 0.62]], 1.76),
    profile([[0.36, 1.36], [-0.88, 1.38], [-0.86, 1.45], [0.3, 1.44]], 1.54, 0.02),
  ].map(strip));
  const colored = (g, hex) => {
    const n = strip(g);
    const c = new THREE.Color(hex);
    const arr = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return n;
  };
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const wheel = () => new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10).rotateZ(Math.PI / 2);
  const snow = '#e4e7ef';
  const parts = [
    colored(profile([[1.2, 0.9], [0.32, 1.4], [-0.86, 1.42], [-1.52, 0.93]], 1.5, 0.03), '#2a3040'),
    colored(profile([[0.4, 1.4], [-0.9, 1.42], [-0.8, 1.7], [0.25, 1.68]], 1.5, 0.06), snow), // шапка на крыше
    colored(box(1.62, 0.14, 0.95, 0, 0.98, -1.65), snow),  // капот
    colored(box(1.62, 0.14, 0.62, 0, 1.0, 1.78), snow),    // багажник
    colored(box(1.4, 0.06, 0.7, 0, 1.18, -0.78).rotateX(0.5), snow), // снег на лобовом
  ];
  for (const [x, z] of [[-0.82, -1.35], [0.82, -1.35], [-0.82, 1.35], [0.82, 1.35]]) {
    parts.push(colored(wheel().translate(x, 0.34, z), '#141418'));
    parts.push(colored(box(0.5, 0.26, 0.9, x * 1.2, 0.1, z), snow)); // намело у колеса
  }
  return { paint, fixed: mergeGeometries(parts) };
}

// Склеивает дочерние меши группы с одинаковым материалом в один (с учётом их положения).
function mergeByMaterial(group) {
  const byMat = new Map();
  for (const m of [...group.children]) {
    if (!m.isMesh) continue;
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(g);
    group.remove(m);
  }
  for (const [mat, geos] of byMat) group.add(new THREE.Mesh(mergeGeometries(geos), mat));
}

// Выдавливает профиль из точек [u, v] на ширину width; перед машины — по -z.
function profile(pts, width, bevel = 0.05) {
  const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export class PlayerCar {
  constructor(scene, start) {
    this.model = makeCarModel();
    scene.add(this.model);
    // Фары: один настоящий прожектор на машину игрока — освещает снег впереди.
    // Клин света от бампера вперёд (а не полоса вдали).
    const beam = new THREE.SpotLight(0xfff0d8, 40, 40, 0.62, 0.85, 1.2);
    beam.position.set(0, 0.75, -2.0);
    beam.target.position.set(0, 0, -11);
    this.model.add(beam, beam.target);
    this.blinker = 0; // -1 левый, 1 правый
    this.clock = 0;
    this.x = start.x;
    this.z = start.z;
    this.h = start.h; // курс: вперёд = (-sin h, -cos h)
    this.vx = 0;
    this.vz = 0;
    this.steer = 0;
    this.throttle = 0;
    this.speed = 0;
    // подвеска: угол и скорость угла
    this.roll = 0; this.rollV = 0;
    this.pitch = 0; this.pitchV = 0;
    this.prevVF = 0;
    this.prevVR = 0;
    this.wheelSpin = 0;
    // Бордюр: высота под каждым колесом, общая посадка и толчок на пружине.
    this.wheelH = [0, 0, 0, 0];
    this.rideY = 0;
    this.kerbPitch = 0;
    this.kerbRoll = 0;
    this.bounce = 0; this.bounceV = 0;
    this.onBump = null; // колбэк для звука удара
  }

  get forward() {
    return [-Math.sin(this.h), -Math.cos(this.h)];
  }

  update(dt, input, world) {
    const [fx, fz] = this.forward;
    const rx = -fz, rz = fx; // вправо по ходу
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    // Педаль газа нарастает плавно — отсюда мягкий разгон.
    const want = input.up ? 1 : 0;
    // Газ нарастает плавно, но быстрее прежнего: 0→50 км/ч примерно за 4 с.
    this.throttle += (want - this.throttle) * Math.min(1, dt * 2.2);
    const MAX = 24; // ~85 км/ч
    if (this.throttle > 0.01) vF += this.throttle * 6.8 * (1 - Math.pow(Math.max(0, vF) / MAX, 2)) * dt;
    if (input.down) {
      if (vF > 0.3) vF -= 7 * dt;
      else vF = Math.max(-5, vF - 3.5 * dt);
    }
    // Накат: сопротивление воздуха и качения.
    vF -= vF * 0.12 * dt + Math.sign(vF) * Math.min(Math.abs(vF), 0.35 * dt);

    // Руль: плавно, и на скорости угол меньше.
    const steerIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    // Предел руля — по боковому ускорению, которое держат шины (~6.5 м/с²):
    // на малой скорости почти полный угол (радиус ~5 м), на большой — не сорвёт в занос.
    const v2 = Math.max(1, vF * vF);
    const maxSteer = Math.min(0.5, Math.max(0.08, Math.atan((WHEELBASE * 6.5) / v2)));
    this.steer += (steerIn * maxSteer - this.steer) * Math.min(1, dt * (steerIn ? 3.5 : 4.0));
    this.h -= (vF / WHEELBASE) * Math.tan(this.steer) * dt;

    // Сцепление на снегу: боковая скорость гасится не мгновенно — машина чуть плывёт.
    const grip = input.brake ? 1.5 : 14;
    vR *= Math.exp(-grip * dt);
    if (input.brake) vF *= Math.exp(-0.9 * dt);

    const [nfx, nfz] = this.forward;
    const nrx = -nfz, nrz = nfx;
    this.vx = nfx * vF + nrx * vR;
    this.vz = nfz * vF + nrz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.collide(world);
    this.kerb(dt, world);
    this.suspension(dt, vF, vR);
    this.speed = Math.hypot(this.vx, this.vz);
    this.clock += dt;
    const blinkOn = Math.floor(this.clock * 3) % 2 === 0;
    this.blinkOn = blinkOn;
    this.model.userData.setLights({
      brake: (input.down && vF > 0.3) || input.brake,
      back: vF < -0.3,
      left: this.blinker === -1 && blinkOn,
      right: this.blinker === 1 && blinkOn,
    });
    this.sync(dt, vF);
  }

  collide(world) {
    const [fx, fz] = this.forward;
    let impact = this.wallsPass(world);
    impact = Math.max(impact, this.obstaclesPass(world));
    // Стены — ещё раз после толчков от машин и курьеров: толчок не должен вдавить сквозь ограду.
    impact = Math.max(impact, this.wallsPass(world));
    const [x0, z0, x1, z1] = world.play;
    this.x = Math.min(x1, Math.max(x0, this.x));
    this.z = Math.min(z1, Math.max(z0, this.z));
    if (impact > 1.5) this.rollV += (Math.random() - 0.5) * impact * 0.015;
  }

  wallsPass(world) {
    const [fx, fz] = this.forward;
    let impact = 0;
    for (const k of [1.25, -1.25, 0]) {
      const p = { x: this.x + fx * k, z: this.z + fz * k };
      const hit = world.walls.resolveCircle(p, k === 0 ? 0.95 : 0.92);
      if (hit) {
        this.x += p.x - (this.x + fx * k);
        this.z += p.z - (this.z + fz * k);
        const vn = this.vx * hit.nx + this.vz * hit.nz;
        if (vn < 0) {
          // Гасим скорость в стену, немного отскока и потеря хода.
          this.vx -= hit.nx * vn * 1.25;
          this.vz -= hit.nz * vn * 1.25;
          this.vx *= 0.85;
          this.vz *= 0.85;
          impact = Math.max(impact, -vn);
        }
      }
    }
    return impact;
  }

  obstaclesPass(world) {
    const [fx, fz] = this.forward;
    let impact = 0;
    // Чужие машины: у каждой два круга по длине кузова — вплотную в соседнем ряду можно проехать.
    for (const o of world.obstacles()) {
      if (Math.abs(o.x - this.x) > 10 || Math.abs(o.z - this.z) > 10) continue;
      const ofx = -Math.sin(o.h ?? 0), ofz = -Math.cos(o.h ?? 0);
      // Велосипед — один маленький круг; машина — два круга по длине, троллейбус — четыре.
      const offs = o.bike ? [0] : o.half > 2 ? [-o.half, -o.half / 3, o.half / 3, o.half] : [1.25, -1.25];
      const R = o.bike ? 1.3 : 1.85;
      for (const a of [1.25, -1.25]) {
        for (const b of offs) {
          const px = this.x + fx * a, pz = this.z + fz * a;
          const dx = px - (o.x + ofx * b), dz = pz - (o.z + ofz * b);
          const d = Math.hypot(dx, dz);
          if (d < R && d > 1e-3) {
            const nx = dx / d, nz = dz / d;
            this.x += nx * (R - d);
            this.z += nz * (R - d);
            const vn = this.vx * nx + this.vz * nz;
            if (vn < 0) {
              this.vx -= nx * vn * 1.2;
              this.vz -= nz * vn * 1.2;
              impact = Math.max(impact, -vn);
            }
          }
        }
      }
    }
    return impact;
  }

  suspension(dt, vF, vR) {
    // Ускорения в осях машины.
    const yawRate = (vF / WHEELBASE) * Math.tan(this.steer);
    const latAcc = vF * yawRate; // центростремительное
    const lonAcc = (vF - this.prevVF) / Math.max(dt, 1e-3);
    this.prevVF = vF;
    // Пружина + демпфер. Крен наружу поворота, клевок вперёд при торможении.
    // Мягкая пружина: кузов кренится чуть-чуть и плавно, без раскачки.
    const k = 22, c = 8.5;
    const rollTarget = THREE.MathUtils.clamp(latAcc * 0.0035, -0.025, 0.025);
    const pitchTarget = THREE.MathUtils.clamp(lonAcc * 0.003, -0.018, 0.018);
    this.rollV += ((rollTarget - this.roll) * k - this.rollV * c) * dt;
    this.roll += this.rollV * dt;
    this.pitchV += ((pitchTarget - this.pitch) * k - this.pitchV * c) * dt;
    this.pitch += this.pitchV * dt;
  }

  // Тротуар — на высоте бордюра. Колесо на тротуаре поднимает свой угол машины;
  // при заезде и съезде — толчок, кузов качается на пружине, скорость немного падает.
  kerb(dt, world) {
    if (!world.roadAt) return;
    const KERB = 0.14;
    const [fx, fz] = this.forward;
    const rx = -fz, rz = fx;
    const W = [[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]]; // [вправо, вперёд]
    let jolt = 0;
    W.forEach(([s, f], i) => {
      const r = world.roadAt(this.x + rx * s + fx * f, this.z + rz * s + fz * f);
      const h = KERB * Math.min(1, Math.max(0, (0.6 - r) / 0.3));
      jolt = Math.max(jolt, Math.abs(h - this.wheelH[i]));
      this.wheelH[i] = h;
    });
    const [fl, fr, rl, rr] = this.wheelH;
    const targetY = (fl + fr + rl + rr) / 4;
    this.rideY += (targetY - this.rideY) * Math.min(1, dt * 18);
    this.kerbPitch += ((fl + fr - rl - rr) / 2 / 2.7 - this.kerbPitch) * Math.min(1, dt * 18);
    this.kerbRoll += ((fr + rr - fl - rl) / 2 / 1.64 - this.kerbRoll) * Math.min(1, dt * 18);
    if (jolt > 0.06 && this.speed > 1) {
      this.bounceV += Math.min(1.2, this.speed * 0.09);
      this.pitchV += (Math.random() - 0.5) * 0.25;
      this.rollV += (Math.random() - 0.5) * 0.2;
      this.vx *= 0.94;
      this.vz *= 0.94;
      this.onBump?.(Math.min(1, this.speed / 12));
    }
    this.bounceV += (-this.bounce * 160 - this.bounceV * 11) * dt;
    this.bounce += this.bounceV * dt;
    // По снегу на тротуаре катится тяжелее.
    if (targetY > 0.07) {
      const k = Math.exp(-0.6 * dt);
      this.vx *= k;
      this.vz *= k;
    }
  }

  sync(dt, vF) {
    const m = this.model;
    m.position.set(this.x, this.rideY, this.z);
    m.rotation.y = this.h;
    const { body, wheels } = m.userData;
    body.rotation.z = this.roll + this.kerbRoll;
    body.rotation.x = this.pitch + this.kerbPitch;
    body.position.y = -Math.abs(this.pitch) * 0.6 + this.bounce * 0.06;
    this.wheelSpin += (vF / 0.34) * dt;
    wheels.forEach((w, i) => {
      // Каждое колесо — на своей высоте (на бордюре или на дороге), а не на средней.
      w.pivot.position.y = 0.34 + (this.wheelH[i] - this.rideY);
    });
    for (const w of wheels) {
      w.mesh.rotation.x = -this.wheelSpin;
      if (w.front) w.pivot.rotation.y = -this.steer;
    }
  }

  reset(spot) {
    this.x = spot.x;
    this.z = spot.z;
    this.h = spot.h;
    this.vx = this.vz = 0;
    this.steer = this.throttle = 0;
  }
}
