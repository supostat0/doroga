import * as THREE from 'three';
import { WEATHER } from './config.js';
import { buildGround } from './ground.js';
import { buildBuildings } from './buildings.js';
import { PlayerCar } from './car.js';
import { SegmentGrid } from './collision.js';
import { makeSnow } from './snow.js';
import { distToPolyline } from './geom.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';
import { buildRoadGraph } from './roadgraph.js';
import { Signals } from './signals.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './peds.js';
import { buildSigns } from './signs.js';
import { buildProps, FLICKER } from './props.js';
import { buildDetails } from './details.js';
import { buildPassages } from './passages.js';
import { buildDoors } from './doors.js';
import { buildElements } from './elements.js';
import { Walker } from './walker.js';
import { Beams } from './beams.js';
import { buildLightMap } from './lights.js';
import { LIGHT_UNIFORMS } from './shaders.js';
import { makePost } from './post.js';
import { Sound } from './audio.js';
import { buildMetro } from './metro.js';
import { buildStreet } from './street.js';
import { Vapor } from './vapor.js';
import { PerfMeter } from './perf.js';
import { cullFar, addChunked } from './chunks.js';
import { buildTrolleyWires, buildStops } from './streetlife.js';
import { Couriers } from './couriers.js';
import { buildRoadSigns } from './roadsigns.js';
import { Tracks } from './tracks.js';
import { Orders } from './orders.js';
import { loadFacadeList, addPhotoFacades } from './photofacades.js';

const canvas = document.getElementById('game');
// Без сглаживания: картинка нарочно пиксельная (низкое разрешение + растяжка в CSS).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = skyGradient();
scene.fog = new THREE.FogExp2(WEATHER.fogColor, WEATHER.fogDensity);
scene.add(new THREE.HemisphereLight(WEATHER.skyLight, WEATHER.groundLight, WEATHER.hemiIntensity));
const moon = new THREE.DirectionalLight(0x9aa6d6, WEATHER.moonIntensity);
moon.position.set(-0.4, 1, 0.3);
scene.add(moon);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 900);
const composer = makePost(renderer, scene, camera);

const map = await (await fetch('./map.json')).json();

const ground = buildGround(map, scene);
const photoFacades = await loadFacadeList(); // фасады по разметке фото (tools/facade.html)
const city = buildBuildings(map, scene, photoFacades);
addPhotoFacades(scene, photoFacades);
const passageWalls = buildPassages(map, scene); // арки-проезды: свод за вырезом в стене
buildDoors(map, scene); // двери из OSM

const walls = new SegmentGrid();
city.colliders.forEach((s) => walls.add(s));
passageWalls.forEach((s) => walls.add(s));
ground.embankment.forEach((s) => walls.add(s));
ground.bridgeEdges.forEach((s) => walls.add(s));
const street = buildStreet(map, ground, scene); // бордюры, сугробы, припаркованные машины, фонари
map.lamps = street.lamps;
// Припаркованные машины — препятствия: прямоугольник 1.8 × 4.4 м.
for (const c of street.parked) {
  const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = -fz, rz = fx;
  const pt = (a, b) => [c.x + fx * a + rx * b, c.z + fz * a + rz * b];
  const P = [pt(2.2, -0.9), pt(2.2, 0.9), pt(-2.2, 0.9), pt(-2.2, -0.9)];
  for (let i = 0; i < 4; i++) walls.add([...P[i], ...P[(i + 1) % 4]]);
}
buildProps(map, ground, scene);
buildDetails(map, scene).forEach((s) => walls.add(s)); // препятствия — заборы, стены, изгороди
buildElements(map, scene).forEach((s) => walls.add(s)); // ручные элементы каталога (data/elements.json)
const signs = buildSigns(map, city.facades, scene);
const metro = buildMetro(map, city.facades, scene);
const stops = buildStops(map, scene);
buildLightMap(map, city.facades, signs, [...metro, ...stops]);

