// NPC-машины: едут по графу дорог в своей полосе, на перекрёстках поворачивают по дуге
// (кривая Безье от своей полосы до новой), тормозят на красный и перед машиной впереди,
// включают поворотник и стоп-сигналы.

import { makeCarModel, makeTrolleyModel } from './car.js';
import { WIRE_Y } from './streetlife.js';
import { lanePoint } from './roadgraph.js';
import { rng } from './geom.js';

const COLORS = [0x1d1f24, 0xe8e8ea, 0x9aa0a8, 0x2a3550, 0x6b1f22, 0x3d4a3a, 0xc9c9cc, 0x55585e, 0x8a7a64];
const WHEELBASE = 2.65;
const SPEED = { primary: 13, secondary: 11, tertiary: 10, unclassified: 8, residential: 8, living_street: 5 };

export class Traffic {
  constructor(graph, signals, scene, count = 36) {
    this.graph = graph;
    this.signals = signals;
    this.cars = [];
    this.time = 0;
    this.honks = []; // события «посигналил» для звука: { x, z, aggr }
    // Каждая поездка своя: где кто стоит, куда поедет, кто как одет — случайно (город и его дома — постоянные).
    const r = rng((Math.random() * 2 ** 31) | 0);
    const usable = graph.edges.filter((e) => e.len > 25);
    // Невский — гуще.
    const weighted = usable.flatMap((e) => (e.hw === 'primary' ? [e, e, e] : [e]));
    for (let i = 0; i < count && weighted.length; i++) {
      const e = weighted[Math.floor(r() * weighted.length)];
      const taxi = r() < 0.15;
      const model = makeCarModel(taxi ? 0xf2c230 : COLORS[Math.floor(r() * COLORS.length)], { taxi });
      scene.add(model);
      // Характер: примерно каждый четвёртый — торопыга (быстрее, ближе к бамперу, сигналит раньше).
      const aggr = r() < 0.25;
      const car = {
        model, e, s: r() * e.len * 0.5, lane: Math.floor(r() * e.lanes), v: 0, rnd: r, aggr, taxi,
        cruise: aggr ? 1.0 + r() * 0.2 : 0.75 + r() * 0.25, turn: null, x: 0, z: 0, h: 0, steer: 0, spin: 0, blink: r() * 2,
        laneCd: 0, laneBlink: 0, honkCd: 0, blockedT: 0, hazard: 0, taxiCd: 10 + r() * 30,
      };
      this.planNext(car);
      car.teleport = true;
      this.drive(car, 0);
      this.cars.push(car);
    }
    // Троллейбусы: ходят только по Невскому, в правом ряду.
    this.nevsky = graph.edges.filter((e) => e.name === 'Невский проспект' && e.len > 20);
    for (let i = 0; i < 3 && this.nevsky.length; i++) {
      const e = this.nevsky[Math.floor(r() * this.nevsky.length)];
      const model = makeTrolleyModel(WIRE_Y);
      scene.add(model);
      const car = {
        model, e, s: r() * e.len * 0.5, lane: 0, v: 0, rnd: r, cruise: 0.65, turn: null,
        x: 0, z: 0, h: 0, steer: 0, spin: 0, blink: r() * 2, trolley: true, half: 5.9, wb: 7.2 // half — до бампера (кузов 11.6 м + огни),
      };
      this.planNext(car);
      car.teleport = true;
      this.drive(car, 0);
      this.cars.push(car);
    }
  }

  obstacles() {
    return this.cars;
  }

  // Выбираем следующее ребро и считаем, где начинать дугу поворота.
  planNext(c) {
    const outs = this.graph.out.get(c.e.to) ?? [];
    // Без разворотов и почти-разворотов, если есть выбор.
    let opts = outs.filter((o) => !(o.to === c.e.from && o.roadId === c.e.roadId) && turnAngle(c.e, o) < 2.3);
    // Троллейбус не сворачивает с Невского (там нет проводов).
    if (c.trolley) opts = opts.filter((o) => o.name === 'Невский проспект' && turnAngle(c.e, o) < 0.6);
    const list = opts.length || c.trolley ? opts : outs;
    c.next = list.length ? list[Math.floor(c.rnd() * list.length)] : null;
    c.nextLane = c.next ? Math.min(c.lane, c.next.lanes - 1) : 0;
    c.turnAng = c.next ? turnAngle(c.e, c.next) : 0;
    c.turnSide = c.next ? turnSide(c.e, c.next) : 0;
    // Радиус «срезания» угла: на прямом проезде короткий, на повороте длиннее.
    const r = c.turnAng < 0.25 ? 3 : c.turnAng < 1 ? 9 : 11;
    c.rOut = c.next ? Math.min(r, c.e.len * 0.45) : 0;
    c.rIn = c.next ? Math.min(r, c.next.len * 0.45) : 0;
    c.plan = c.next ? makeTurn(c) : null;
  }

