import * as THREE from 'three';

// Общие куски GLSL и помощник для подмешивания своего цвета в стандартные материалы three.js
// (так сохраняются штатные свет и туман).

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
`;

// Карта городского света (фонари, витрины, вывески) — общая для всех материалов.
// Заполняется в lights.js; до этого — чёрная.
export const LIGHT_UNIFORMS = {
  uLight: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },
  uLightRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uTime: { value: 0 }, // секунды — для мелочей жизни (окна гаснут/зажигаются)
};
export const LIGHT_GLSL = /* glsl */ `
uniform sampler2D uLight;
uniform vec4 uLightRect;
uniform float uTime;
vec3 cityLight(vec2 xz) {
  vec3 l = texture2D(uLight, (xz - uLightRect.xy) * uLightRect.zw).rgb;
  return l * l * 2.2; // квадрат — мягкий центр и быстрый спад
}
`;
LIGHT_UNIFORMS.uLight.value.needsUpdate = true;

// colorCode — GLSL, который должен записать vec3 col. Доступны vWorld (vec3) и NOISE_GLSL.
// emissive: true — colorCode может писать в gEmit (свечение, не зависит от освещения).
// vertexBegin — GLSL, меняющий transformed (позицию вершины) до всех преобразований.
export function patchMaterial(material, { uniforms = {}, header = '', vertexHeader = '', vertexBegin = '', vertexMain = '', colorCode, emissive = false }) {
  // Без своего ключа three.js отдаст всем таким материалам одну программу:
  // текст onBeforeCompile у них одинаковый.
  const key = colorCode + header + vertexBegin + vertexMain + emissive;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, LIGHT_UNIFORMS, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorld;\n${vertexHeader}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBegin}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef USE_INSTANCING\nvWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif\n${vertexMain}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorld;\n${NOISE_GLSL}\n${LIGHT_GLSL}\n${header}`)
      .replace('#include <common>', `#include <common>\nvec3 gEmit;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec3 col = diffuse;\ngEmit = vec3(0.0);\n${colorCode}\nvec4 diffuseColor = vec4( col, opacity );`);
    if (emissive) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;',
      );
    }
  };
  return material;
}