const graph = buildRoadGraph(map, new Set(map.signals.map((s) => s.id)));
const signals = new Signals(map, graph, scene, ground.roadAt);
const traffic = new Traffic(graph, signals, scene);
const beams = new Beams(scene); // свет фар NPC на дороге
buildTrolleyWires(graph, scene);
const roadSigns = buildRoadSigns(map, graph, ground.roadAt, scene);
const couriers = new Couriers(graph, signals, scene);
traffic.extra = () => couriers.list; // NPC-машины пропускают курьеров
couriers.cars = () => [player, ...traffic.cars]; // курьеры не въезжают в машины
const peds = new Pedestrians(map, signals, scene);
couriers.initWalkers(peds, ground.roadAt); // часть курьеров — по тротуарам и переходам
peds.drive = map.roads.filter((r) => r.kind === 'drive');
peds.addWaiters(stops);
peds.cars = () => [...traffic.cars, player];
peds.roadAt = ground.roadAt; // на тротуаре человечки стоят на высоте бордюра

const world = {
  map,
  walls,
  play: map.play,
  roadAt: ground.roadAt,
  obstacles: () => [...traffic.obstacles(), ...couriers.list],
};

const spawn = spawnOnNevsky(map);
const player = new PlayerCar(scene, spawn);
const chase = new ChaseCamera(camera, walls, canvas);
const snow = makeSnow(scene);
const vapor = new Vapor(scene);
const tracks = new Tracks(scene, ground.roadAt);
// Мелочи жизни: дымок из части печных труб и пар из люков на проезжей части.
{
  const r = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (const [x, y, z, s] of city.chimneys) {
    if (r() < 0.25) vapor.emitters.push({ x, z, y: y + 1.4 * (0.8 + s * 0.8) + 0.1, vy: 0.8, spread: 0.2, size: 2.4, life: 4.5, alpha: 1.3, rate: 0.35 });
  }
  const manholes = [];
  for (const rd of map.roads) {
    if (rd.kind !== 'drive') continue;
    for (let i = 1; i < rd.p.length; i++) {
      const [ax, az] = rd.p[i - 1], [bx, bz] = rd.p[i];
      const L = Math.hypot(bx - ax, bz - az);
      for (let d = 20 + r() * 30; d < L; d += 45 + r() * 40) {
        if (r() > 0.45) continue;
        const steams = r() < 0.25; // пар идёт редко — только над теплотрассой в мороз
        const t = d / L, off = (r() - 0.5) * rd.w * 0.6;
        const nx = -(bz - az) / L, nz = (bx - ax) / L;
        const mx = ax + (bx - ax) * t + nx * off, mz = az + (bz - az) * t + nz * off;
        if (steams) vapor.emitters.push({ x: mx, z: mz, y: 0.05, vy: 0.35, spread: 0.35, size: 1.5, life: 2.4, alpha: 1.4, rate: 0.3 });
        manholes.push({ x: mx, z: mz, matrix: new THREE.Matrix4().makeTranslation(mx, 0.02, mz) });
      }
    }
  }
  // Люки: серый чугун с рифлением — не темнее асфальта, просто другой материал.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = cv.getContext('2d');
  c.fillStyle = '#55555c';
  c.beginPath(); c.arc(16, 16, 15, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#44444a';
  c.beginPath(); c.arc(16, 16, 12.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#5c5c63';
  for (let k = -9; k <= 9; k += 3) c.fillRect(5, 16 + k, 22, 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const disc = new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2);
  addChunked(scene, disc, new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }), manholes);
}
const hud = new Hud(map, ground.maskCanvas, photoFacades);

