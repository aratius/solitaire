// Klondike(1枚めくり・山札無限周回) の純粋ロジック。DOM非依存。
// カードID = suit*13 + (rank-1)  suit: 0=♠ 1=♥ 2=♦ 3=♣  rank: 1..13

export const cid = (rank, suit) => suit * 13 + (rank - 1);
export const rank = (id) => (id % 13) + 1;
export const suit = (id) => Math.floor(id / 13);
export const isRed = (id) => suit(id) === 1 || suit(id) === 2;

// ---------- 乱数 ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- 状態 ----------
export function newGame(seed) {
  const rnd = mulberry32(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const up = Array(52).fill(false);
  const tab = [];
  let p = 0;
  for (let col = 0; col < 7; col++) {
    const cards = deck.slice(p, p + col + 1);
    p += col + 1;
    up[cards[cards.length - 1]] = true;
    tab.push(cards);
  }
  return { seed, stock: deck.slice(p), waste: [], found: [[], [], [], []], tab, up, moves: 0 };
}

export function cloneState(s) {
  return {
    seed: s.seed,
    stock: s.stock.slice(),
    waste: s.waste.slice(),
    found: s.found.map((a) => a.slice()),
    tab: s.tab.map((a) => a.slice()),
    up: s.up.slice(),
    moves: s.moves,
  };
}

export const isWon = (s) => s.found.every((f) => f.length === 13);
export const calcScore = (sec, moves) => Math.max(0, 10000 - Math.floor(sec) * 10 - moves * 20);

// ---------- ルール ----------
function canStack(topId, id) {
  return rank(topId) === rank(id) + 1 && isRed(topId) !== isRed(id);
}
export function canPlaceOnTab(s, id, col) {
  const column = s.tab[col];
  if (column.length === 0) return rank(id) === 13;
  const top = column[column.length - 1];
  return s.up[top] && canStack(top, id);
}
export function canPlaceOnFound(s, id) {
  return s.found[suit(id)].length === rank(id) - 1;
}

export function draw(s) {
  if (s.stock.length) {
    const id = s.stock.pop();
    s.up[id] = true;
    s.waste.push(id);
    s.moves++;
    return true;
  }
  if (s.waste.length) {
    s.stock = s.waste.reverse();
    s.waste = [];
    s.stock.forEach((id) => { s.up[id] = false; });
    s.moves++;
    return true;
  }
  return false;
}

// from: {zone:'waste'} | {zone:'tab',col,idx} | {zone:'found',pile}
// to:   {zone:'tab',col} | {zone:'found',pile}
export function cardsAt(s, from) {
  if (from.zone === 'waste') return s.waste.length ? [s.waste[s.waste.length - 1]] : [];
  if (from.zone === 'found') { const f = s.found[from.pile]; return f.length ? [f[f.length - 1]] : []; }
  if (from.zone === 'tab') {
    const col = s.tab[from.col];
    if (from.idx < 0 || from.idx >= col.length || !s.up[col[from.idx]]) return [];
    return col.slice(from.idx);
  }
  return [];
}

export function canMove(s, from, to) {
  const cards = cardsAt(s, from);
  if (!cards.length) return false;
  const head = cards[0];
  if (to.zone === 'found') return cards.length === 1 && to.pile === suit(head) && canPlaceOnFound(s, head);
  if (to.zone === 'tab') {
    if (from.zone === 'tab' && from.col === to.col) return false;
    return canPlaceOnTab(s, head, to.col);
  }
  return false;
}

export function move(s, from, to) {
  if (!canMove(s, from, to)) return { ok: false };
  const cards = cardsAt(s, from);
  let flipped = null;
  if (from.zone === 'waste') s.waste.pop();
  else if (from.zone === 'found') s.found[from.pile].pop();
  else {
    const col = s.tab[from.col];
    col.splice(from.idx, cards.length);
    if (col.length && !s.up[col[col.length - 1]]) { flipped = col[col.length - 1]; s.up[flipped] = true; }
  }
  if (to.zone === 'found') s.found[to.pile].push(...cards);
  else s.tab[to.col].push(...cards);
  s.moves++;
  return { ok: true, ids: cards, flipped };
}

// タップ時の移動先: 上がり札 > 積める列(既存の列を優先) 。なければ null
export function autoMoveTarget(s, from) {
  const cards = cardsAt(s, from);
  if (!cards.length) return null;
  const head = cards[0];
  if (cards.length === 1 && canPlaceOnFound(s, head)) return { zone: 'found', pile: suit(head) };
  let empty = null;
  for (let col = 0; col < 7; col++) {
    if (from.zone === 'tab' && from.col === col) continue;
    if (!canPlaceOnTab(s, head, col)) continue;
    if (s.tab[col].length) return { zone: 'tab', col };
    // 空列へ: 列の先頭(下に何も無いK)を動かしても意味がない
    if (!(from.zone === 'tab' && from.idx === 0) && empty === null) empty = { zone: 'tab', col };
  }
  return empty;
}

export function canAutoFinish(s) {
  return !isWon(s) && s.stock.length === 0 && s.waste.length === 0 && s.tab.every((col) => col.every((id) => s.up[id]));
}

// 上がり札へ送れる札を1つ返す(自動仕上げ用)
export function nextFoundationMove(s) {
  for (let col = 0; col < 7; col++) {
    const c = s.tab[col];
    if (c.length && canPlaceOnFound(s, c[c.length - 1])) {
      return { from: { zone: 'tab', col, idx: c.length - 1 }, to: { zone: 'found', pile: suit(c[c.length - 1]) } };
    }
  }
  if (s.waste.length) {
    const id = s.waste[s.waste.length - 1];
    if (canPlaceOnFound(s, id)) return { from: { zone: 'waste' }, to: { zone: 'found', pile: suit(id) } };
  }
  return null;
}

// ---------- 詰み判定 ----------
// 山札・捨て札は無限周回で全て取り出せるので「山札+捨て札の全カード」を候補とみなす。
// 場札どうしの入れ替え(と上がり札からの戻し)を探索し、
//   ・裏向き札が開く / ・上がり札が純増する / ・山札側の札が置ける
// のいずれかに到達できれば「まだ進展できる」=詰みでない。上限超過は安全側(詰みでない)。
export function isStuck(s, limit = 30000) {
  if (isWon(s)) return false;
  const pool = s.stock.concat(s.waste);
  const down = s.tab.map((col) => col.filter((id) => !s.up[id]).length);
  const ups0 = s.tab.map((col) => col.filter((id) => s.up[id]));
  const f0 = s.found.map((f) => f.length);
  const root = f0[0] + f0[1] + f0[2] + f0[3];

  const seen = new Set();
  const stack = [{ ups: ups0, f: f0 }];
  const key = (ups, f) => ups.map((u, i) => `${down[i]}:${u.join(',')}`).join('|') + '#' + f.join(',');
  seen.add(key(ups0, f0));

  const placeOnCol = (ups, id, col) => {
    const u = ups[col];
    if (u.length === 0) return down[col] === 0 && rank(id) === 13;
    return canStack(u[u.length - 1], id);
  };

  while (stack.length) {
    const { ups, f } = stack.pop();
    const total = f[0] + f[1] + f[2] + f[3];

    // 進展判定
    for (const id of pool) {
      if (total >= root && f[suit(id)] === rank(id) - 1) return false;
      for (let col = 0; col < 7; col++) if (placeOnCol(ups, id, col)) return false;
    }
    for (let col = 0; col < 7; col++) {
      const u = ups[col];
      if (!u.length) continue;
      const top = u[u.length - 1];
      if (total >= root && f[suit(top)] === rank(top) - 1) return false;
    }

    // 展開
    for (let a = 0; a < 7; a++) {
      const ua = ups[a];
      for (let k = 0; k < ua.length; k++) {
        const head = ua[k];
        for (let b = 0; b < 7; b++) {
          if (b === a || !placeOnCol(ups, head, b)) continue;
          if (k === 0 && down[a] > 0) return false; // 裏向きが開く
          if (k === 0 && ups[b].length === 0) continue; // 空列→空列は無意味
          const nu = ups.slice();
          nu[a] = ua.slice(0, k);
          nu[b] = ups[b].concat(ua.slice(k));
          const kk = key(nu, f);
          if (!seen.has(kk)) { seen.add(kk); stack.push({ ups: nu, f }); }
        }
      }
    }
    // 上がり札の一番上を場札へ戻す
    for (let p = 0; p < 4; p++) {
      if (f[p] === 0) continue;
      const id = cid(f[p], p);
      for (let b = 0; b < 7; b++) {
        if (!placeOnCol(ups, id, b)) continue;
        const nu = ups.slice();
        nu[b] = ups[b].concat([id]);
        const nf = f.slice();
        nf[p]--;
        const kk = key(nu, nf);
        if (!seen.has(kk)) { seen.add(kk); stack.push({ ups: nu, f: nf }); }
      }
    }
    if (seen.size > limit) return false;
  }
  return true;
}

// ---------- 位置検索 / 手順の再生 ----------
// カードの現在位置を返す。取れない札(山札・捨て札の下・裏向き)は null。
export function locateCard(s, id) {
  if (s.stock.includes(id)) return { zone: 'stock' };
  const wi = s.waste.indexOf(id);
  if (wi >= 0) return wi === s.waste.length - 1 ? { zone: 'waste' } : null;
  for (let p = 0; p < 4; p++) {
    const i = s.found[p].indexOf(id);
    if (i >= 0) return i === s.found[p].length - 1 ? { zone: 'found', pile: p } : null;
  }
  for (let c = 0; c < 7; c++) {
    const i = s.tab[c].indexOf(id);
    if (i >= 0) return s.up[id] ? { zone: 'tab', col: c, idx: i } : null;
  }
  return null;
}

// solver の1手: {t:'draw'} | {t:'move', card, to}
export function applyAction(s, a) {
  if (a.t === 'draw') return draw(s);
  const from = locateCard(s, a.card);
  return !!from && move(s, from, a.to).ok;
}
