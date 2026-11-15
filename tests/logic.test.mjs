import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, draw, move, cid, rank, suit, isWon, isStuck, calcScore,
  autoMoveTarget, seedFromString, canAutoFinish, cloneState,
} from '../logic.js';

const SUITS = { S: 0, H: 1, D: 2, C: 3 };
const R = { A: 1, J: 11, Q: 12, K: 13 };
const c = (str) => {
  const s = SUITS[str.slice(-1)];
  const r = str.slice(0, -1);
  return cid(R[r] ?? Number(r), s);
};
// カスタム盤面ビルダー: tab = [['KS','QH'],...] / 先頭が"-"付きなら裏向き
function mk({ tab = [], stock = [], waste = [], found = [0, 0, 0, 0] }) {
  const up = Array(52).fill(true);
  const t = Array.from({ length: 7 }, (_, i) =>
    (tab[i] || []).map((x) => {
      if (x.startsWith('-')) { const id = c(x.slice(1)); up[id] = false; return id; }
      return c(x);
    }));
  const f = found.map((n, s) => Array.from({ length: n }, (_, k) => cid(k + 1, s)));
  stock.forEach((x) => { up[c(x)] = false; });
  return { stock: stock.map(c), waste: waste.map(c), found: f, tab: t, up, moves: 0 };
}

test('newGame: 28枚が場札、24枚が山札、全52枚が重複なし', () => {
  const s = newGame(1);
  assert.equal(s.stock.length, 24);
  s.tab.forEach((col, i) => assert.equal(col.length, i + 1));
  const all = [...s.stock, ...s.waste, ...s.tab.flat()];
  assert.equal(new Set(all).size, 52);
  s.tab.forEach((col) => col.forEach((id, j) => assert.equal(s.up[id], j === col.length - 1)));
});

test('同じシードは同じ配置、違うシードは違う配置', () => {
  assert.deepEqual(newGame(seedFromString('2026-11-15')).tab, newGame(seedFromString('2026-11-15')).tab);
  assert.notDeepEqual(newGame(1).tab, newGame(2).tab);
});

test('draw: 山札→捨て札、空なら捨て札を戻して再利用、両方空なら何もしない', () => {
  const s = newGame(3);
  const top = s.stock[s.stock.length - 1];
  assert.equal(draw(s), true);
  assert.equal(s.waste[s.waste.length - 1], top);
  assert.equal(s.up[top], true);
  while (s.stock.length) draw(s);
  assert.equal(draw(s), true); // 再利用
  assert.equal(s.waste.length, 0);
  assert.equal(s.stock.length, 24);
  assert.equal(s.up[s.stock[0]], false);
  const e = mk({});
  assert.equal(draw(e), false);
});

test('move: 場札の積み方ルール(色違い・ランク-1、空列はK)', () => {
  const s = mk({ tab: [['7H'], ['6S'], ['6D'], [], ['KS']] });
  assert.equal(move(s, { zone: 'tab', col: 2, idx: 0 }, { zone: 'tab', col: 0 }).ok, false); // 6D→7H は同色
  assert.equal(move(s, { zone: 'tab', col: 1, idx: 0 }, { zone: 'tab', col: 0 }).ok, true);
  assert.equal(move(s, { zone: 'tab', col: 0, idx: 0 }, { zone: 'tab', col: 3 }).ok, false); // 7H(山) は空列不可
  assert.equal(move(s, { zone: 'tab', col: 4, idx: 0 }, { zone: 'tab', col: 3 }).ok, true);
});

