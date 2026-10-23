// Пиксельный рендер: сцена рисуется в низком разрешении, растягивается без сглаживания (CSS),
// сверху bloom для огней и лёгкий дизеринг с ограничением палитры.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { PIXEL_HEIGHT } from './config.js';

const DitherShader = {
  uniforms: { tDiffuse: { value: null }, uLevels: { value: 36 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uLevels;
    varying vec2 vUv;
    float bayer4(vec2 p) {
      ivec2 i = ivec2(mod(p, 4.0));
      int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
      return float(m[i.y * 4 + i.x]) / 16.0 - 0.47;
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // Виньетка — взгляд в центр, края тонут в ночи.
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.55;
      c = floor(c * uLevels + bayer4(gl_FragCoord.xy) + 0.5) / uLevels;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function makePost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(DitherShader));

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(1, PIXEL_HEIGHT / h));
    renderer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  return composer;
}
