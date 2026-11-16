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

// ---- 証明モード(complete): 「勝てない」は誤って出してはいけない ----
import { move, draw, canMove, isStuck } from '../logic.js';
test('complete mode proves unwinnable positions and never contradicts a found solution', () => {
  let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let proven = 0;
  for (let i = 1; i <= 40; i++) {
    const s = newGame(i * 31337);
    const limit = 40 + Math.floor(rnd() * 400);
    for (let steps = 0; steps < limit && !isWon(s) && !isStuck(s); steps++) {
      const legal = [];
      const froms = [{ zone: 'waste' }];
      for (let c = 0; c < 7; c++) for (let k = 0; k < s.tab[c].length; k++) if (s.up[s.tab[c][k]]) froms.push({ zone: 'tab', col: c, idx: k });
      for (const f of froms) {
        for (let p = 0; p < 4; p++) if (canMove(s, f, { zone: 'found', pile: p })) legal.push([f, { zone: 'found', pile: p }, 3]);
        for (let c = 0; c < 7; c++) if (canMove(s, f, { zone: 'tab', col: c })) legal.push([f, { zone: 'tab', col: c }, 1]);
      }
      legal.push(['draw', null, 0.6]);
      let r = rnd() * legal.reduce((a, m) => a + m[2], 0), pick = legal[0];
      for (const m of legal) { r -= m[2]; if (r <= 0) { pick = m; break; } }
      if (pick[0] === 'draw') draw(s); else move(s, pick[0], pick[1]);
    }
    const r = solve(s, { complete: true, timeLimitMs: 1500 });
    if (r.status === 'unwinnable') {
      proven++;
      assert.notEqual(solve(s, { timeLimitMs: 4000, improveMs: 0 }).status, 'solved', `contradiction at deal ${i}`);
    }
  }
  assert.ok(proven >= 5, `expected several proofs, got ${proven}`);
});
