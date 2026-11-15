import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, cid, applyAction, isWon, cloneState } from '../logic.js';
import { solve } from '../solver.js';

function mk({ tab = [], found = [0, 0, 0, 0], stock = [], waste = [] }) {
  return {
    seed: 0, stock, waste, moves: 0, up: Array(52).fill(true),
    found: found.map((n, s) => Array.from({ length: n }, (_, k) => cid(k + 1, s))),
    tab: Array.from({ length: 7 }, (_, i) => tab[i] || []),
  };
}
const replay = (g, actions) => {
  const s = cloneState(g);
  for (const a of actions) if (!applyAction(s, a)) return null;
  return s;
};

test('実際の配札(seed 2)を解き、その手順を再生すると勝てる', () => {
  const g = newGame(2);
  const r = solve(g, { timeLimitMs: 20000, improveMs: 300 });
  assert.equal(r.status, 'solved');
  assert.equal(r.length, r.actions.length);
  assert.equal(isWon(replay(g, r.actions)), true);
});

test('途中まで進んだ盤面(山札を数回めくった状態)も解ける', () => {
  const g = newGame(4);
  for (let i = 0; i < 5; i++) applyAction(g, { t: 'draw' });
  const r = solve(g, { timeLimitMs: 20000, improveMs: 300 });
  assert.equal(r.status, 'solved');
  assert.equal(isWon(replay(g, r.actions)), true);
});

test('あと一歩の盤面は最短で解く(Kを4枚上げるだけ)', () => {
  const g = mk({ found: [12, 12, 12, 12], tab: [[cid(13, 0)], [cid(13, 1)], [cid(13, 2)], [cid(13, 3)]] });
  const r = solve(g, { timeLimitMs: 2000, improveMs: 100 });
  assert.equal(r.status, 'solved');
  assert.equal(r.length, 4);
});

test('どうやっても勝てない盤面は solved にならない', () => {
  const g = mk({ tab: [[cid(2, 0)], [cid(2, 3)], [cid(2, 1)], [cid(2, 2)]] });
  const r = solve(g, { timeLimitMs: 2000, improveMs: 100 });
  assert.notEqual(r.status, 'solved');
  assert.deepEqual(r.actions, []);
});

test('時間切れは timeout を返し、制限時間を大きく超えない', () => {
  const g = newGame(25); // 重い配札
  const r = solve(g, { timeLimitMs: 800, improveMs: 100 });
  assert.ok(['solved', 'timeout', 'exhausted'].includes(r.status));
  assert.ok(r.ms < 2500, `took ${r.ms}`);
});