  update(dt, player) {
    this.time += dt;
    this.player = player;
    this.separate();
    for (const c of this.cars) {
      const prevV = c.v;
      const turnV = Math.max(2.5, 8.5 - c.turnAng * 3.5);
      let target = (SPEED[c.e.hw] ?? 8) * c.cruise;

      if (!c.turn) {
        const stopAt = this.stopDistance(c);
        if (stopAt !== null) target = Math.min(target, Math.sqrt(stopAt * 2 * 3.2));
        // Перед поворотом сбрасываем скорость: чем круче поворот, тем медленнее.
        if (c.next && c.turnAng > 0.25) {
          const toTurn = Math.max(0, c.e.len - c.rOut - c.s);
          target = Math.min(target, Math.sqrt(turnV * turnV + 2 * 2.5 * toTurn));
        }
      } else {
        target = Math.min(target, turnV);
      }

      // Препятствия на своей будущей траектории (а не только строго по курсу): игрок и другие NPC.
      // Если долго стоим, перестаём уступать другим NPC — чтобы не заклинило на перекрёстке.
      c.stuck = c.v < 0.2 ? (c.stuck || 0) + dt : 0;
      const yieldNpc = c.stuck < 6;
      let gap = Infinity;
      let blocker = null; // кто мешает: машина NPC, 'player', 'walker', 'bike'
      const walkers = this.walkersOnRoad ?? [];
      for (let d = 2; d <= 26 && gap === Infinity; d += 3) {
        const q = this.routeAhead(c, d);
        if (player && Math.hypot(player.x - q.x, player.z - q.z) < 2.4) { gap = d; blocker = 'player'; }
        for (const w of walkers) if (Math.abs(w.x - q.x) < 1.8 && Math.abs(w.z - q.z) < 1.8) { gap = Math.min(gap, d); blocker = 'walker'; }
        if (yieldNpc) for (const o of this.cars) if (o !== c && nearBody(o, q.x, q.z, 2.2)) { gap = Math.min(gap, d); blocker = o; }
        if (this.extra) for (const o of this.extra()) if (Math.hypot(o.x - q.x, o.z - q.z) < 1.4) { gap = Math.min(gap, d); blocker = 'bike'; }
      }
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - (c.aggr ? 4 : 5.5)) * 0.9));
      this.think(c, dt, gap, blocker);
      if (c.hazard > 0) target = 0; // такси высаживает пассажира — стоит в ряду с аварийкой
      // Игрок прямо перед капотом (в том числе сбоку, вне траектории) или уже касается кузова —
      // стоим и ждём, а не проезжаем насквозь.
      if (player) {
        const fx = -Math.sin(c.h), fz = -Math.cos(c.h);
        const rx = player.x - c.x, rz = player.z - c.z;
        const along = rx * fx + rz * fz;
        const side = Math.abs(rx * -fz + rz * fx);
        const front = (c.half ?? 1.25) + 1;
        // Игрок впереди: тормозим заранее, тяжёлый троллейбус — с большим запасом.
        const margin = c.trolley ? 3.5 : 1.5;
        if (along > 0 && along < front + 10 && side < 2.3) target = Math.min(target, Math.max(0, (along - front - margin) * 1.0));
        // Игрок у борта (длинный троллейбус задевает кузовом на изгибе) — полная остановка,
        // а не «ползком»: иначе он медленно выдавливает машину игрока.
        if (nearBody(c, player.x, player.z, c.half > 2 ? 2.5 : 2.3)) {
          target = 0;
          c.v = 0;
          gap = 0;
        }
      }

      target = Math.max(0, target);
      // Вплотную к препятствию — тормозим резко.
      const acc = target > c.v ? (c.aggr ? 2.8 : 1.8) : gap < 6 ? 14 : 6;
      c.v += Math.sign(target - c.v) * Math.min(Math.abs(target - c.v), acc * dt);

      // Точка маршрута подстраивается под машину: если машина срезала угол и ушла вперёд —
      // точка догоняет быстрее, если отстала — ждёт. Так они не расходятся.
      const here = this.routeAhead(c, 0);
      const ahead = (c.x - here.x) * here.dx + (c.z - here.z) * here.dz;
      this.advance(c, c.v * dt * Math.max(0.3, Math.min(1.8, 1 + ahead * 0.5)));
      this.drive(c, dt);

      // Свет: стопы при торможении и стоянке, поворотник перед поворотом и в нём.
      const braking = c.v < prevV - 0.5 * dt || (c.v < 0.3 && target < 0.3);
      const nearTurn = c.turn || (c.next && c.e.len - c.s < 35);
      const phase = Math.floor((this.time + c.blink) * 3) % 2 === 0;
      const side = c.hazard > 0 ? 2 : c.laneBlink !== 0 ? c.laneBlink : nearTurn ? c.turnSide : 0;
      c.model.userData.setLights({
        brake: braking,
        left: phase && (side === 2 || side < 0),
        right: phase && (side === 2 || (side > 0 && side !== 2)),
      });
    }
  }

  // Страховка от «машина в машине» (слияния, повороты): у пары ближе 4 м стоит тот, кто сзади.
  separate() {
    const L = this.cars;
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const lim = 2.4 + ((a.half ?? 2.2) + (b.half ?? 2.2)) * 0.45;
        if (Math.abs(dx) > lim || Math.abs(dz) > lim || Math.hypot(dx, dz) > lim) continue;
        const aFwd = dx * -Math.sin(a.h) + dz * -Math.cos(a.h); // > 0 — b впереди a
        const back = aFwd > 0 ? a : b;
        back.v = 0;
      }
    }
  }

  // «Разум»: смена полосы (обгон медленных, заранее в нужный ряд перед поворотом), сигнал,
  // если долго не дают проехать, такси иногда встаёт с аварийкой.
  think(c, dt, gap, blocker) {
    c.laneCd -= dt;
    c.honkCd -= dt;
    c.hazard = Math.max(0, c.hazard - dt);
    if (c.laneBlink !== 0 && c.laneCd < 2) c.laneBlink = 0;
    const e = c.e;
    // Смена полосы — только на прямом участке многополосной дороги.
    if (!c.turn && e.lanes > 1 && c.laneCd <= 0 && !c.trolley) {
      let want = c.lane;
      const toEnd = e.len - c.s;
      if (c.next && c.turnSide !== 0 && toEnd < 45) want = c.turnSide > 0 ? 0 : e.lanes - 1; // ряд под поворот
      else if (blocker && blocker !== 'walker' && gap < 18 && toEnd > 25) {
        const slow = blocker === 'player' || blocker === 'bike' || blocker.trolley || blocker.hazard > 0 || (blocker.v ?? 0) < c.v - 0.5 || c.v < 1;
        if (slow) want = c.lane + 1 < e.lanes ? c.lane + 1 : c.lane - 1; // обгон слева, если есть куда
      }
      want = Math.max(0, Math.min(e.lanes - 1, want));
      if (want !== c.lane) {
        const step = want > c.lane ? 1 : -1;
        // Полоса свободна: нет NPC и нет игрока (и курьеров) рядом на целевой полосе — от 9 м сзади до 14 м впереди.
        let free = !this.cars.some((o) => o !== c && o.e === e && o.lane === c.lane + step && Math.abs(o.s - c.s) < 11);
        const others = [this.player, ...(this.extra ? this.extra() : [])].filter(Boolean);
        for (let d = -9; d <= 14 && free; d += 2.5) {
          const q = lanePoint(e, c.s + d, c.lane + step);
          if (others.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 2.8)) free = false;
        }
        if (free) {
          c.lane += step;
          c.laneBlink = step > 0 ? -1 : 1; // большая полоса — левее
          c.laneCd = 4 + c.rnd() * 3;
        }
      }
    }
    // Сигнал: стоим из-за кого-то (не на красный) дольше терпения.
    const waiting = c.v < 0.5 && blocker && blocker !== 'walker' && this.stopDistance(c) === null;
    c.blockedT = waiting ? c.blockedT + dt : 0;
    const patience = blocker === 'player' ? (c.aggr ? 1.5 : 3.5) : c.aggr ? 4 : 8;
    if (c.blockedT > patience && c.honkCd <= 0) {
      this.honks.push({ x: c.x, z: c.z, aggr: c.aggr });
      c.honkCd = c.aggr ? 3 : 6;
    }
    // Такси иногда тормозит и встаёт с аварийкой — высадка.
    if (c.taxi && !c.trolley) {
      c.taxiCd -= dt;
      if (c.taxiCd <= 0 && !c.turn && e.hw !== 'primary' && c.lane === 0 && e.len - c.s > 20) {
        c.hazard = 5 + c.rnd() * 5;
        c.taxiCd = 40 + c.rnd() * 50;
      }
    }
  }

  // Продвигаем «идеальную» точку маршрута; сама машина едет за ней по физике (drive).
  advance(c, ds) {
    let left = ds;
    while (left > 0) {
      if (c.turn) {
        const room = c.turn.len - c.turn.t;
        if (left < room) {
          c.turn.t += left;
          return;
        }
        left -= room;
        c.e = c.next;
        c.lane = c.nextLane;
        c.s = c.rIn;
        c.turn = null;
        this.planNext(c);
        continue;
      }
      const end = c.next ? c.e.len - c.rOut : c.e.len;
      if (c.s + left < end) {
        c.s += left;
        return;
      }
      left -= Math.max(0, end - c.s);
      c.s = end;
      if (!c.next) {
        // Край карты — переносим на случайное ребро (троллейбус — на Невский).
        const pool = c.trolley ? this.nevsky : this.graph.edges;
        c.e = pool[Math.floor(c.rnd() * pool.length)];
        c.s = 0;
        c.lane = 0;
        c.teleport = true;
        this.planNext(c);
        return;
      }
      c.turn = { ...c.plan, t: 0 };
    }
  }

  // Точка маршрута на d метров впереди: текущее ребро → дуга поворота → следующее ребро.
  routeAhead(c, d) {
    if (c.turn) {
      const rem = c.turn.len - c.turn.t;
      if (d < rem) return bezierAt(c.turn, c.turn.t + d);
      return lanePoint(c.next, c.rIn + (d - rem), c.nextLane);
    }
    const end = c.next ? c.e.len - c.rOut : c.e.len;
    const rem = end - c.s;
    if (d < rem || !c.next) return lanePoint(c.e, Math.min(c.e.len, c.s + d), c.lane);
    if (d - rem < c.plan.len) return bezierAt(c.plan, d - rem);
    return lanePoint(c.next, c.rIn + (d - rem - c.plan.len), c.nextLane);
  }

  // Та же модель, что у игрока: рулим в точку впереди (pure pursuit), курс меняется
  // только через руль и колёсную базу — поэтому кузов поворачивает плавно.
  drive(c, dt) {
    const here = this.routeAhead(c, 0);
    const off = Math.hypot(here.x - c.x, here.z - c.z);
    // Сильно ушли с траектории — плавно подтягиваемся, а не прыгаем.
    // Подтягиваем к траектории только на ходу: стоящая машина не должна «плыть» вбок
    // (так было, когда NPC начал перестроение и встал перед игроком).
    if (off > 2.5 && !c.teleport && dt && c.v > 0.5) {
      const k = Math.min(1, dt * 1.5 * Math.min(1, c.v / 4)) * (off - 2.5) / off;
      c.x += (here.x - c.x) * k;
      c.z += (here.z - c.z) * k;
    }
    if (c.teleport || off > 15) {
      c.x = here.x;
      c.z = here.z;
      c.h = Math.atan2(-here.dx, -here.dz);
      c.steer = 0;
      c.teleport = false;
    }
    const Ld = 3 + c.v * 0.45;
    const q = this.routeAhead(c, Ld);
    const fx = -Math.sin(c.h), fz = -Math.cos(c.h);
    const dx = q.x - c.x, dz = q.z - c.z;
    const lat = dx * -fz + dz * fx; // > 0 — цель справа
    const dist2 = Math.max(4, dx * dx + dz * dz);
    const wb = c.wb ?? WHEELBASE;
    const want = Math.max(-0.45, Math.min(0.45, Math.atan((2 * wb * lat) / dist2)));
    const rate = 2.4 * dt;
    c.steer += Math.max(-rate, Math.min(rate, want - c.steer));
    const yawRate = (c.v / wb) * Math.tan(c.steer);
    c.h -= yawRate * dt;
    const nfx = -Math.sin(c.h), nfz = -Math.cos(c.h);
    c.x += nfx * c.v * dt;
    c.z += nfz * c.v * dt;

    // Мягкий крен наружу поворота, как у игрока.
    const rollTarget = Math.max(-0.025, Math.min(0.025, c.v * yawRate * 0.0035));
    c.roll = (c.roll || 0) + (rollTarget - (c.roll || 0)) * Math.min(1, dt * 3);

    const m = c.model;
    m.position.set(c.x, 0, c.z);
    m.rotation.y = c.h;
    m.userData.body.rotation.z = c.roll;
    c.spin += (c.v / 0.34) * dt;
    for (const w of m.userData.wheels) {
      w.mesh.rotation.x = -c.spin;
      if (w.front) w.pivot.rotation.y = -c.steer;
    }
  }

  stopDistance(c) {
    const look = (e, base, rOut) => {
      for (const sg of e.signals) {
        const d = base + Math.min(sg.stopD ?? sg.d - 5, e.len - rOut - 0.5);
        if (d < -0.5 || d > 50) continue;
        const p = lanePoint(e, sg.d, 0);
        const st = this.signals.state(this.signals.axisOf(p.dx, p.dz));
        if (st === 'red' || (st === 'yellow' && d > (c.v * c.v) / 6)) return Math.max(0, d);
      }
      return null;
    };
    const here = look(c.e, -c.s, c.rOut);
    if (here !== null) return here;
    if (c.next) return look(c.next, c.e.len - c.s, 0);
    return null;
  }
}

