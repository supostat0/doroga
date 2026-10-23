// Входы в метро: светящаяся «М» и табличка со станцией. Если вход в здании — вывеска на фасаде;
// если на тротуаре — спуск в подземный переход (парапеты, решётка, ступени) и знак на стойке.
// Цвет полоски — цвет линии из OSM.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LINE = { blue: '#1f6fd1', green: '#2a9d4b', red: '#d6282f', orange: '#ef8a1f', purple: '#7b3fa0' };

export function buildMetro(map, facades, scene) {
  const stairs = { granite: [], snow: [], rail: [], steps: [] };
  const out = [];
  const pole = new THREE.MeshLambertMaterial({ color: 0x22242a });
  for (const m of map.metro ?? []) {
    const line = LINE[m.colour] ?? '#1f6fd1';
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.25), [
      side(), side(), side(), side(), face(mTexture(line)), face(mTexture(line)),
    ]);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.42), face(nameTexture(m.name, line)));

    // Ближайший фасад в пределах 6 м — вешаем над входом.
    const f = nearestFacade(facades, m.p, 6);
    const g = new THREE.Group();
    if (f) {
      const { q, n } = f;
      g.position.set(q[0] + n[0] * 0.5, 0, q[1] + n[1] * 0.5);
      g.rotation.y = Math.atan2(n[0], n[1]);
      sign.position.set(0, 5.0, 0.15);
      plate.position.set(0, 4.25, 0.05);
    } else {
      // Вход на тротуаре — спуск в подземный переход вдоль улицы, знак — у открытого края.
      const dir = alongRoad(map, m.p);
      addStairs(stairs, m.p, dir);
      g.position.set(m.p[0] + dir[0] * 3.4 + dir[1] * 1.9, 0, m.p[1] + dir[1] * 3.4 - dir[0] * 1.9);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8), pole);
      p.position.y = 2.1;
      g.add(p);
      sign.position.set(0, 4.6, 0);
      plate.position.set(0, 3.85, 0.13);
    }
    g.add(sign, plate);
    scene.add(g);
    out.push({ p: [g.position.x, g.position.z] });
  }
  buildStairs(stairs, scene);
  return out;
}

// Направление улицы у точки (по ближайшей проезжей части).
function alongRoad(map, p) {
  let best = [1, 0];
  let bd = Infinity;
  for (const r of map.roads) {
    if (r.kind !== 'drive') continue;
    for (let i = 1; i < r.p.length; i++) {
      const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i];
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - az) * ez) / l2));
      const d = Math.hypot(p[0] - ax - ex * t, p[1] - az - ez * t);
      if (d < bd) {
        bd = d;
        const l = Math.sqrt(l2);
        best = [ex / l, ez / l];
      }
    }
  }
  return best;
}

// Спуск: проём 2.6 × 5.5 м вдоль улицы. Ступени уходят вниз к дальнему (глухому) концу.
function addStairs(acc, p, [dx, dz]) {
  const yaw = Math.atan2(dx, dz); // локальная +z — к открытому краю
  const m = new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  const box = (w, h, d, x, y, z, list) => list.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z).applyMatrix4(m));
  for (const x of [-1.45, 1.45]) {
    box(0.3, 0.95, 5.6, x, 0.47, 0, acc.granite);
    box(0.34, 0.08, 5.6, x, 0.99, 0, acc.snow);
    box(0.05, 0.05, 5.6, x, 1.45, 0, acc.rail);
    for (let z = -2.6; z <= 2.6; z += 0.65) box(0.03, 0.45, 0.03, x, 1.2, z, acc.rail);
  }
  box(3.2, 0.95, 0.3, 0, 0.47, -2.95, acc.granite);
  box(3.24, 0.08, 0.34, 0, 0.99, -2.95, acc.snow);
  // Выше поднятого тротуара (0.14), иначе его перекрывает земля.
  const steps = new THREE.PlaneGeometry(2.6, 5.6).rotateX(-Math.PI / 2).translate(0, 0.17, 0);
  acc.steps.push(steps.applyMatrix4(m));
}

function buildStairs(acc, scene) {
  if (!acc.steps.length) return;
  // Ступени: тёмные у входа, внизу — тёплый свет перехода.
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#d9b98a'); // дальний конец (низ лестницы) — свет
  g.addColorStop(0.45, '#3a3438');
  g.addColorStop(1, '#4a4a52'); // у входа — снег и грязь
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 128);
  c.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 0; y < 128; y += 6) c.fillRect(0, y, 32, 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const mats = {
    granite: new THREE.MeshLambertMaterial({ color: 0x5f585c }),
    snow: new THREE.MeshLambertMaterial({ color: 0xe2e6ee }),
    rail: new THREE.MeshLambertMaterial({ color: 0x1e1f24 }),
    steps: new THREE.MeshBasicMaterial({ map: tex }),
  };
  for (const [k, list] of Object.entries(acc)) {
    if (!list.length) continue;
    const geos = list.map((x) => {
      const n = x.index ? x.toNonIndexed() : x;
      if (k !== 'steps') n.deleteAttribute('uv');
      return n;
    });
    scene.add(new THREE.Mesh(mergeGeometries(geos), mats[k]));
  }
}

function nearestFacade(facades, p, maxD) {
  let best = null;
  let bd = maxD;
  for (const f of facades) {
    const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1];
    const t = Math.max(0.1, Math.min(0.9, ((p[0] - f.a[0]) * dx + (p[1] - f.a[1]) * dz) / (f.L * f.L)));
    const q = [f.a[0] + dx * t, f.a[1] + dz * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bd) {
      bd = d;
      best = { q, n: f.n };
    }
  }
  return best;
}

function face(tex) {
  // Яркость > 1 — светится через bloom.
  return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.05, 1.05, 1.05) });
}

function side() {
  return new THREE.MeshBasicMaterial({ color: 0xdfe6f0 });
}

function mTexture(line) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#f4f7fb';
  c.fillRect(0, 0, 128, 128);
  c.fillStyle = line;
  c.font = '900 104px Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('М', 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameTexture(name, line) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 82;
  const c = cv.getContext('2d');
  c.fillStyle = '#16233d';
  c.fillRect(0, 0, 512, 82);
  c.fillStyle = line;
  c.fillRect(0, 0, 14, 82);
  c.fillStyle = '#ffffff';
  c.font = '700 40px Arial, sans-serif';
  c.textBaseline = 'middle';
  c.fillText(name, 34, 44, 460);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
