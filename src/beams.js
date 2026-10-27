// Свет фар машин NPC на дороге: пятно перед каждой машиной в 90 м от камеры — по той же формуле,
// что свет фары игрока, чтобы выглядело одинаково.
// Настоящие источники света дороги (каждый утяжеляет все материалы) — только у машины игрока.

import * as THREE from 'three';

const MAX = 40;

export class Beams {
  constructor(scene) {
    // Пятно считаем той же формулой, что даёт фара игрока (SpotLight в car.js: угол 0.62, полутень 0.85,
    // затухание 1.2, фара на высоте 0.75 у бампера, смотрит в точку в 9 м впереди) — по земле перед машиной.
    const W = 64, H = 64, SIDE = 7, LEN = 14; // текстура: поперёк ±7 м, вперёд 0…14 м
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');
    const img = c.createImageData(W, H);
    const axis = new THREE.Vector3(0, -0.75, -9).normalize();
    const cosOut = Math.cos(0.62), cosIn = Math.cos(0.62 * (1 - 0.85));
    const val = [];
    let max = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const s = ((i + 0.5) / W - 0.5) * 2 * SIDE, d = (1 - (j + 0.5) / H) * LEN; // низ текстуры — у машины
      const v = new THREE.Vector3(s, -0.75, -d), dist = v.length();
      const ca = v.normalize().dot(axis);
      const spot = THREE.MathUtils.smoothstep(ca, cosOut, cosIn);
      const e = (spot * (0.75 / dist)) / Math.pow(dist, 1.2);
      val.push(e);
      max = Math.max(max, e);
    }
    val.forEach((e, k) => {
      const a = Math.min(1, e / max) ** 0.8;
      img.data.set([255, 246, 232, a * 255], k * 4);
    });
    c.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(2 * SIDE, LEN).rotateX(-Math.PI / 2).translate(0, 0, -LEN / 2); // перед машиной (−z)
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  update(cars, cam) {
    let n = 0;
    for (const c of cars) {
      if (n >= MAX) break;
      if (Math.abs(c.x - cam.x) > 90 || Math.abs(c.z - cam.z) > 90) continue;
      const fx = -Math.sin(c.h), fz = -Math.cos(c.h), front = c.half ?? 2.2;
      this.q.setFromAxisAngle(this.up, c.h);
      this.m.compose(new THREE.Vector3(c.x + fx * front, 0.06, c.z + fz * front), this.q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
