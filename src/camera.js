// Камера за машиной: мягко догоняет, не залезает в стены. C — следующий режим.
// Осмотр: тянуть мышью (или пальцем) — облёт вокруг машины, колесо — ближе/дальше,
// V (держать) — взгляд назад, двойной клик — сразу вернуть. Отпустил — камера сама
// плавно возвращается за машину: на ходу через 1.5 с, на стоянке через 6 с.
// G — свободный полёт (временное, чтобы осматривать город): WASD, E/Q — выше/ниже, Shift — быстрее.

import * as THREE from 'three';

const MODES = [
  { back: 6.8, up: 2.3, look: 5, lookUp: 1.1, fov: 60 },  // как в slow roads
  { back: 11, up: 4.2, look: 6, lookUp: 1.0, fov: 58 },   // дальше и выше
  { back: -0.3, up: 1.25, look: 20, lookUp: 1.1, fov: 70, inside: true }, // из салона
];

export class ChaseCamera {
  constructor(camera, walls, dom) {
    this.camera = camera;
    this.walls = walls;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 3, 0);
    this.look = new THREE.Vector3();
    this.yaw = null;
    // Осмотр.
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.zoom = 1;
    this.dragging = false;
    this.idle = 99; // секунд с последнего движения мышью
    this.back = false;
    this.fly = null; // { yaw, pitch } — свободный полёт
    this.bind(dom);
  }

  bind(dom) {
    let px = 0, py = 0;
    dom.style.cursor = 'grab';
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      px = e.clientX;
      py = e.clientY;
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = 'grabbing';
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      if (this.fly) {
        this.fly.yaw -= (e.clientX - px) * 0.005;
        this.fly.pitch = THREE.MathUtils.clamp(this.fly.pitch - (e.clientY - py) * 0.005, -1.5, 1.5);
        px = e.clientX;
        py = e.clientY;
        return;
      }
      this.lookYaw -= (e.clientX - px) * 0.006;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + (e.clientY - py) * 0.004, -0.25, 0.9);
      px = e.clientX;
      py = e.clientY;
      this.idle = 0;
    });
    const up = () => {
      this.dragging = false;
      this.idle = 0;
      dom.style.cursor = 'grab';
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => {
      this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + e.deltaY * 0.001), 0.6, 2.2);
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('dblclick', () => this.reset());
    addEventListener('keydown', (e) => { if (e.code === 'KeyV') this.back = true; });
    addEventListener('keyup', (e) => { if (e.code === 'KeyV') this.back = false; });
  }

  reset() {
    this.idle = 99;
    this.snapBack = true;
  }

  toggleFly() {
    if (this.fly) { this.fly = null; this.reset(); return; }
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.fly = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) };
  }

  // Полёт: keys — { up, down, left, right, rise, sink, fast }. Стрелки ◀▶ на телефоне — поворот.
  updateFly(dt, keys, touchTurn) {
    const f = this.fly;
    if (touchTurn) f.yaw += ((keys.left ? 1 : 0) - (keys.right ? 1 : 0)) * dt * 1.5;
    const sp = (keys.fast ? 60 : 18) * dt;
    const fx = -Math.sin(f.yaw) * Math.cos(f.pitch), fy = Math.sin(f.pitch), fz = -Math.cos(f.yaw) * Math.cos(f.pitch);
    const rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
    const fwd = (keys.up ? 1 : 0) - (keys.down ? 1 : 0), side = touchTurn ? 0 : (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const p = this.camera.position;
    p.x += (fx * fwd + rx * side) * sp;
    p.z += (fz * fwd + rz * side) * sp;
    p.y = Math.max(0.5, p.y + fy * fwd * sp + ((keys.rise ? 1 : 0) - (keys.sink ? 1 : 0)) * sp);
    this.camera.lookAt(p.x + fx, p.y + fy, p.z + fz);
    this.pos.copy(p);
  }

  nextMode() {
    this.mode = (this.mode + 1) % MODES.length;
    this.lookYaw = this.lookPitch = 0;
  }

  // car — машина или пешеход (у него свой режим камеры camMode).
  update(dt, car) {
    const m = car.camMode ?? MODES[this.mode];
    // Камера поворачивает вслед за машиной с запаздыванием — так чувствуется поворот.
    if (this.yaw === null) this.yaw = car.h;
    let d = car.h - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * (m.inside ? 20 : 3.2));

    // Возврат осмотра в исходное положение.
    if (!this.dragging) {
      this.idle += dt;
      const wait = car.speed > 2 ? 1.5 : 6;
      if (this.idle > wait || this.snapBack) {
        const k = Math.min(1, dt * (this.snapBack ? 6 : 2.2));
        this.lookYaw = Math.atan2(Math.sin(this.lookYaw), Math.cos(this.lookYaw)) * (1 - k);
        this.lookPitch *= 1 - k;
        if (Math.abs(this.lookYaw) < 0.01 && Math.abs(this.lookPitch) < 0.01) this.snapBack = false;
      }
    }
    const extraYaw = this.lookYaw + (this.back ? Math.PI : 0);
    const a = this.yaw + extraYaw;
    const fx = -Math.sin(a), fz = -Math.cos(a);

    let tx, tz, ty;
    if (m.inside) {
      tx = car.x - fx * m.back;
      tz = car.z - fz * m.back;
      ty = m.up + (car.rideY ?? 0);
    } else {
      // Облёт: расстояние и угол возвышения — от режима, осмотра и колеса мыши.
      const dist = Math.hypot(m.back, m.up - m.lookUp) * this.zoom;
      const elev = Math.atan2(m.up - m.lookUp, m.back) + this.lookPitch;
      tx = car.x - fx * dist * Math.cos(elev);
      tz = car.z - fz * dist * Math.cos(elev);
      ty = m.lookUp + dist * Math.sin(elev);
      const k = this.walls.raycast(car.x, car.z, tx, tz);
      if (k < 1) {
        tx = car.x + (tx - car.x) * Math.max(0.15, k - 0.08);
        tz = car.z + (tz - car.z) * Math.max(0.15, k - 0.08);
      }
    }
    const target = new THREE.Vector3(tx, ty, tz);
    // Пока тянем мышью — камера идёт за рукой почти без задержки.
    if (m.inside) this.pos.copy(target);
    else this.pos.lerp(target, Math.min(1, dt * (this.dragging || this.back ? 14 : 6)));

    // Смотрим вперёд по ходу; при облёте — больше на саму машину.
    const ahead = m.look * Math.max(0, Math.cos(extraYaw));
    if (m.inside) {
      this.look.set(car.x + fx * m.look, m.lookUp - this.lookPitch * 8, car.z + fz * m.look);
    } else {
      const cf = car.forward;
      this.look.set(car.x + cf[0] * ahead, m.lookUp, car.z + cf[1] * ahead);
    }
    this.camera.position.copy(this.pos);
    if (m.inside) this.camera.position.y += car.model.userData.body.rotation.x * 0.5;
    this.camera.lookAt(this.look);
    if (m.inside) this.camera.rotation.z += car.roll * 0.5;
    // Чуть шире угол на скорости.
    const fov = m.fov + Math.min(8, car.speed * 0.3);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 2);
      this.camera.updateProjectionMatrix();
    }
    car.model.visible = !m.inside || this.back;
  }
}
