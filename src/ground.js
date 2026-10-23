// Земля: маска (проезжая часть, тротуары, колеи, разметка) рисуется на canvas,
// а мелкая фактура — процедурно в шейдере. Плюс вода (лёд), гранитные набережные и мосты.

import * as THREE from 'three';
import { patchMaterial } from './shaders.js';
import { offsetPolyline, distToPolyline } from './geom.js';

const MASK_SIZE = 4096;
const NEAR_SIZE = 120; // подробная земля вокруг камеры, м
const NEAR_STEP = 0.6;
const KERB_H = 0.14;
const WATER_LEVEL = -2.3;

export function buildGround(map, scene) {
  const [x0, z0, x1, z1] = map.ext;
  const W = x1 - x0;
  const H = z1 - z0;
  const mask = drawMask(map, x0, z0, W, H);

  const tex = new THREE.DataTexture(mask.data, MASK_SIZE, MASK_SIZE, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  const material = groundMaterial(tex, x0, z0, W, H, nevskyAngle(map));

  // Земля с дырами под воду.
  const shape = new THREE.Shape([
    new THREE.Vector2(x0, -z0), new THREE.Vector2(x1, -z0), new THREE.Vector2(x1, -z1), new THREE.Vector2(x0, -z1),
  ]);
  for (const w of map.water) {
    shape.holes.push(new THREE.Path(shrinkToRect(w.o, map.ext, 0.5).map(([x, z]) => new THREE.Vector2(x, -z))));
  }
  const groundGeo = new THREE.ShapeGeometry(shape);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, material);
  scene.add(ground);

  // Подробная земля вокруг камеры с поднятыми тротуарами; ездит за камерой с шагом сетки.
  const waterCv = document.createElement('canvas');
  waterCv.width = waterCv.height = 1024;
  const wc = waterCv.getContext('2d');
  wc.fillStyle = '#fff';
  for (const w of map.water) {
    wc.beginPath();
    w.o.forEach(([x, z], i) => (i ? wc.lineTo : wc.moveTo).call(wc, ((x - x0) / W) * 1024, ((z - z0) / H) * 1024));
    wc.closePath();
    wc.fill();
  }
  const waterTex = new THREE.CanvasTexture(waterCv);
  waterTex.flipY = false;
  const center = { value: new THREE.Vector2() };
  const nearMat = groundMaterial(tex, x0, z0, W, H, nevskyAngle(map), { water: waterTex, center });
  const n = Math.round(NEAR_SIZE / NEAR_STEP);
  const nearGeo = new THREE.PlaneGeometry(NEAR_SIZE, NEAR_SIZE, n, n);
  nearGeo.rotateX(-Math.PI / 2);
  const nearGround = new THREE.Mesh(nearGeo, nearMat);
  nearGround.frustumCulled = false;
  // Сначала рисуем ближнюю землю: дальняя под ней отсекается тестом глубины и не считается зря.
  nearGround.renderOrder = -1;
  scene.add(nearGround);
  const follow = (pos) => {
    const cx = Math.round(pos.x / NEAR_STEP) * NEAR_STEP;
    const cz = Math.round(pos.z / NEAR_STEP) * NEAR_STEP;
    nearGround.position.set(cx, 0, cz);
    center.value.set(cx, cz);
  };

  // Лёд в каналах.
  const iceMat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), {
    emissive: true,
    colorCode: /* glsl */ `
      float n = fbm(vWorld.xz * 0.08);
      float cracks = smoothstep(0.47, 0.5, vnoise(vWorld.xz * 0.35)) * smoothstep(0.53, 0.5, vnoise(vWorld.xz * 0.35));
      col = mix(vec3(0.62, 0.65, 0.72), vec3(0.86, 0.87, 0.92), smoothstep(0.35, 0.65, n));
      col = mix(col, vec3(0.42, 0.46, 0.53), cracks * 0.5);
      gEmit = col * cityLight(vWorld.xz) * 0.5;
    `,
  });
  for (const w of map.water) {
    const s = new THREE.Shape(shrinkToRect(w.o, map.ext, 0.5).map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    g.translate(0, WATER_LEVEL, 0);
    scene.add(new THREE.Mesh(g, iceMat));
  }

  // Мосты: настил с той же текстурой земли + боковины.
  const bridges = map.roads.filter((r) => r.bridge);
  const deckW = (r) => (r.kind === 'foot' ? r.w + 1 : r.w + 5);
  const deckGeos = [];
  const sideGeos = [];
  const bridgeEdges = []; // бортики над водой — чтобы не съехать с моста в канал
  for (const r of bridges) {
    const half = deckW(r) / 2;
    const L = offsetPolyline(r.p, -half);
    const R = offsetPolyline(r.p, half);
    for (const line of [L, R]) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
        for (let k = 0; k < n; k++) {
          const p = lerp2(a, b, k / n), q = lerp2(a, b, (k + 1) / n);
          const mid = lerp2(p, q, 0.5);
          // Только внешний край: кромка, попавшая на соседний настил того же моста, не нужна.
          const onOtherDeck = bridges.some((o) => o !== r && distToPolyline(mid[0], mid[1], o.p) < deckW(o) / 2 - 0.3);
          if (!onOtherDeck && map.water.some((w) => inRing(mid, w.o))) bridgeEdges.push([p[0], p[1], q[0], q[1]]);
        }
      }
    }
    // Настил — вровень с землёй и на 2.5 м длиннее моста с каждого конца: иначе у концов
    // оставалась щель над краем канала, и фары высвечивали в ней верх набережной ровной линией.
    const ext = extendEnds(r.p, 2.5);
    deckGeos.push(ribbonTop(offsetPolyline(ext, -half), offsetPolyline(ext, half), 0));
    // Боковины — чуть ниже уровня земли, чтобы их верхняя кромка не светилась линией.
    sideGeos.push(wallStrip(L, -0.04, -0.9), wallStrip(R, -0.04, -0.9), ribbonTop(L, R, -0.9));
  }
  const stone = new THREE.MeshLambertMaterial({ color: 0x8d8a92, side: THREE.DoubleSide });
  if (deckGeos.length) scene.add(new THREE.Mesh(mergeSimple(deckGeos), material));
  if (sideGeos.length) scene.add(new THREE.Mesh(mergeSimple(sideGeos), stone));

  // Набережные: гранитные стенки по контуру воды, кроме кромки рамки мира.
  const graniteMat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), {
    emissive: true,
    colorCode: /* glsl */ `
      float block = step(0.94, fract(vWorld.y * 1.1 + 0.3)) + step(0.97, fract((vWorld.x + vWorld.z) * 0.6));
      col = vec3(0.47, 0.42, 0.43) * (0.85 + 0.25 * vnoise(vWorld.xz * 3.0 + vWorld.y * 5.0));
      col *= 1.0 - 0.35 * clamp(block, 0.0, 1.0);
      col = mix(col, vec3(0.88, 0.89, 0.93), smoothstep(-0.15, 0.0, vWorld.y));
      gEmit = col * cityLight(vWorld.xz) * 0.6;
    `,
  });
  const embankment = [];
  const wallGeos = [];
  for (const w of map.water) {
    const ring = shrinkToRect(w.o, map.ext, 0.5);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (onRectEdge(a, map.ext, 1) && onRectEdge(b, map.ext, 1)) continue;
      // Верх стенки — чуть ниже земли: иначе под мостом гранит торчит полосой поперёк проезжей части.
      wallGeos.push(wallStrip([a, b], -0.02, WATER_LEVEL - 0.2));
      // Для столкновений и решёток режем на куски и выкидываем те, что под мостами.
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k < n; k++) {
        const p = lerp2(a, b, k / n);
        const q = lerp2(a, b, (k + 1) / n);
        const mid = lerp2(p, q, 0.5);
        if (bridges.some((r) => distToPolyline(mid[0], mid[1], r.p) < deckW(r) / 2 + 0.6)) continue;
        embankment.push([p[0], p[1], q[0], q[1]]);
      }
    }
  }
  if (wallGeos.length) scene.add(new THREE.Mesh(mergeSimple(wallGeos), graniteMat));

  // Доля проезжей части в точке (0..1) — по маске R.
  const roadAt = (x, z) => {
    const i = Math.floor(((x - x0) / W) * MASK_SIZE);
    const j = Math.floor(((z - z0) / H) * MASK_SIZE);
    if (i < 0 || j < 0 || i >= MASK_SIZE || j >= MASK_SIZE) return 0;
    return mask.data[(j * MASK_SIZE + i) * 4] / 255;
  };
  return { material, maskCanvas: mask.preview, embankment, bridgeEdges, bridges, deckW, roadAt, follow, nearGround };
}

