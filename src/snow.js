// Снегопад: частицы в кубе вокруг камеры, позиции заворачиваются в шейдере — без обновлений с CPU.

import * as THREE from 'three';
import { WEATHER } from './config.js';
import { LIGHT_UNIFORMS, LIGHT_GLSL } from './shaders.js';

const BOX = 70;

export function makeSnow(scene) {
  const n = WEATHER.snowFlakes;
  const pos = new Float32Array(n * 3);
  const rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = Math.random() * BOX;
    pos[i * 3 + 1] = Math.random() * BOX;
    pos[i * 3 + 2] = Math.random() * BOX;
    rnd[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3(...WEATHER.wind) },
      uPx: { value: 1 },
      ...LIGHT_UNIFORMS,
    },
    vertexShader: /* glsl */ `
      attribute float aRnd;
      uniform vec3 uCam;
      uniform vec3 uWind;
      uniform float uPx;
      varying float vAlpha;
      varying vec3 vCol;
      ${LIGHT_GLSL}
      void main() {
        float fall = 1.1 + aRnd * 0.9;
        vec3 p = position + uWind * uTime + vec3(0.0, -fall * uTime, 0.0);
        // Лёгкое кружение.
        p.x += sin(uTime * (0.6 + aRnd) + aRnd * 30.0) * 0.4;
        p.z += cos(uTime * (0.5 + aRnd) + aRnd * 20.0) * 0.4;
        p = mod(p - uCam + ${BOX / 2}.0, ${BOX}.0) - ${BOX / 2}.0 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = max(1.0, uPx * (0.05 + aRnd * 0.06) * 600.0 / max(d, 0.5));
        vAlpha = smoothstep(0.3, 2.0, d) * (1.0 - smoothstep(18.0, ${BOX / 2}.0, d));
        // Снежинки вспыхивают в свете фонарей и витрин.
        vCol = vec3(0.32, 0.34, 0.45) + cityLight(p.xz) * 1.6;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.15, r) * vAlpha * 0.9;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol, a);
      }
    `,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 10;
  scene.add(pts);
  return {
    update(t, camera, pixelRatio) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uCam.value.copy(camera.position);
      mat.uniforms.uPx.value = pixelRatio;
    },
  };
}
