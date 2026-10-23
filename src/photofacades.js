// Фасады по разметке фото (tools/facade.html): генератор рисует чистый пиксельный фасад
// по параметрам и маску стекла; квадрат ставится поверх процедурной стены.
// Ночь: окна верхних этажей горят вразнобой (каждое целиком), проёмы первого этажа — почти все.
import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { drawFacade, facadeSections } from './facadegen.js';

// Список размеченных фасадов (пустой, если их ещё нет).
export async function loadFacadeList() {
  try {
    return (await (await fetch('./facades/index.json')).json()).filter((f) => f.params);
  } catch {
    return [];
  }
}

export function addPhotoFacades(scene, list) {
  for (const f of list) {
    scene.add(Object.assign(facadeMesh(f), { name: 'photo-facade' }));
    const v = sectionVolumes(f);
    if (v) scene.add(v);
  }
}

function texture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function facadeMesh(f) {
  const [ax, az] = f.a, [bx, bz] = f.b;
  const L = Math.hypot(bx - ax, bz - az);
  // a — слева для зрителя снаружи, значит наружу — поворот (b − a) на 90°.
  // Отступ больше 5 см: стены частей зданий (pt) сами отодвинуты на 5 см наружу.
  const nx = -(bz - az) / L, nz = (bx - ax) / L, off = 0.09;
  const { albedo, mask, Htot } = drawFacade(f.params, L, f.h);
  const y0 = f.base, y1 = f.base + Htot;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    ax + nx * off, y0, az + nz * off, bx + nx * off, y0, bz + nz * off,
    bx + nx * off, y1, bz + nz * off, ax + nx * off, y1, az + nz * off,
  ], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);

  const alb = texture(albedo);
  alb.colorSpace = THREE.SRGBColorSpace;
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), {
    emissive: true,
    uniforms: { uFacade: { value: alb }, uMask: { value: texture(mask) } },
    header: 'uniform sampler2D uFacade; uniform sampler2D uMask; varying vec2 vFUv;',
    vertexHeader: 'varying vec2 vFUv;',
    vertexMain: 'vFUv = uv;',
    colorCode: /* glsl */ `
      vec4 fc = texture2D(uFacade, vFUv);
      if (fc.a < 0.5) discard; // над низкой секцией — небо
      col = fc.rgb;
      vec3 mk = texture2D(uMask, vFUv).rgb; // r — окно, g — проём первого этажа, b — номер окна
      float y = vWorld.y;
      float lit = mk.b;
      // Окно живёт: свой период, иногда гаснет или зажигается.
      float period = 25.0 + lit * 70.0;
      float on = step(0.5, hash12(vec2(lit * 113.0, floor((uTime + lit * 997.0) / period))));
      vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.88, 0.7), fract(lit * 7.0));
      gEmit = col * (cityLight(vWorld.xz) * exp(-max(y - 1.0, 0.0) / 9.0) * 1.1 + vec3(0.05, 0.045, 0.06));
      gEmit += warm * (mk.r * on * 0.32 + mk.g * 0.5 * step(0.12, fract(lit * 3.0)));
    `,
  });
  return new THREE.Mesh(g, mat);
}

// Секции выше дома: объём глубиной 2 м за фасадом (иначе над крышей висела бы плоская картинка).
function sectionVolumes(f) {
  const [ax, az] = f.a, [bx, bz] = f.b;
  const L = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx, depth = 2;
  const box = [];
  for (const q of facadeSections(f.params, L, f.h)) {
    if (!q.own || q.top <= f.h + 0.1) continue;
    const g = new THREE.BoxGeometry(q.u1 - q.u0, q.top - f.h, depth);
    // Ось x бокса — вдоль стены, z — наружу; задняя грань уходит внутрь дома.
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(tx, 0, tz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
    const c = (q.u0 + q.u1) / 2;
    m.setPosition(ax + tx * c - nx * (depth / 2 - 0.05), f.base + (f.h + q.top) / 2, az + tz * c - nz * (depth / 2 - 0.05));
    box.push(g.applyMatrix4(m));
  }
  if (!box.length) return null;
  const color = new THREE.Color(f.params.wall || '#8a9aa8').multiplyScalar(0.5);
  return new THREE.Mesh(mergeBoxes(box), new THREE.MeshLambertMaterial({ color }));
}

function mergeBoxes(geos) {
  const pos = [], nrm = [], idx = [];
  for (const g of geos) {
    const off = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    idx.push(...g.index.array.map((i) => i + off));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}
