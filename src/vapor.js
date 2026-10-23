// Пар и дым: выхлоп машин на морозе, пар из люков, дымок из печных труб.
// Общий пул частиц, подсвечиваются городским светом.

import * as THREE from 'three';
import { LIGHT_UNIFORMS, LIGHT_GLSL } from './shaders.js';
import { WEATHER } from './config.js';

const N = 1400;
const LIFE = 1.3; // базовая жизнь; у дыма и пара из люков — дольше (через aScale)

export class Vapor {
  constructor(scene) {
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N).fill(99);
    this.life = new Float32Array(N).fill(LIFE);
    this.size = new Float32Array(N).fill(1);
    this.alpha = new Float32Array(N).fill(1);
    this.emitters = []; // статичные: люки и трубы
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAge = new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aAge', this.aAge);
    this.aLife = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLife', this.aLife);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPx: { value: 1 }, ...LIGHT_UNIFORMS },
      vertexShader: /* glsl */ `
        attribute float aAge;
        attribute float aLife;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPx;
        varying float vA;
        varying vec3 vCol;
        ${LIGHT_GLSL}
        void main() {
          float t = aAge / aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Не больше 14 «пикселей» и не у самой камеры — иначе облачко закрывает полэкрана.
          gl_PointSize = min(14.0 * aSize, uPx * (0.3 + t * 0.9) * aSize * 700.0 / max(-mv.z, 0.5));
          vA = (1.0 - t) * smoothstep(0.0, 0.15, t) * 0.09 * aAlpha * step(t, 1.0);
          float fog = 1.0 - exp(-pow(-mv.z * ${WEATHER.fogDensity}, 2.0));
          vA *= (1.0 - fog) * smoothstep(3.0, 6.0, -mv.z);
          vCol = vec3(0.3, 0.31, 0.38) + cityLight(position.xz) * 1.2;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying vec3 vCol;
        void main() {
          // Пиксельно: жёсткий край и ступенчатая прозрачность вместо мягкого градиента.
          vec2 q = gl_PointCoord - 0.5;
          float r = max(abs(q.x), abs(q.y)) * 0.6 + length(q) * 0.4; // скруглённый квадрат
          if (r > 0.42) discard;
          float a = floor((vA * (r < 0.25 ? 1.0 : 0.6)) * 12.0 + 0.5) / 12.0;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vCol, a);
        }
      `,
    });
    this.mat = mat;
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 9;
    scene.add(pts);
    this.timers = new Map();
  }

  // cars: [{x, z, h, speed|v, throttle?}]
  update(dt, cars, pixelRatio, cam) {
    this.cam = cam;
    this.mat.uniforms.uPx.value = pixelRatio;
    for (const c of cars) {
      const v = c.speed ?? c.v;
      // Чаще пыхтит на газу и на холостых, реже на ходу.
      const rate = 0.26 + Math.min(0.2, v * 0.015) - (c.throttle ?? 0) * 0.06;
      let t = (this.timers.get(c) ?? Math.random() * rate) - dt;
      while (t < 0) {
        this.emit(c, v);
        t += rate;
      }
      this.timers.set(c, t);
    }
    // Статичные источники: только рядом с камерой.
    for (const em of this.emitters) {
      if (Math.abs(em.x - this.cam.x) > 120 || Math.abs(em.z - this.cam.z) > 120) continue;
      em.t = (em.t ?? Math.random() * em.rate) - dt;
      while (em.t < 0) {
        this.emitAt(em);
        em.t += em.rate * (0.7 + Math.random() * 0.6);
      }
    }
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const k = Math.exp(-dt * 2.2);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] += dt * 0.25; // тёплый — поднимается
      this.pos[i * 3] += (this.vel[i * 3] + WEATHER.wind[0] * 0.4) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + WEATHER.wind[2] * 0.4) * dt;
    }
    this.aPos.needsUpdate = true;
    this.aAge.needsUpdate = true;
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  emit(c, v) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    const fx = -Math.sin(c.h), fz = -Math.cos(c.h);
    const rx = -fz, rz = fx;
    // Труба — сзади справа, низко.
    this.pos[i * 3] = c.x - fx * 2.3 + rx * 0.45;
    this.pos[i * 3 + 1] = (c.rideY ?? 0) + 0.3;
    this.pos[i * 3 + 2] = c.z - fz * 2.3 + rz * 0.45;
    // Выдох назад + скорость машины (облачко остаётся на месте, когда машина уезжает).
    const out = 1.2 + Math.random() * 0.6;
    this.vel[i * 3] = -fx * out + (Math.random() - 0.5) * 0.4 + fx * v * 0.15;
    this.vel[i * 3 + 1] = 0.15 + Math.random() * 0.2;
    this.vel[i * 3 + 2] = -fz * out + (Math.random() - 0.5) * 0.4 + fz * v * 0.15;
    this.age[i] = 0;
    this.life[i] = LIFE;
    this.size[i] = 1;
    this.alpha[i] = 1;
  }

  // Частица от статичного источника (люк, труба).
  emitAt(em) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.pos[i * 3] = em.x + (Math.random() - 0.5) * em.spread;
    this.pos[i * 3 + 1] = em.y;
    this.pos[i * 3 + 2] = em.z + (Math.random() - 0.5) * em.spread;
    this.vel[i * 3] = (Math.random() - 0.5) * 0.3;
    this.vel[i * 3 + 1] = em.vy * (0.7 + Math.random() * 0.6);
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    this.age[i] = 0;
    this.life[i] = em.life;
    this.size[i] = em.size;
    this.alpha[i] = em.alpha;
  }
}
