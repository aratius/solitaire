import test from 'node:test';
import assert from 'node:assert/strict';
import { monthKey, weekStart, weekEnd, periodLabel, rankRows, rankIn } from '../periods.js';

test('weeks run Monday to Sunday', () => {
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // Sunday belongs to the week that began Monday the 9th
  assert.equal(weekStart('2026-11-09'), '2026-11-09'); // Monday
  assert.equal(weekStart('2026-11-10'), '2026-11-09');
  assert.equal(weekEnd('2026-11-12'), '2026-11-15');
});

test('weeks cross month and year boundaries', () => {
  assert.equal(weekStart('2026-01-01'), '2025-12-29'); // Thursday
  assert.equal(weekEnd('2026-01-01'), '2026-01-04');
  assert.equal(weekStart('2024-03-01'), '2024-02-26'); // leap year
  assert.equal(weekEnd('2026-03-30'), '2026-04-05');
});

test('month key and labels', () => {
  assert.equal(monthKey('2026-11-15'), '2026-11');
  assert.equal(periodLabel('day', '2026-11-15'), 'Nov 15 (JST)');
  assert.equal(periodLabel('week', '2026-11-15'), 'Nov 9 – Nov 15');
  assert.equal(periodLabel('month', '2026-11-15'), 'November 2026');
  assert.equal(periodLabel('all', '2026-11-15'), 'All time');
});

const row = (uid, score, time = 100, moves = 100) => ({ uid, name: uid, score, time, moves });

test('rankRows keeps one best row per player and orders them', () => {
  const rows = [row('a', 5000), row('b', 7000), row('a', 6000), row('c', 7000, 90), row('b', 1000)];
  const out = rankRows(rows);
  assert.deepEqual(out.map((r) => [r.uid, r.score]), [['c', 7000], ['b', 7000], ['a', 6000]]); // tie on score: faster time first
});

test('rankRows breaks full ties by moves and limits the count', () => {
  const rows = [row('a', 5000, 100, 90), row('b', 5000, 100, 80), row('c', 100)];
  assert.deepEqual(rankRows(rows, 2).map((r) => r.uid), ['b', 'a']);
  assert.deepEqual(rankRows([]), []);
});

test('rankIn counts only other players with a higher score', () => {
  const rows = [row('a', 9000), row('b', 8000), row('me', 7000), row('me', 6000), row('c', 7000)];
  assert.equal(rankIn(rows, 7000, 'me'), 3);
  assert.equal(rankIn(rows, 9500, 'me'), 1);
  assert.equal(rankIn([], 100, 'me'), 1);
});
