// 自動解答(リタイヤ時にコンピュータが見せる手順)。DOM非依存。
// 1枚めくり・山札無限周回。深さ優先 + 置換表 + 安全な上がり札の自動処理。
// 最初の解が見つかったら、短い解を探す時間(improveMs)だけ探索を続ける(最短保証はない)。
import { rank, suit, isRed } from './logic.js';

function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// opts.complete: 「勝てない」の証明用。枝刈りを健全なものだけにし(分割移動・上がり札からの戻しも探索)、
//   探索を最後までやり切って解が無ければ status:'unwinnable' を返す。時間・状態数の上限に当たれば 'timeout'(=不明)。
// 戻り値: { status: 'solved'|'unwinnable'|'exhausted'|'timeout', actions, length, nodes, ms }
export function solve(game, opts = {}) {
  const timeLimit = opts.timeLimitMs ?? 15000;
  const complete = !!opts.complete;
  const improveMs = complete ? 0 : (opts.improveMs ?? 3000);
  const maxStates = opts.maxStates ?? 900000;
  const t0 = clock();
  let deadline = t0 + timeLimit;

  const H = game.tab.map((col) => col.filter((id) => !game.up[id]));
  const root = {
    down: H.map((h) => h.length),
    ups: game.tab.map((col) => col.filter((id) => game.up[id])),
    f: game.found.map((f) => f.length),
    D: game.waste.concat(game.stock.slice().reverse()),
    p: game.waste.length,
    fc: game.found.reduce((n, f) => n + f.length, 0),
  };

  const clone = (s) => ({ down: s.down.slice(), ups: s.ups.slice(), f: s.f.slice(), D: s.D, p: s.p, fc: s.fc });
  const canTab = (s, c, card) => {
    const u = s.ups[c];
    if (u.length === 0) return s.down[c] === 0 && rank(card) === 13;
    const top = u[u.length - 1];
    return rank(top) === rank(card) + 1 && isRed(top) !== isRed(card);
  };
  const canFound = (s, card) => s.f[suit(card)] === rank(card) - 1;
  const isSafe = (s, card) => {
    const r = rank(card);
    if (r <= 2) return true;
    const o = isRed(card) ? [0, 3] : [1, 2];
    return Math.min(s.f[o[0]], s.f[o[1]]) >= r - 1;
  };
  // 列aのk番目以降を取り除く(足りなければ下の裏向き札を開く)
  const cut = (s, a, k) => {
    const u = s.ups[a].slice(0, k);
    if (u.length === 0 && s.down[a] > 0) {
      s.down = s.down.slice();
      s.down[a]--;
      u.push(H[a][s.down[a]]);
    }
    s.ups[a] = u;
  };
  const moveAct = (card, to) => ({ t: 'move', card, to });
  const DRAW = { t: 'draw' };

  const tabToTab = (s, a, k, b) => {
    const run = s.ups[a].slice(k);
    const ns = clone(s);
    ns.ups[b] = s.ups[b].concat(run);
    cut(ns, a, k);
    return { s: ns, acts: [moveAct(run[0], { zone: 'tab', col: b })] };
  };
  const tabToFound = (s, a) => {
    const u = s.ups[a], card = u[u.length - 1];
    const ns = clone(s);
    ns.f[suit(card)]++; ns.fc++;
    cut(ns, a, u.length - 1);
    return { s: ns, acts: [moveAct(card, { zone: 'found', pile: suit(card) })] };
  };
  const drawsFor = (s, j) => {
    const n = s.D.length;
    if (j === s.p - 1) return 0;
    if (j >= s.p) return j + 1 - s.p;
    return (n - s.p) + 1 + (j + 1);
  };
  const deckTo = (s, j, to) => {
    const card = s.D[j];
    const acts = [];
    for (let i = drawsFor(s, j); i > 0; i--) acts.push(DRAW);
    acts.push(moveAct(card, to));
    const ns = clone(s);
    ns.D = s.D.slice(0, j).concat(s.D.slice(j + 1));
    ns.p = j;
    if (to.zone === 'found') { ns.f[to.pile]++; ns.fc++; } else ns.ups[to.col] = s.ups[to.col].concat([card]);
    return { s: ns, acts };
  };

  // 安全に上がれる札を自動で上がり札へ(分岐させない)
  const forced = (s0, out) => {
    let s = s0, again = true;
    while (again) {
      again = false;
      for (let c = 0; c < 7; c++) {
        const u = s.ups[c];
        if (!u.length) continue;
        const card = u[u.length - 1];
        if (canFound(s, card) && isSafe(s, card)) {
          const r = tabToFound(s, c); s = r.s; out.push(...r.acts); again = true;
        }
      }
      if (s.p > 0) {
        const card = s.D[s.p - 1];
        if (canFound(s, card) && isSafe(s, card)) {
          const r = deckTo(s, s.p - 1, { zone: 'found', pile: suit(card) }); s = r.s; out.push(...r.acts); again = true;
        }
      }
    }
    return s;
  };

  const gen = (s) => {
    const moves = [];
    const empties = [];
    for (let c = 0; c < 7; c++) if (s.ups[c].length === 0 && s.down[c] === 0) empties.push(c);
    const firstEmpty = empties.length ? empties[0] : -1;
    const targets = (card) => {
      const t = [];
      for (let b = 0; b < 7; b++) {
        if (s.ups[b].length === 0 && s.down[b] === 0 && b !== firstEmpty) continue;
        if (canTab(s, b, card)) t.push(b);
      }
      return t;
    };
    // 山札側の札が置ける先(分割移動の可否判定に使う)
    const placeable = (card) => {
      if (complete) return true; // 証明モードでは分割移動を枝刈りしない
      for (const d of s.D) if (rank(d) === rank(card) - 1 && isRed(d) !== isRed(card)) return true;
      for (let c = 0; c < 7; c++) {
        const u = s.ups[c];
        if (u.length) { const h = u[0]; if (rank(h) === rank(card) - 1 && isRed(h) !== isRed(card)) return true; }
      }
      return false;
    };
    for (let a = 0; a < 7; a++) {
      const u = s.ups[a];
      for (let k = 0; k < u.length; k++) {
        const head = u[k];
        if (k > 0) {
          const ex = u[k - 1];
          if (!(canFound(s, ex) || placeable(ex))) continue;
        }
        for (const b of targets(head)) {
          if (b === a) continue;
          if (k === 0 && s.down[a] === 0 && s.ups[b].length === 0) continue;
          const pri = k === 0 && s.down[a] > 0 ? 0 - s.down[a] * 0.01 : (k === 0 ? 3 : 4);
          const m = tabToTab(s, a, k, b); m.pri = pri; moves.push(m);
        }
      }
      if (u.length && canFound(s, u[u.length - 1])) { const m = tabToFound(s, a); m.pri = 1; moves.push(m); }
    }
    for (let j = 0; j < s.D.length; j++) {
      const card = s.D[j];
      if (canFound(s, card)) { const m = deckTo(s, j, { zone: 'found', pile: suit(card) }); m.pri = 1 + m.acts.length * 0.001; moves.push(m); }
      for (const b of targets(card)) { const m = deckTo(s, j, { zone: 'tab', col: b }); m.pri = 2 + m.acts.length * 0.01; moves.push(m); }
    }
    if (complete) { // 上がり札の一番上を場札へ戻す手(まれに必要)
      for (let p = 0; p < 4; p++) {
        if (s.f[p] === 0) continue;
        const card = p * 13 + s.f[p] - 1;
        for (const b of targets(card)) {
          const ns = clone(s);
          ns.f[p]--; ns.fc--;
          ns.ups[b] = s.ups[b].concat([card]);
          moves.push({ s: ns, acts: [moveAct(card, { zone: 'tab', col: b })], pri: 5 });
        }
      }
    }
    if (noise) for (const m of moves) m.pri += Math.random() * noise;
    moves.sort((x, y) => x.pri - y.pri);
    return moves;
  };

  const key = (s) => {
    let k = `${s.p}|${s.f[0]},${s.f[1]},${s.f[2]},${s.f[3]}`;
    for (let c = 0; c < 7; c++) k += `|${s.down[c]}:${s.ups[c].join(',')}`;
    // 証明モードは衝突で誤って「勝てない」と言わないよう、2つのハッシュを連結する
    return complete ? `${cyrb53(k)}.${cyrb53(k + '#')}` : cyrb53(k);
  };

  let best = Infinity, bestPath = null, nodes = 0, aborted = false, firstAt = null;
  let noise = 0, nodeCap = Infinity, capHit = false, attemptNodes = 0;
  let visited = new Map();
  const path = [];

  const dfs = (s, g) => {
    nodes++; attemptNodes++;
    if ((nodes & 1023) === 0 && clock() > deadline) aborted = true;
    if (attemptNodes > nodeCap && best === Infinity) { capHit = true; aborted = true; }
    if (aborted) return;
    const mark = path.length;
    const fa = [];
    s = forced(s, fa);
    for (const a of fa) path.push(a);
    g += fa.length;
    if (s.fc === 52) {
      if (g < best) {
        best = g; bestPath = path.slice();
        if (firstAt === null) { firstAt = clock(); deadline = Math.min(deadline, firstAt + improveMs); }
      }
      path.length = mark; return;
    }
    if (g + (52 - s.fc) >= best) { path.length = mark; return; }
    const h = key(s);
    const prev = visited.get(h);
    if (prev !== undefined && (complete || prev <= g)) { path.length = mark; return; }
    visited.set(h, g);
    if (visited.size > (complete ? maxStates : 2500000)) { if (complete) { capHit = true; aborted = true; return; } visited = new Map(); }
    const moves = gen(s);
    for (const m of moves) {
      if (aborted) break;
      const m2 = path.length;
      for (const a of m.acts) path.push(a);
      dfs(m.s, g + m.acts.length);
      path.length = m2;
    }
    path.length = mark;
  };

  // 重い裾野を避けるため、ノード上限を倍々に増やしながら順序を揺らして再試行する
  let cap = complete ? Infinity : 120000;
  for (let attempt = 0; ; attempt++) {
    noise = complete || attempt === 0 ? 0 : (attempt < 3 ? 0.8 : 2.2);
    nodeCap = cap; attemptNodes = 0; capHit = false; aborted = false;
    visited = new Map();
    dfs(root, 0);
    if (!capHit || complete) break; // 時間切れ or 探索完了 or 解あり(証明モードは1回だけ)
    if (clock() > deadline) break;
    cap = Math.min(cap * 1.6, 3000000);
  }
  const ms = clock() - t0;
  if (bestPath) return { status: 'solved', actions: bestPath, length: best, nodes, ms };
  const incomplete = clock() > deadline || capHit || aborted;
  return { status: incomplete ? 'timeout' : (complete ? 'unwinnable' : 'exhausted'), actions: [], length: 0, nodes, ms };
}
