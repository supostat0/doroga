import test from 'node:test';
import assert from 'node:assert/strict';
import {
  project, signedArea, normalizeRing, assembleRings, clipRing,
  pointInRing, centroid, parseMeters, buildingHeights, ORIGIN,
} from '../tools/geo.mjs';

test('project: начало координат и направления осей', () => {
  assert.deepEqual(project(ORIGIN.lat, ORIGIN.lon), [0, 0]);
  const [x, z] = project(ORIGIN.lat + 0.001, ORIGIN.lon + 0.001);
  assert.ok(Math.abs(z + 110.54) < 0.1, 'север = -z, ~110 м на 0.001°');
  assert.ok(Math.abs(x - 55.7) < 0.5, 'восток = +x, ~56 м на 0.001° на широте Питера');
});

test('normalizeRing: убирает замыкающую точку и выставляет обход', () => {
  const cw = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  const pos = normalizeRing(cw, true);
  assert.equal(pos.length, 4);
  assert.ok(signedArea(pos) > 0);
  assert.ok(signedArea(normalizeRing(cw, false)) < 0);
});

test('assembleRings: склеивает куски в разных направлениях', () => {
  const rings = assembleRings([[1, 2, 3], [5, 4, 3], [5, 6, 1], [7, 8]]);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0], [1, 2, 3, 4, 5, 6, 1]);
});

test('assembleRings: уже замкнутый путь и обрывок', () => {
  const rings = assembleRings([[1, 2, 3, 1], [9, 8, 7]]);
  assert.deepEqual(rings, [[1, 2, 3, 1]]);
});

test('clipRing: квадрат, выходящий за рамку, обрезается', () => {
  const sq = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
  const c = clipRing(sq, 0, 0, 10, 10);
  assert.equal(Math.abs(signedArea(c)), 25);
  assert.equal(clipRing(sq, 20, 20, 30, 30).length, 0);
});

test('pointInRing и centroid', () => {
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.ok(pointInRing([2, 2], sq));
  assert.ok(!pointInRing([5, 2], sq));
  assert.deepEqual(centroid(sq), [2, 2]);
});

test('parseMeters и высоты зданий', () => {
  assert.equal(parseMeters('25 m'), 25);
  assert.equal(parseMeters('12,5'), 12.5);
  assert.equal(parseMeters('abc'), null);
  assert.deepEqual(buildingHeights({ height: '81' }), { h: 81, minH: 0 });
  assert.equal(buildingHeights({ 'building:levels': '5' }).h, 5 * 3.8 + 1.5);
  assert.deepEqual(buildingHeights({ 'building:part': 'yes', 'building:levels': '2', 'building:min_level': '1' }), { h: 7.6, minH: 3.8 });
  assert.equal(buildingHeights({}).h, null);
});
