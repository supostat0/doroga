// Следы шин на снегу (игрок и машины рядом с камерой): примятый мокрый снег за задними колёсами,
// снег их постепенно заметает.
// Пул из N отпечатков (одно рисование), прозрачность — по возрасту.

import * as THREE from 'three';
import { WEATHER } from './config.js';

const N = 6000;
const LIFE = 35; // секунд до полного исчезновения (снег заметает)
const STEP = 0.45; // м между отпечатками

export class Tracks {
  constructor(scene, roadAt) {
    this.roadAt = roadAt;
    this.next = 0;
    this.dist = 0;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(0.24, STEP + 0.05).rotateX(-Math.PI / 2);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage); // x, y, z, yaw
    this.iBorn = new THREE.InstancedBufferAttribute(new Float32Array(N).fill(-1e6), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iBorn', this.iBorn);
    g.instanceCount = N;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color(WEATHER.fogColor) } },
      vertexShader: /* glsl */ `
        attribute vec4 iPos;
        attribute float iBorn;
        uniform float uTime;
        varying float vA;
        varying float vFog;
        void main() {
          float c = cos(iPos.w), s = sin(iPos.w);
          vec3 p = vec3(position.x * c + position.z * s, 0.0, -position.x * s + position.z * c) + iPos.xyz;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float age = (uTime - iBorn) / ${LIFE}.0;
          vA = 0.2 * (1.0 - smoothstep(0.0, 1.0, age)) * step(0.0, age);
          vFog = 1.0 - exp(-pow(-mv.z * ${WEATHER.fogDensity}, 2.0));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFog;
        varying float vA;
        varying float vFog;
        void main() {
          if (vA < 0.01) discard;
          // Мокрый примятый снег — чуть темнее, без чёрноты.
          gl_FragColor = vec4(mix(vec3(0.12, 0.12, 0.16), uFog, vFog), vA * (1.0 - vFog));
        }
      `,
    });
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  // cars — машины рядом с камерой (игрок и NPC): у каждого свой счётчик пройденного.
  update(dt, t, cars) {
    this.mat.uniforms.uTime.value = t;
    for (const car of cars) this.emit(dt, t, car);
  }

  emit(dt, t, car) {
    const v = car.speed ?? car.v;
    car._trk = (car._trk ?? 0) + v * dt;
    if (car._trk < STEP || v < 0.3) return;
    car._trk = 0;
    const fx = -Math.sin(car.h), fz = -Math.cos(car.h);
    const back = car.half ? car.half - 1.6 : 1.35;
    const rx = -fz, rz = fx;
    for (const side of [-0.82, 0.82]) {
      const x = car.x - fx * back + rx * side, z = car.z - fz * back + rz * side;
      const onWalk = this.roadAt(x, z) < 0.4; // на тротуаре — выше (поднятая земля)
      const i = this.next;
      this.next = (this.next + 1) % N;
      this.iPos.setXYZW(i, x, (onWalk ? 0.14 : 0) + 0.01, z, Math.atan2(fx, fz));
      this.iBorn.setX(i, t);
    }
    this.iPos.needsUpdate = true;
    this.iBorn.needsUpdate = true;
  }
}