// Дуга поворота: от точки на своей полосе до точки на новой; контрольная — пересечение полос.
function makeTurn(c) {
  const a = lanePoint(c.e, c.e.len - c.rOut, c.lane);
  const b = lanePoint(c.next, c.rIn, c.nextLane);
  let cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  const den = a.dx * b.dz - a.dz * b.dx;
  if (Math.abs(den) > 0.15) {
    const t = ((b.x - a.x) * b.dz - (b.z - a.z) * b.dx) / den;
    if (t > 0 && t < 40) {
      cx = a.x + a.dx * t;
      cz = a.z + a.dz * t;
    }
  }
  const turn = { p0: [a.x, a.z], p1: [cx, cz], p2: [b.x, b.z], t: 0, table: [[0, 0]] };
  // Таблица длин дуги — чтобы ехать по кривой с постоянной скоростью.
  let L = 0;
  let prev = turn.p0;
  for (let i = 1; i <= 16; i++) {
    const q = quad(turn, i / 16);
    L += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    turn.table.push([L, i / 16]);
    prev = q;
  }
  turn.len = Math.max(0.01, L);
  return turn;
}

function quad(t, u) {
  const v = 1 - u;
  return [
    v * v * t.p0[0] + 2 * v * u * t.p1[0] + u * u * t.p2[0],
    v * v * t.p0[1] + 2 * v * u * t.p1[1] + u * u * t.p2[1],
  ];
}