// --- ввод ---
const input = { up: false, down: false, left: false, right: false, brake: false };
const fly = { rise: false, sink: false, fast: false }; // свободный полёт (F)
const parked = { up: false, down: false, left: false, right: false, brake: true }; // машина стоит, пока летаем
let touchFly = false;
let walker = null; // пешком (F): человечок вместо машины
const toggleWalk = () => {
  if (chase.fly) return;
  walker ??= new Walker(scene);
  if (!walking) { walker.exit(player, walls); walking = true; chase.reset(); return; }
  if (walker.near(player)) { walker.hide(); walking = false; chase.reset(); return; }
  toast('Подойдите к машине, чтобы сесть');
};
let walking = false;
const toast = (text) => {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2000);
};
const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake',
};
addEventListener('keydown', (e) => {
  if (KEYS[e.code]) {
    input[KEYS[e.code]] = true;
    e.preventDefault();
  }
  if (e.code === 'KeyG') chase.toggleFly();
  if (e.code === 'KeyF') toggleWalk();
  if (e.code === 'KeyE' || e.code === 'KeyQ' || e.code.startsWith('Shift')) fly[e.code[0] === 'S' ? 'fast' : e.code === 'KeyE' ? 'rise' : 'sink'] = true;
  if (chase.fly || walking) return; // в полёте и пешком клавиши не для машины
  if (e.code === 'KeyC') chase.nextMode();
  if (e.code === 'KeyR') player.reset(nearestSpawn(map, player));
  if (e.code === 'KeyM') hud.toggleMap();
  if (e.code === 'KeyH') sound.horn(true);
  if (e.code === 'KeyQ') player.blinker = player.blinker === -1 ? 0 : -1;
  if (e.code === 'KeyE') player.blinker = player.blinker === 1 ? 0 : 1;
});
addEventListener('keyup', (e) => {
  if (e.code === 'KeyE' || e.code === 'KeyQ' || e.code.startsWith('Shift')) fly[e.code[0] === 'S' ? 'fast' : e.code === 'KeyE' ? 'rise' : 'sink'] = false;
  if (e.code === 'KeyH') sound.horn(false);
  if (KEYS[e.code]) input[KEYS[e.code]] = false;
});
addEventListener('blur', () => Object.keys(input).forEach((k) => (input[k] = false)));
// Кнопки на телефоне: держишь — едет, отпустил — нет.
for (const b of document.querySelectorAll('#touch button')) {
  const set = (v) => { if (b.dataset.key) input[b.dataset.key] = v; b.classList.toggle('on', v); };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    if (b.dataset.act === 'reset') player.reset(nearestSpawn(map, player));
    if (b.dataset.act === 'fly') { chase.toggleFly(); touchFly = true; }
    if (b.dataset.act === 'walk') toggleWalk();
    set(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}

// --- старт ---
const startBtn = document.getElementById('start');
startBtn.disabled = false;
startBtn.textContent = 'Поехали';
let running = false;
const sound = new Sound();
const orders = new Orders(signs, scene, sound);
player.onBump = (p) => sound.thump(p);
startBtn.addEventListener('click', () => {
  sound.start();
  document.getElementById('intro').classList.add('gone');
  document.getElementById('hud').hidden = false;
  document.getElementById('touch').hidden = false;
  running = true;
});
if (new URLSearchParams(location.search).has('autostart')) startBtn.click();

// --- цикл ---
const clock = new THREE.Clock();
const timeShift = Math.random() * 10000; // окна горят по-разному в каждой поездке
let t = 0;
// Потолок частоты кадров: на экранах 120 Гц не рисуем лишнего — меньше греется.
// На заставке хватает 30 кадров.
const perfParam = new URLSearchParams(location.search).has('perf');
const perf = new PerfMeter(renderer, { visible: perfParam, details: perfParam });
let acc = 0;
renderer.setAnimationLoop(() => {
  acc += clock.getDelta();
  // Пропускаем кадр, только если экран быстрее ~70 Гц (на 60 Гц рисуем каждый).
  const minDt = running ? 1 / 70 : 1 / 32;
  if (acc < minDt) return;
  const dt = Math.min(acc, 1 / 20);
  acc = 0;
  t += dt;
  const t0 = performance.now();
  signals.update(Date.now() / 1000);
  LIGHT_UNIFORMS.uTime.value = t + timeShift;
  FLICKER.update(t);
  // Пешеходы, которые сейчас на проезжей части (переходят) — их NPC пропускают. Обычно их единицы.
  traffic.walkersOnRoad = peds.peds.filter((q) => ground.roadAt(q.x, q.z) > 0.5);
  traffic.update(dt, player);
  beams.update(traffic.cars, camera.position);
  for (const h of traffic.honks.splice(0)) {
    const d = Math.hypot(h.x - player.x, h.z - player.z);
    if (d < 60) sound.npcHorn(1 - d / 60, h.aggr);
  }
  peds.update(dt, t, running ? player : null);
  couriers.update(dt, t, running ? player : null, camera.position);
  // Звонок курьера: если мешаешь ему проехать, и изредка просто так, проезжая мимо.
  for (const k of couriers.list) {
    k.bellCd = (k.bellCd ?? Math.random() * 20) - dt;
    const d = Math.hypot(k.x - player.x, k.z - player.z);
    if (k.bellCd > 0 || d > 25) continue;
    if (k.blocked || Math.random() < dt / 25) {
      sound.bikeBell(1 - d / 25);
      k.bellCd = k.blocked ? 3 : 12;
    }
  }
  if (running) {
    player.update(dt, chase.fly || walking ? parked : input, world);
    if (walking && !chase.fly) walker.update(dt, input, fly.fast, walls);
    tracks.update(dt, t, [player, ...traffic.cars.filter((c) => Math.abs(c.x - camera.position.x) < 70 && Math.abs(c.z - camera.position.z) < 70)]);
    orders.update(dt, t, player);
    if (signals.checkRunRed(player)) hud.redLight();
  } else player.sync(dt, 0);
  if (chase.fly) chase.updateFly(dt, { ...input, ...fly }, touchFly);
  else chase.update(dt, walking ? walker : player);
  cullFar(camera);
  ground.follow(camera.position);
  snow.update(t, camera, renderer.getPixelRatio());
  vapor.update(dt, [player, ...traffic.cars.filter((c) => !c.trolley && Math.abs(c.x - camera.position.x) < 90 && Math.abs(c.z - camera.position.z) < 90)], renderer.getPixelRatio(), camera.position);
  hud.update(dt, walking ? walker : player);
  const tr = traffic.cars.filter((c) => c.trolley);
  sound.update(player, Math.min(...tr.map((c) => Math.hypot(c.x - player.x, c.z - player.z))));
  const cpuMs = performance.now() - t0;
  perf.begin();
  composer.render();
  perf.end();
  perf.frame(dt, cpuMs);
});


// Старт на Невском у Казанского моста, по ходу движения, в правом ряду.
function spawnOnNevsky(map) {
  const roads = map.roads.filter((r) => r.name === 'Невский проспект' && r.kind === 'drive' && r.oneway && !r.bridge);
  let best = null;
  let bd = Infinity;
  for (const r of roads) {
    for (let i = 1; i < r.p.length; i++) {
      const [ax, az] = r.p[i - 1];
      const [bx, bz] = r.p[i];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const d = Math.hypot(mx - 40, mz);
      if (d < bd && Math.hypot(bx - ax, bz - az) > 8) {
        bd = d;
        best = { r, a: [ax, az], b: [bx, bz] };
      }
    }
  }
  return spotOn(best.r, best.a, best.b);
}

function spotOn(r, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz);
  const off = (r.cw ?? r.w) / 2 - 2; // правый ряд (не полоса парковки)
  return {
    x: (a[0] + b[0]) / 2 + (-dz / l) * off,
    z: (a[1] + b[1]) / 2 + (dx / l) * off,
    h: Math.atan2(-dx, -dz),
  };
}