// near — подробная земля вокруг камеры: тротуары подняты на высоту бордюра, над водой — дыра.
function groundMaterial(tex, x0, z0, W, H, gridAngle, near = null) {
  const rect = new THREE.Vector4(x0, z0, 1 / W, 1 / H);
  return patchMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: !near, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), {
    emissive: true,
    uniforms: {
      uMask: { value: tex },
      uRect: { value: rect },
      uGrid: { value: new THREE.Vector2(Math.cos(gridAngle), Math.sin(gridAngle)) },
      ...(near ? { uWater: { value: near.water }, uCenter: near.center } : {}),
    },
    vertexHeader: near ? 'uniform sampler2D uMask; uniform vec4 uRect; uniform vec2 uCenter;' : '',
    vertexBegin: near ? /* glsl */ `
      vec2 wxz = transformed.xz + uCenter;
      float rd = texture2D(uMask, (wxz - uRect.xy) * uRect.zw).r;
      // У края подробной земли подъём сходит на нет — шов с дальней землёй не виден.
      float fade = 1.0 - smoothstep(${(NEAR_SIZE / 2 - 18).toFixed(1)}, ${(NEAR_SIZE / 2 - 2).toFixed(1)}, max(abs(transformed.x), abs(transformed.z)));
      transformed.y += ${KERB_H.toFixed(2)} * (1.0 - smoothstep(0.25, 0.6, rd)) * fade;
    ` : '',
    header: 'uniform sampler2D uMask; uniform vec4 uRect; uniform vec2 uGrid;' + (near ? ' uniform sampler2D uWater;' : ''),
    colorCode: (near ? 'if (texture2D(uWater, (vWorld.xz - uRect.xy) * uRect.zw).r > 0.5) discard;\n' : '') + /* glsl */ `
      vec2 muv = (vWorld.xz - uRect.xy) * uRect.zw;
      vec4 m = texture2D(uMask, muv);
      vec2 p = vWorld.xz;
      float big = fbm(p * 0.06);
      float mid = fbm(p * 0.45);
      float fine = vnoise(p * 9.0);
      float speck = smoothstep(0.62, 0.9, vnoise(p * 14.0)) * smoothstep(0.3, 0.7, vnoise(p * 3.1 + 5.0));

      vec3 snow = vec3(0.86, 0.87, 0.93) * (0.94 + 0.06 * mid);
      // Тротуар: утоптанный серый снег с проплешинами плитки.
      vec3 packed = mix(vec3(0.66, 0.66, 0.72), vec3(0.80, 0.80, 0.86), mid);
      // Гранитная плитка, проступающая из-под снега; сетка — по направлению Невского.
      vec2 g = mat2(uGrid.x, -uGrid.y, uGrid.y, uGrid.x) * p;
      vec2 cell = fract(g / vec2(1.2, 0.8));
      float seam = 1.0 - step(0.06, cell.x) * step(0.08, cell.y);
      float bare = smoothstep(0.5, 0.72, fbm(p * 0.25 + 7.0));
      vec3 slab = vec3(0.4, 0.39, 0.43) * (0.85 + 0.3 * hash12(floor(g / vec2(1.2, 0.8))));
      slab *= 1.0 - seam * 0.45;
      packed = mix(packed, slab, bare * 0.7);
      // Протоптанная тропинка: мокро и темнее.
      float trod = smoothstep(0.1, 0.6, m.b) * (1.0 - smoothstep(0.3, 0.7, m.r));
      packed = mix(packed, slab * 0.75, trod * (0.55 + 0.3 * mid));
      vec3 col0 = mix(snow, packed, m.g);

      // Проезжая часть: каша, колеи до мокрого асфальта, снег у бортика.
      float road = smoothstep(0.3, 0.7, m.r);
      float edge = smoothstep(0.15, 0.45, m.r) * (1.0 - smoothstep(0.55, 0.9, m.r));
      vec3 slush = mix(vec3(0.43, 0.43, 0.48), vec3(0.62, 0.62, 0.68), mid) * (0.92 + 0.12 * fine);
      vec3 asphalt = vec3(0.1, 0.1, 0.115) * (0.8 + 0.4 * fine);
      float track = smoothstep(0.08, 0.55, m.b) * (0.7 + 0.3 * big);
      vec3 roadCol = mix(slush, asphalt, track);
      roadCol = mix(roadCol, vec3(0.8, 0.8, 0.86), speck * (1.0 - track) * 0.6);
      vec3 c = mix(col0, roadCol, road);
      c = mix(c, snow * 0.97, edge * 0.7);

      // Разметка: под снегом видна местами.
      float markVis = m.a * (0.35 + 0.5 * smoothstep(0.3, 0.7, big)) * (1.0 - 0.4 * track);
      c = mix(c, vec3(0.9, 0.9, 0.93), markVis);
      col = c;
      // Ночной свет города; мокрый асфальт в колеях отражает ярче.
      vec3 L = cityLight(vWorld.xz);
      gEmit = c * L;
    `,
  });
}