function bezierAt(t, dist) {
  let i = 1;
  while (i < t.table.length - 1 && t.table[i][0] < dist) i++;
  const [l0, u0] = t.table[i - 1];
  const [l1, u1] = t.table[i];
  const u = u0 + ((u1 - u0) * (dist - l0)) / Math.max(1e-6, l1 - l0);
  const p = quad(t, u);
  const v = 1 - u;
  const dx = 2 * v * (t.p1[0] - t.p0[0]) + 2 * u * (t.p2[0] - t.p1[0]);
  const dz = 2 * v * (t.p1[1] - t.p0[1]) + 2 * u * (t.p2[1] - t.p1[1]);
  const l = Math.hypot(dx, dz) || 1;
  return { x: p[0], z: p[1], dx: dx / l, dz: dz / l };
}

// Точка (x, z) ближе r к кузову машины o (длинный кузов — по нескольким точкам вдоль оси).
function nearBody(o, x, z, r) {
  if (!o.half || o.half < 2) return Math.hypot(o.x - x, o.z - z) < r;
  const fx = -Math.sin(o.h), fz = -Math.cos(o.h);
  for (const k of [-1, -0.33, 0.33, 1]) {
    if (Math.hypot(o.x + fx * o.half * k - x, o.z + fz * o.half * k - z) < r + 0.4) return true;
  }
  return false;
}

function endDir(e) {
  const n = e.pts.length;
  return [e.pts[n - 1][0] - e.pts[n - 2][0], e.pts[n - 1][1] - e.pts[n - 2][1]];
}

function startDir(e) {
  return [e.pts[1][0] - e.pts[0][0], e.pts[1][1] - e.pts[0][1]];
}

function turnAngle(a, b) {
  const [ax, az] = endDir(a);
  const [bx, bz] = startDir(b);
  const d = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

// > 0 — направо, < 0 — налево (x на восток, z на юг); 0 — прямо.
function turnSide(a, b) {
  if (turnAngle(a, b) < 0.5) return 0;
  const [ax, az] = endDir(a);
  const [bx, bz] = startDir(b);
  return Math.sign(ax * bz - az * bx);
}