function nearestSpawn(map, p) {
  let best = null;
  let bd = Infinity;
  for (const r of map.roads) {
    if (r.kind !== 'drive') continue;
    for (let i = 1; i < r.p.length; i++) {
      const d = distToPolyline(p.x, p.z, [r.p[i - 1], r.p[i]]);
      if (d < bd) {
        bd = d;
        best = spotOn(r, r.p[i - 1], r.p[i]);
      }
    }
  }
  return best;
}

// Небо: тёмное сверху, у горизонта — тёплое зарево города, переходящее в туман.
function skyGradient() {
  const cv = document.createElement('canvas');
  cv.width = 2;
  cv.height = 256;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + WEATHER.skyTop.toString(16).padStart(6, '0'));
  g.addColorStop(0.55, '#' + WEATHER.fogColor.toString(16).padStart(6, '0'));
  g.addColorStop(0.62, '#3a2c3c');
  g.addColorStop(1, '#' + WEATHER.fogColor.toString(16).padStart(6, '0'));
  c.fillStyle = g;
  c.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Для отладки из консоли: ?debug
if (new URLSearchParams(location.search).has('debug')) window.__game = { scene, camera, player, beams, traffic, signals, graph, map, chase, peds, ground, signs, composer, perf, couriers, street, vapor, roadSigns, orders };
