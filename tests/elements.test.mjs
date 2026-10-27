import test from 'node:test';
import assert from 'node:assert/strict';
import { findPassages, PASSAGE, risalitRing, attachToWalls, throughPassages } from '../tools/elements.mjs';

// Дом 20 × 12 м с двором 8 × 4 м посередине.
const house = {
  o: [[0, 0], [20, 0], [20, 12], [0, 12]],
  i: [[[6, 4], [6, 8], [14, 8], [14, 4]]],
  mh: 0,
};

test('findPassages: проезд с улицы во двор — арка в наружной стене и в стене двора', () => {
  const res = findPassages([house], [{ p: [[10, -5], [10, 6]], kind: 'drive' }]);
  assert.equal(res.length, 2);
  const outer = res.find((q) => q.r === 0), court = res.find((q) => q.r === 1);
  assert.deepEqual([outer.e, outer.u, outer.w, outer.h], [0, 10, PASSAGE.drive.w, PASSAGE.drive.h]);
  assert.equal(court.e, 3); // ребро двора (14,4)→(6,4)
  assert.equal(court.u, 4);
});

test('findPassages: арка у самого угла сдвигается внутрь ребра', () => {
  const [q] = findPassages([house], [{ p: [[0.5, -5], [0.5, 2]], kind: 'foot' }]);
  assert.equal(q.u, PASSAGE.foot.w / 2 + 0.3);
});

test('findPassages: части зданий, дома на опорах и короткие рёбра не режутся', () => {
  const line = [{ p: [[10, -5], [10, 6]], kind: 'drive' }];
  assert.equal(findPassages([{ ...house, pt: 1 }], line).length, 0);
  assert.equal(findPassages([{ ...house, mh: 5 }], line).length, 0);
  const narrow = { o: [[8, 0], [11, 0], [11, 3], [8, 3]], mh: 0 }; // ребро 3 м < арки 3.5 м
  assert.equal(findPassages([narrow], line).length, 0);
});

test('findPassages: размеры из тегов перекрывают типовые', () => {
  const [q] = findPassages([house], [{ p: [[10, -5], [10, 2]], kind: 'drive', w: 5, h: 6 }]);
  assert.deepEqual([q.w, q.h], [5, 6]);
});

test('risalitRing: прямоугольник w × (out + 6) лицом к точке face', () => {
  const [a, b, c, d] = risalitRing({ at: [0, 0], face: [0, -10], w: 24, out: 1.2 });
  assert.deepEqual([a, b].map((p) => p[1]), [-1.2, -1.2]); // перед — на 1.2 м к face
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 24) < 1e-9);
  assert.deepEqual([c[1], d[1]], [6, 6]); // зад — на 6 м вглубь
});

test('attachToWalls: точка на стене — дом, кольцо, ребро и место вдоль него', () => {
  const [q] = attachToWalls([house], [{ p: [5, 0.2], kind: 'door' }]);
  assert.deepEqual([q.b, q.r, q.e, q.u, q.kind], [0, 0, 0, 5, 'door']);
  assert.equal(attachToWalls([house], [{ p: [5, 3] }]).length, 0); // далеко от стен
});

test('throughPassages: арка с улицы пробивается во двор, у арки со стороны двора нет своего свода', () => {
  const ps = findPassages([house], [{ p: [[10, -5], [10, 6]], kind: 'drive' }]);
  throughPassages([house], ps, []);
  const outer = ps.find((q) => q.r === 0), court = ps.find((q) => q.r === 1);
  assert.deepEqual([outer.depth, outer.open, court.vault], [4, 1, 0]);
});

test('throughPassages: двор без входа получает пешеходную арку со стороны улицы', () => {
  const ps = throughPassages([house], [], [[-10, -3, 30, -3]]); // улица вдоль стены z = 0
  const auto = ps.find((q) => q.auto);
  assert.ok(auto, 'арка появилась');
  assert.deepEqual([auto.r, auto.e, auto.w, auto.open], [0, 0, PASSAGE.foot.w, 1]);
  assert.ok(ps.some((q) => q.r === 1 && q.vault === 0), 'пара во дворе');
});

test('throughPassages: арка сквозь дом без двора — выход с другой стороны', () => {
  const slab = { o: [[0, 0], [20, 0], [20, 10], [0, 10]], mh: 0 };
  const ps = findPassages([slab], [{ p: [[10, -5], [10, 2]], kind: 'foot' }]);
  throughPassages([slab], ps, []);
  assert.deepEqual([ps[0].open, ps[0].depth], [1, 10]);
  assert.ok(ps.some((q) => q.r === 0 && q.e === 2 && q.vault === 0), 'выход на задней стене');
});