// --- маска ---

function drawMask(map, x0, z0, W, H) {
  const S = MASK_SIZE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const sx = S / W;
  const sz = S / H;
  const tx = (x) => (x - x0) * sx;
  const tz = (z) => (z - z0) * sz;
  const path = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(tx(x), tz(z)) : ctx.moveTo(tx(x), tz(z))));
  };
  const packed = new Uint8Array(S * S * 4);
  // Размытие — одним проходом на весь слой: filter на каждом штрихе стоит минуты.
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = S;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  const grab = (channel, blur = 0) => {
    let src = ctx;
    if (blur) {
      tctx.filter = `blur(${blur}px)`;
      tctx.clearRect(0, 0, S, S);
      tctx.drawImage(cv, 0, 0);
      src = tctx;
    }
    const d = src.getImageData(0, 0, S, S).data;
    for (let i = 0; i < S * S; i++) packed[i * 4 + channel] = d[i * 4];
  };
  const reset = (fill = '#000') => {
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = ctx.fillStyle = '#fff';
    ctx.lineCap = ctx.lineJoin = 'round';
  };
  const drive = map.roads.filter((r) => r.kind !== 'foot');

  // R — проезжая часть.
  reset();
  for (const r of drive) {
    ctx.lineWidth = r.w * sx;
    path(r.p);
    ctx.stroke();
  }
  // Щель между встречными половинами одной улицы (Невский) — тоже асфальт.
  for (const r of drive) {
    if (!r.oneway || !r.name || r.lanes < 2) continue;
    const mid = r.p[Math.floor(r.p.length / 2)];
    for (const o of drive) {
      if (o === r || !o.oneway || o.name !== r.name) continue;
      const gap = distToPolyline(mid[0], mid[1], o.p) - r.w / 2 - o.w / 2;
      if (gap > 0 && gap < 8) {
        ctx.lineWidth = (gap + 0.6) * sx;
        path(offsetPolyline(r.p, -(r.w / 2 + gap / 2)));
        ctx.stroke();
      }
    }
  }
  grab(0, 1.5);
  const preview = document.createElement('canvas');
  preview.width = preview.height = 512;
  preview.getContext('2d').drawImage(cv, 0, 0, 512, 512);

  // G — мощёное (по умолчанию весь центр), минус газоны/скверы.
  reset('#fff');
  ctx.fillStyle = '#000';
  for (const ring of map.snowAreas) {
    path(ring);
    ctx.closePath();
    ctx.fill();
  }
  grab(1, 3);

  // B — колеи: по две полосы на каждую полосу движения.
  reset();
  for (const r of drive) {
    const lanes = Math.max(1, r.lanes);
    const cw = r.cw ?? r.w; // полосы движения, без парковки
    const lw = cw / lanes;
    const busy = r.kind === 'service' ? 0.45 : 1;
    ctx.globalAlpha = busy;
    for (let l = 0; l < lanes; l++) {
      const c = -cw / 2 + lw * (l + 0.5);
      for (const side of [-0.8, 0.8]) {
        ctx.lineWidth = 0.95 * sx;
        for (const run of outsideWider(offsetPolyline(r.p, c + side), r, drive)) {
          path(run);
          ctx.stroke();
        }
      }
    }
  }
  // Протоптанные тропинки на тротуарах — там же, где ходят пешеходы.
  ctx.globalAlpha = 0.55;
  for (const r of map.roads) {
    if (r.kind !== 'foot' || r.bridge) continue;
    ctx.lineWidth = 1.4 * sx;
    path(r.p);
    ctx.stroke();
  }
  grab(2, 2.5);

  // A — разметка и зебры.
  reset();
  ctx.lineCap = 'butt';
  for (const r of drive) {
    if (r.kind === 'service' || r.lanes < 2) continue;
    ctx.lineWidth = 0.15 * sx;
    // У многополосной односторонки — сплошная по левому краю; на Невском две такие
    // проезжие части сходятся и дают двойную сплошную посередине.
    const cw = r.cw ?? r.w;
    if (r.oneway && r.lanes >= 2 && r.hw !== 'residential') {
      ctx.lineWidth = 0.18 * sx;
      path(offsetPolyline(r.p, -cw / 2 + 0.35));
      ctx.stroke();
      ctx.lineWidth = 0.15 * sx;
    }
    if (!r.oneway) {
      for (const off of [-0.12, 0.12]) {
        for (const run of outsideWider(offsetPolyline(r.p, off), r, drive)) {
          path(run);
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([3 * sx, 6 * sx]);
    const lw = cw / r.lanes;
    for (let l = 1; l < r.lanes; l++) {
      const off = -cw / 2 + lw * l;
      if (!r.oneway && Math.abs(off) < 0.5) continue;
      path(offsetPolyline(r.p, off));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  for (const c of map.crossings) {
    const road = nearestRoadDir(drive, c.p);
    if (!road) continue;
    const { dir, w } = road;
    const nrm = [-dir[1], dir[0]];
    ctx.lineWidth = 4 * sx;
    ctx.setLineDash([0.5 * sx, 0.6 * sx]);
    // Полосы зебры параллельны дороге, идут поперёк неё.
    ctx.beginPath();
    ctx.moveTo(tx(c.p[0] - nrm[0] * w / 2), tz(c.p[1] - nrm[1] * w / 2));
    ctx.lineTo(tx(c.p[0] + nrm[0] * w / 2), tz(c.p[1] + nrm[1] * w / 2));
    ctx.stroke();
  }
  grab(3, 0.6);

  return { data: packed, preview };
}

// Части ломаной вне проезжей части более широких улиц: колеи и разметка боковой улицы
// не должны тянуться поперёк перекрёстка с Невским (оттуда «странные полосы»).
function outsideWider(pts, road, roads) {
  const wider = roads.filter((o) => o !== road && o.w > road.w + 1 && o.name !== road.name);
  if (!wider.length) return [pts];
  const runs = [];
  let run = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
    for (let k = 0; k <= n; k++) {
      if (k === 0 && i > 1) continue;
      const p = [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n];
      const inside = wider.some((o) => Math.abs(o.p[0][0] - p[0]) < 400 && distToPolyline(p[0], p[1], o.p) < o.w / 2);
      if (inside) {
        if (run.length > 1) runs.push(run);
        run = [];
      } else run.push(p);
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

function nevskyAngle(map) {
  let best = 0;
  let bl = 0;
  for (const r of map.roads) {
    if (r.name !== 'Невский проспект' || r.kind !== 'drive') continue;
    const a = r.p[0], b = r.p[r.p.length - 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > bl) {
      bl = l;
      best = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return best;
}

function nearestRoadDir(roads, p) {
  let best = null;
  let bd = 3;
  for (const r of roads) {
    for (let i = 1; i < r.p.length; i++) {
      const a = r.p[i - 1];
      const b = r.p[i];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
      const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
      if (d < bd) {
        bd = d;
        const l = Math.sqrt(l2);
        best = { dir: [dx / l, dz / l], w: r.w };
      }
    }
  }
  return best;
}

// --- геометрия ---

function ribbonTop(L, R, y) {
  const pos = [];
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1], b = L[i], c = R[i - 1], d = R[i];
    pos.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]);
    pos.push(b[0], y, b[1], c[0], y, c[1], d[0], y, d[1]);
  }
  return fixUp(pos);
}

function wallStrip(pts, yTop, yBot) {
  const pos = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    pos.push(a[0], yTop, a[1], a[0], yBot, a[1], b[0], yBot, b[1]);
    pos.push(a[0], yTop, a[1], b[0], yBot, b[1], b[0], yTop, b[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Разворачивает треугольники горизонтальных поверхностей нормалью вверх.
function fixUp(pos) {
  for (let i = 0; i < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vz = pos[i + 8] - pos[i + 2];
    if (uz * vx - ux * vz < 0) {
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function mergeSimple(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    const gi = g.index ? g.toNonIndexed() : g;
    pos.set(gi.attributes.position.array, o * 3);
    nrm.set(gi.attributes.normal.array, o * 3);
    o += gi.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

function shrinkToRect(ring, ext, m) {
  return ring.map(([x, z]) => [
    Math.min(ext[2] - m, Math.max(ext[0] + m, x)),
    Math.min(ext[3] - m, Math.max(ext[1] + m, z)),
  ]);
}

function onRectEdge([x, z], ext, tol) {
  return Math.abs(x - ext[0]) < tol || Math.abs(x - ext[2]) < tol || Math.abs(z - ext[1]) < tol || Math.abs(z - ext[3]) < tol;
}

// Ломаная, продлённая на d по направлению крайних отрезков.
function extendEnds(pts, d) {
  const n = pts.length;
  const a = pts[0], b = pts[1], y = pts[n - 2], z = pts[n - 1];
  const la = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, lz = Math.hypot(z[0] - y[0], z[1] - y[1]) || 1;
  return [
    [a[0] - ((b[0] - a[0]) / la) * d, a[1] - ((b[1] - a[1]) / la) * d],
    ...pts,
    [z[0] + ((z[0] - y[0]) / lz) * d, z[1] + ((z[1] - y[1]) / lz) * d],
  ];
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function lerp2(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