test('move: 裏向きは返り、移動で下が自動的に表になる', () => {
  const s = mk({ tab: [['-3C', '5H'], ['6S']] });
  const r = move(s, { zone: 'tab', col: 0, idx: 1 }, { zone: 'tab', col: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.flipped, c('3C'));
  assert.equal(s.up[c('3C')], true);
});

test('move: 上がり札(スート別、Aから順)', () => {
  const s = mk({ tab: [['AH'], ['2H'], ['AS']] });
  assert.equal(move(s, { zone: 'tab', col: 1, idx: 0 }, { zone: 'found', pile: 1 }).ok, false);
  assert.equal(move(s, { zone: 'tab', col: 0, idx: 0 }, { zone: 'found', pile: 1 }).ok, true);
  assert.equal(move(s, { zone: 'tab', col: 1, idx: 0 }, { zone: 'found', pile: 1 }).ok, true);
  assert.equal(move(s, { zone: 'tab', col: 2, idx: 0 }, { zone: 'found', pile: 1 }).ok, false);
});

test('autoMoveTarget: 上がり札を優先、なければ積める列', () => {
  const s = mk({ tab: [['AH'], ['7S'], ['6H']] });
  assert.deepEqual(autoMoveTarget(s, { zone: 'tab', col: 0, idx: 0 }), { zone: 'found', pile: 1 });
  assert.deepEqual(autoMoveTarget(s, { zone: 'tab', col: 2, idx: 0 }), { zone: 'tab', col: 1 });
  assert.equal(autoMoveTarget(s, { zone: 'tab', col: 1, idx: 0 }), null);
});

test('isWon / calcScore', () => {
  assert.equal(isWon(mk({ found: [13, 13, 13, 13] })), true);
  assert.equal(isWon(mk({ found: [13, 13, 13, 12] })), false);
  assert.equal(calcScore(100, 50), 10000 - 1000 - 1000);
  assert.equal(calcScore(5000, 5000), 0);
});

test('isStuck: 何も動かせない盤面は詰み', () => {
  const s = mk({ tab: [['2S'], ['2C'], ['2H'], ['2D']] });
  assert.equal(isStuck(s), true);
});

test('isStuck: 勝利済みは詰みでない', () => {
  assert.equal(isStuck(mk({ found: [13, 13, 13, 13] })), false);
});

test('isStuck: 山札/捨て札に置ける札があれば詰みでない', () => {
  assert.equal(isStuck(mk({ tab: [['2S'], ['2C'], ['2H'], ['2D']], stock: ['AH'] })), false);
  assert.equal(isStuck(mk({ tab: [['2S'], ['2C'], ['2H'], ['2D']], waste: ['AH'] })), false);
  assert.equal(isStuck(mk({ tab: [['5S'], ['2C'], ['2H'], ['2D']], stock: ['4H'] })), false);
});

test('isStuck: 山札の札が全部置けないなら詰み', () => {
  assert.equal(isStuck(mk({ tab: [['2S'], ['2C'], ['2H'], ['2D']], stock: ['5H', '9D'], waste: ['JC'] })), true);
});

test('isStuck: 裏返せる手があれば詰みでない', () => {
  const s = mk({ tab: [['-9C', '5H'], ['6S'], ['2C'], ['2D']] });
  assert.equal(isStuck(s), false);
});

test('isStuck: 連なりごと動かして裏が開くなら詰みでない / 動かす先が無ければ詰み', () => {
  assert.equal(isStuck(mk({ tab: [['-3S', '7C', '6D'], ['8H'], ['2D']] })), false);
  assert.equal(isStuck(mk({ tab: [['-3S', '7C', '6D'], ['8S'], ['2D']] })), true);
});

test('isStuck: 先に邪魔札をどかす2手で進展できるなら詰みでない', () => {
  // 6C を 7D へ置きたいが 7D の上に 6S がある。6S は 7H へ移せるが、6C も 7H に置けるので1手で足りる。
  // 6S を動かさないと進展しない形: 7D は 8C 上、6S のみ 7H へ移せる(7H は唯一の赤7、6C は 7D のみ可の設計は不可能)ため
  // ここでは 6S を退避→ 2D? ではなく、退避で5Hが空く形を使う。
  const s = mk({ tab: [['-3S', '6C'], ['8C', '7D', '6S'], ['7H']] });
  assert.equal(isStuck(s), false);
});

test('isStuck: 上がり札から戻して進展するケース', () => {
  // 4S は上がり札(3まで)に載っており、そこから場の5Hに載せ替えても進展は無い → 詰み
  const s = mk({ tab: [['5H'], ['9C'], ['9D'], ['KC']], found: [4, 0, 0, 0] });
  // 5H は上がり札(♥)に置けない。♠4を5Hへ戻しても得なし
  assert.equal(isStuck(s), true);
});

test('canAutoFinish: 山札空かつ全て表向き', () => {
  assert.equal(canAutoFinish(mk({ tab: [['5H'], ['9C']] })), true);
  assert.equal(canAutoFinish(mk({ tab: [['-5H', '4S']] })), false);
  assert.equal(canAutoFinish(mk({ tab: [['5H']], stock: ['2C'] })), false);
});

test('cloneState は独立コピー', () => {
  const s = newGame(5);
  const t = cloneState(s);
  draw(t);
  assert.equal(s.stock.length, 24);
});

test('rank/suit', () => {
  assert.equal(rank(c('KD')), 13);
  assert.equal(suit(c('KD')), 2);
});
