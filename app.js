import {
  newGame, cloneState, draw, move, canMove, cardsAt, autoMoveTarget, isWon, isStuck,
  canAutoFinish, nextFoundationMove, calcScore, rank, suit, isRed, seedFromString, locateCard,
} from './logic.js';
import { solve } from './solver.js';
import { firebaseConfig } from './firebase-config.js';
import { periodLabel, fmtDay, mergeBests, improved } from './periods.js';

const $ = (s) => document.querySelector(s);
const SYM = ['♠', '♥', '♦', '♣'];
const LBL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const KEY = 'solitaire.v1';
const NICK = 'solitaire.nick';
const RANK_ON = !!(firebaseConfig && firebaseConfig.apiKey);

// ---------- 保存データ ----------
const defaults = () => ({
  stats: { played: 0, won: 0, bestTime: null, bestMoves: null, bestScore: null, daily: {}, posted: {} },
  settings: { sound: true, vibrate: true, mode: 'random' },
  save: null,
});
function loadStore() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && o.stats && o.settings) {
      const d = defaults();
      return { ...d, ...o, stats: { ...d.stats, ...o.stats }, settings: { ...d.settings, ...o.settings } };
    }
  } catch { /* 壊れていたら初期化 */ }
  return defaults();
}
let store = loadStore();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* 容量/プライベートモード */ } }

function validState(o) {
  try {
    if (!o || !Array.isArray(o.stock) || !Array.isArray(o.waste) || !Array.isArray(o.found) || o.found.length !== 4 ||
      !Array.isArray(o.tab) || o.tab.length !== 7 || !Array.isArray(o.up) || o.up.length !== 52) return false;
    const all = [...o.stock, ...o.waste, ...o.found.flat(), ...o.tab.flat()];
    return all.length === 52 && new Set(all).size === 52 && all.every((n) => Number.isInteger(n) && n >= 0 && n < 52);
  } catch { return false; }
}

// ---------- 音・振動 ----------
let actx = null;
function unlockAudio() {
  if (!store.settings.sound) return;
  try {
    // iOS: マナースイッチ(消音)でもWeb Audioを鳴らす。対応していれば再生カテゴリを playback にする
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    // iOSのPWAでは 'suspended' 以外に 'interrupted' になることがある。running 以外なら毎回 resume する
    if (actx.state !== 'running') actx.resume();
    // 無音を1回鳴らして出力を確実に起こす
    if (!unlockAudio.primed) {
      unlockAudio.primed = true;
      const buf = actx.createBuffer(1, 1, 22050), src = actx.createBufferSource();
      src.buffer = buf; src.connect(actx.destination); src.start(0);
    }
  } catch { /* 無音で続行 */ }
}
// iOSは pointerdown ではなく touchend / click を「ユーザー操作」と認める。どれかで必ず解錠する
['touchend', 'click', 'pointerup', 'keydown'].forEach((t) => document.addEventListener(t, unlockAudio, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockAudio(); });
function tone(f, d = 0.08, type = 'sine', v = 0.12, slideTo = null, delay = 0) {
  if (!store.settings.sound || !actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(); const g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + d + 0.02);
}
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
const sfx = {
  draw: () => tone(620, 0.05, 'triangle', 0.08, 420),
  place: () => tone(480, 0.07, 'sine', 0.12, 300),
  flip: () => tone(780, 0.09, 'sine', 0.09, 1040, 0.12),
  found: (r) => { const f = 523 * 2 ** ((PENTA[r - 1] || 0) / 12); tone(f, 0.18, 'sine', 0.14); tone(f * 2, 0.12, 'sine', 0.05, null, 0.02); },
  bad: () => tone(170, 0.13, 'square', 0.05, 120),
  win: () => [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone(523 * 2 ** (n / 12), 0.28, 'sine', 0.14, null, i * 0.09)),
  stuck: () => [0, -3, -7].forEach((n, i) => tone(392 * 2 ** (n / 12), 0.3, 'triangle', 0.12, null, i * 0.16)),
};
const buzz = (ms) => { if (store.settings.vibrate) { try { navigator.vibrate?.(ms); } catch { /* 非対応 */ } } };

// ---------- ゲーム状態 ----------
let state, history = [], over = false, busy = false, counted = false, assisted = false;
let demo = null, solveToken = 0, worker = null;
let mode = store.settings.mode;
let dateKey = todayKey();
const clock = { acc: 0, t0: null };
const elapsed = () => clock.acc + (clock.t0 !== null ? performance.now() - clock.t0 : 0);
const clockStart = () => { if (clock.t0 === null && !over) clock.t0 = performance.now(); };
const clockPause = () => { if (clock.t0 !== null) { clock.acc += performance.now() - clock.t0; clock.t0 = null; } };
// 日替わりは全員同じ日付で揃えるため日本時間(JST)で固定
function todayKey() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- カードDOM ----------
const board = $('#board');
const layer = $('#cards');
const els = [];
for (let id = 0; id < 52; id++) {
  const r = rank(id), s = suit(id);
  const el = document.createElement('div');
  el.className = 'card'; el.dataset.id = id;
  el.innerHTML = `<div class="inner"><div class="face${isRed(id) ? ' red' : ''}"><span class="r">${LBL[r]}<small>${SYM[s]}</small></span><span class="big">${SYM[s]}</span></div><div class="back"></div></div>`;
  layer.appendChild(el);
  els.push(el);
}

// ---------- レイアウト ----------
let M = { cw: 50, ch: 71, gap: 6, x0: 0, tabY: 90 };
const pos = new Map();
const lifted = new Set();
let liftTimer = null;

function computeLayout() {
  const W = board.clientWidth, H = board.clientHeight;
  const gap = Math.max(4, Math.round(W * 0.012));
  let cw = Math.floor((W - 6 * gap) / 7);
  cw = Math.max(24, Math.min(cw, Math.floor((H * 0.46) / 1.42)));
  const ch = Math.round(cw * 1.42);
  const x0 = Math.round((W - (7 * cw + 6 * gap)) / 2);
  const tabY = ch + Math.round(ch * 0.2);
  M = { cw, ch, gap, x0, tabY, W, H };
  const root = document.documentElement.style;
  root.setProperty('--cw', `${cw}px`); root.setProperty('--ch', `${ch}px`);
  const colX = (c) => x0 + c * (cw + gap);

  pos.clear();
  const put = (id, x, y, z) => pos.set(id, { x, y, z, up: state.up[id] });
  const sn = state.stock.length;
  state.stock.forEach((id, i) => put(id, colX(0) - Math.min(2, sn - 1 - i) * 0.8, -Math.min(2, sn - 1 - i) * 1.2, 100 + i));
  const wn = state.waste.length, fan = Math.round(cw * 0.36);
  // 今めくった札が基準位置(手前)の一番上。前の札は右へ押し出され、見えるのは最新の3枚
  state.waste.forEach((id, i) => put(id, colX(1) + Math.min(2, wn - 1 - i) * fan, 0, 100 + i));
  state.found.forEach((f, p) => f.forEach((id, i) => put(id, colX(3 + p), 0, 100 + i)));
  const avail = H - tabY - 6;
  state.tab.forEach((col, c) => {
    const dStep = ch * 0.17, uStep = ch * 0.31;
    let total = 0;
    col.forEach((id, j) => { if (j < col.length - 1) total += state.up[id] ? uStep : dStep; });
    const scale = total + ch > avail ? Math.max(0.35, (avail - ch) / total) : 1;
    let y = tabY;
    col.forEach((id, j) => {
      put(id, colX(c), Math.round(y), 100 + j);
      y += (state.up[id] ? uStep : dStep) * scale;
    });
  });
  const place = (el, c) => { el.style.left = `${colX(c)}px`; el.style.top = '0px'; };
  place($('#slot-stock'), 0); place($('#slot-waste'), 1);
  document.querySelectorAll('.slot.found').forEach((el) => place(el, 3 + Number(el.dataset.pile)));
  $('#slot-stock').classList.toggle('empty', state.stock.length === 0);
}

// opts: instant / delays: Map(id→ms) / flips: Map(id→ms)
function applyLayout(opts = {}) {
  computeLayout();
  if (opts.instant) els.forEach((e) => e.classList.add('nolag'));
  let maxD = 0;
  pos.forEach((p, id) => {
    const el = els[id];
    const d = opts.delays?.get(id) ?? 0;
    const fd = opts.flips?.get(id) ?? 0;
    maxD = Math.max(maxD, d, fd);
    el.style.transitionDelay = d ? `${d}ms` : '';
    el.firstChild.style.transitionDelay = fd ? `${fd}ms` : '';
    el.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
    el.style.zIndex = p.z + (lifted.has(id) ? 1000 : 0);
    el.classList.toggle('up', p.up);
  });
  if (opts.instant) { void layer.offsetWidth; els.forEach((e) => e.classList.remove('nolag')); }
  if (maxD) setTimeout(() => els.forEach((e) => { e.style.transitionDelay = ''; e.firstChild.style.transitionDelay = ''; }), maxD + 600);
}
function liftThenSettle(ids) {
  ids.forEach((id) => lifted.add(id));
  clearTimeout(liftTimer);
  liftTimer = setTimeout(() => { lifted.clear(); pos.forEach((p, id) => { els[id].style.zIndex = p.z; }); }, 450);
}

// ---------- HUD ----------
function updateHud() {
  $('#moves').textContent = state.moves;
  const ms = elapsed();
  $('#time').textContent = fmt(ms);
  $('#score').textContent = calcScore(ms / 1000, state.moves);
  $('#btn-undo').disabled = busy || over || history.length === 0;
  $('#btn-giveup').disabled = busy || over;
}
setInterval(updateHud, 250);

function saveGame() {
  store.save = over ? null : { state, elapsed: elapsed(), mode, dateKey, counted, assisted };
  persist();
}

// ---------- ゲーム進行 ----------
function randomSeed() { return Math.floor(Math.random() * 4294967296); }

function startNew(seed) {
  els.forEach((e) => e.getAnimations().forEach((a) => a.cancel()));
  layer.classList.remove('dim');
  closeSheet(true);
  if (seed === undefined) {
    dateKey = todayKey();
    mode = store.settings.mode;
    seed = mode === 'daily' ? seedFromString(`solitaire-${dateKey}`) : randomSeed();
  }
  state = newGame(seed);
  history = []; over = false; counted = false; assisted = false;
  clearTimeout(demo?.timer); demo = null; solveToken++;
  proof.token++; proof.w?.terminate(); proof.w = null; clearTimeout(proof.timer);
  $('#app').classList.remove('demo'); setSpeed(1);
  clock.acc = 0; clock.t0 = null;
  busy = true;
  lifted.clear();
  // 全カードを山札位置に伏せて置いてから配る
  computeLayout();
  els.forEach((el) => {
    el.classList.add('nolag'); el.classList.remove('up');
    el.style.transform = `translate3d(${M.x0}px,0,0)`;
    el.style.zIndex = 100;
  });
  void layer.offsetWidth;
  els.forEach((e) => e.classList.remove('nolag'));
  const delays = new Map(), flips = new Map();
  let n = 0;
  for (let r = 0; r < 7; r++) for (let c = r; c < 7; c++) {
    const id = state.tab[c][r];
    delays.set(id, n * 34);
    if (r === c) flips.set(id, n * 34 + 260);
    n++;
  }
  requestAnimationFrame(() => {
    applyLayout({ delays, flips });
    for (let i = 0; i < 7; i++) setTimeout(() => sfx.draw(), i * 90);
  });
  setTimeout(() => { busy = false; updateHud(); }, n * 34 + 520);
  saveGame();
  updateHud();
}

function markStarted() {
  if (!counted) { counted = true; store.stats.played++; }
  clockStart();
}

function afterAction() {
  saveGame();
  updateHud();
  if (isWon(state)) return win();
  if (canAutoFinish(state)) return autoFinish();
  if (isStuck(state)) return stuck();
  checkDead();
}

function doDraw(opts = {}) {
  const snap = cloneState(state);
  const hadStock = state.stock.length > 0;
  const topId = hadStock ? state.stock[state.stock.length - 1] : null;
  if (!draw(state)) return false;
  history.push(snap);
  if (!opts.demo) markStarted();
  if (topId !== null) { liftThenSettle([topId]); pop([topId]); applyLayout(); }
  else {
    // 山札のリセット: 捨て札が順に山札へ戻る
    const dl = new Map();
    state.stock.forEach((id, i) => dl.set(id, i * 14));
    liftThenSettle(state.stock);
    applyLayout({ delays: dl, flips: dl });
  }
  sfx.draw(); buzz(5);
  if (opts.demo) { updateHud(); return true; }
  afterAction();
  return true;
}

function pop(ids) {
  ids.forEach((id) => {
    try { els[id].animate([{ scale: '1' }, { scale: '1.09', offset: 0.4 }, { scale: '1' }], { duration: 300, easing: 'ease-out' }); } catch { /* 非対応 */ }
  });
}

function doMove(from, to, opts = {}) {
  const snap = cloneState(state);
  const r = move(state, from, to);
  if (!r.ok) return false;
  history.push(snap);
  if (history.length > 300) history.shift();
  if (!opts.demo) markStarted();
  liftThenSettle(r.ids); pop(r.ids);
  if (to.zone === 'found') sfx.found(state.found[to.pile].length); else sfx.place();
  buzz(8);
  const flips = new Map();
  if (r.flipped !== null) { flips.set(r.flipped, 160); sfx.flip(); }
  applyLayout({ flips });
  if (opts.demo) { updateHud(); return true; }
  afterAction();
  return true;
}

function undo() {
  if (busy || over || !history.length) return;
  const prev = history.pop();
  prev.moves = state.moves + 1; // 戻すのも1アクション
  state = prev;
  sfx.place();
  applyLayout();
  saveGame(); updateHud();
  checkDead();
}

function autoFinish() {
  busy = true;
  const step = () => {
    const m = nextFoundationMove(state);
    if (!m) { busy = false; return; }
    const r = move(state, m.from, m.to);
    state.moves--; // 自動仕上げは手数に含めない
    liftThenSettle(r.ids);
    sfx.found(state.found[m.to.pile].length);
    applyLayout();
    updateHud();
    if (isWon(state)) return win();
    setTimeout(step, 110);
  };
  setTimeout(step, 350);
}

function win() {
  over = true; busy = true;
  clockPause();
  if (assisted) {
    store.save = null; persist(); updateHud();
    sfx.win(); cascade();
    setTimeout(showAssisted, 2000);
    return;
  }
  const sec = elapsed() / 1000;
  const moves = state.moves;
  const score = calcScore(sec, moves);
  const st = store.stats;
  const rec = {
    time: st.bestTime === null || sec < st.bestTime,
    moves: st.bestMoves === null || moves < st.bestMoves,
    score: st.bestScore === null || score > st.bestScore,
  };
  st.won++;
  if (rec.time) st.bestTime = sec;
  if (rec.moves) st.bestMoves = moves;
  if (rec.score) st.bestScore = score;
  let post = null; // 投稿する自己ベスト(今日の自己ベストが前回の投稿より良くなったときだけ)
  if (mode === 'daily') {
    st.posted = st.posted || {};
    const mine = { score, time: Math.floor(sec), moves };
    st.daily[dateKey] = mergeBests(st.daily[dateKey], mine);
    if (improved(st.daily[dateKey], st.posted[dateKey])) post = { day: dateKey, ...st.daily[dateKey] };
    for (const o of [st.daily, st.posted]) { const keys = Object.keys(o).sort(); while (keys.length > 60) delete o[keys.shift()]; }
  }
  store.save = null; persist();
  updateHud();
  sfx.win(); buzz(40);
  cascade();
  setTimeout(() => showResult(sec, moves, score, rec, post), 2000);
}

function cascade() {
  // 今いちばん上にあるカードから順に飛んでいく(上がり札の山は上=Kから)
  const ids = [];
  pos.forEach((p, id) => { if (state.found.some((f) => f.includes(id))) ids.push(id); });
  ids.sort((a, b) => pos.get(b).z - pos.get(a).z || pos.get(a).x - pos.get(b).x);
  ids.forEach((id, i) => {
    const p = pos.get(id);
    const el = els[id];
    el.style.zIndex = 2000 + (ids.length - i); // 先に飛ぶ札ほど手前
    const dir = Math.random() < 0.5 ? -1 : 1;
    const dx = dir * (M.W * (0.25 + Math.random() * 0.55));
    const peak = p.y - M.H * (0.12 + Math.random() * 0.22);
    const rz = dir * (50 + Math.random() * 110);
    const tilt = (x, y, rx, ry, rzv, sc) =>
      `translate3d(${x}px,${y}px,0) perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rzv}deg) scale(${sc})`;
    // 少しだけ奥行きを付ける: 手前に迫るように拡大しつつ、軽く傾けて飛ばす
    el.animate([
      { transform: tilt(p.x, p.y, 0, 0, 0, 1), filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.3))', easing: 'cubic-bezier(.2,.7,.4,1)' },
      { transform: tilt(p.x + dx * 0.4, peak, -16, dir * 24, rz * 0.35, 1.28), filter: 'drop-shadow(0 14px 14px rgba(0,0,0,.35))', offset: 0.38, easing: 'cubic-bezier(.5,0,.9,.6)' },
      { transform: tilt(p.x + dx, M.H + M.ch * 2, -28, dir * 38, rz, 1.5), filter: 'drop-shadow(0 20px 18px rgba(0,0,0,.3))' },
    ], { duration: 1500, delay: i * 38, fill: 'forwards' });
  });
}

// 「もう絶対に勝てない」を、完全探索で証明できた瞬間に終わらせる。証明できない間(不明)はゲームを続ける。
const proof = { w: null, token: 0, timer: null };
function checkDead() {
  clearTimeout(proof.timer);
  const token = ++proof.token;
  proof.w?.terminate(); proof.w = null;
  if (over || demo || assisted || !state || isWon(state) || typeof Worker === 'undefined') return;
  proof.timer = setTimeout(() => {
    if (token !== proof.token || over) return;
    const game = cloneState(state);
    try {
      const w = new Worker('solver-worker.js', { type: 'module' });
      proof.w = w;
      w.onmessage = (e) => {
        if (token !== proof.token) return;
        w.terminate(); proof.w = null;
        if (e.data.status === 'unwinnable' && !over && !demo && !sheetOpen) stuck(true);
      };
      w.onerror = () => { w.terminate(); if (proof.w === w) proof.w = null; };
      w.postMessage({ game, opts: { complete: true, timeLimitMs: 3000, maxStates: 500000 } });
    } catch { /* 無視 */ }
  }, 350);
}
function stuck(proven) {
  proof.token++; proof.w?.terminate(); proof.w = null; clearTimeout(proof.timer);
  over = true; busy = true;
  clockPause();
  store.save = null; persist();
  updateHud();
  layer.classList.add('dim');
  sfx.stuck(); buzz([30, 60, 30]);
  setTimeout(() => {
    sheet(`<h2>${proven ? 'No Winning Line' : 'No Moves Left'}</h2><p>${proven ? 'The computer checked every possible line from here. This deal can no longer be won.' : "You've been through the whole deck and there are no moves left."}</p>
      <div class="btns"><button data-act="new">New Game</button>
      <button class="sub" data-act="retry">Retry This Deal</button>
      <button class="sub" data-act="view">View Board</button></div>`, {
      new: () => startNew(),
      retry: () => startNew(state.seed),
      view: () => closeSheet(true),
    });
  }, 700);
}

function showResult(sec, moves, score, rec, post) {
  const flag = (b) => (b ? '<i class="new">NEW</i> ' : '');
  const m = mode === 'daily' ? `Daily ${dateKey}` : 'Random';
  const canPost = RANK_ON && mode === 'daily' && !assisted && !!post;
  sheet(`<h2>You Win!</h2><p>${m}</p><div class="big">${score}</div>
    <div class="grid"><div>Time<b>${flag(rec.time)}${fmt(sec * 1000)}</b></div><div>Moves<b>${flag(rec.moves)}${moves}</b></div></div>
    ${canPost ? '<div class="post" id="post"></div>' : ''}
    <div class="btns"><button data-act="new">Play Again</button><button class="sub" data-act="menu">View Stats</button></div>`, {
    new: () => startNew(), menu: () => openMenu(),
  });
  if (!canPost) return;
  // Nickname is asked once. After that, a better personal best replaces the posted one automatically.
  if (savedNick()) postScore(post, savedNick()); else mountPost(post);
}

// ---------- ランキング(Firebase。未設定なら非表示) ----------
let R = null, rankToken = 0;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function ranking() {
  if (!RANK_ON) return null;
  if (!R) { try { R = await import('./ranking.js'); } catch { R = null; } }
  return R;
}
const savedNick = () => { try { return localStorage.getItem(NICK) || ''; } catch { return ''; } };

// First time only: ask for a nickname.
function mountPost(entry, msg) {
  const box = $('#post');
  if (!box) return;
  box.innerHTML = `<p>${msg || 'New best for today! Pick a nickname to join the ranking.'}</p>
    <input id="nick" type="text" maxlength="16" placeholder="Nickname" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(savedNick())}">
    <div class="postbtns"><button data-post="yes">Post</button><button class="sub" data-post="no">Not now</button></div>`;
  box.querySelector('[data-post=yes]').addEventListener('click', () => {
    const name = $('#nick').value.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!name) { $('#nick').focus(); toast('Enter a nickname'); return; }
    try { localStorage.setItem(NICK, name); } catch { /* 無視 */ }
    postScore(entry, name);
  });
  box.querySelector('[data-post=no]').addEventListener('click', () => box.remove());
}
async function postScore(entry, name) {
  const box = $('#post');
  if (!box) return;
  box.innerHTML = '<div class="spin"></div>';
  try {
    const rk = await ranking();
    if (!rk) throw new Error('unavailable');
    const r = await rk.submitScore(entry.day, name, entry);
    store.stats.posted = store.stats.posted || {};
    store.stats.posted[entry.day] = { ...r.best }; persist();
    const uid = await rk.me();
    const [a, b, c] = await Promise.all([
      rk.rankOf('day', entry.day, 'score', r.best.score, uid), rk.rankOf('day', entry.day, 'speed', r.best.time, uid),
      rk.rankOf('day', entry.day, 'moves', r.best.moves, uid)]);
    const box2 = $('#post');
    if (!box2) return;
    box2.innerHTML = `<p>Ranking updated as <b>${esc(name)}</b><br>Today: Score #${a} · Speed #${b} · Moves #${c}</p>
      <button class="sub" data-post="rank">View Rankings</button>`;
    box2.querySelector('[data-post=rank]').addEventListener('click', () => openRanking('day', 'score'));
  } catch {
    const box2 = $('#post');
    if (box2) {
      box2.innerHTML = '<p>Couldn\'t post. Check your connection.</p><button class="sub" data-post="retry">Try Again</button>';
      box2.querySelector('[data-post=retry]').addEventListener('click', () => postScore(entry, name));
    }
  }
}

const TABS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['all', 'All']];
const CATS = [['score', 'Score'], ['speed', 'Speed'], ['moves', 'Moves']];
async function openRanking(kind = 'day', cat = 'score') {
  const rk = await ranking();
  if (!rk) return;
  const token = ++rankToken;
  const day = todayKey();
  const acts = {
    close: () => closeSheet(),
    play: () => { store.settings.mode = 'daily'; persist(); confirmNew(() => startNew()); },
  };
  TABS.forEach(([k]) => { acts[`t-${k}`] = () => openRanking(k, cat); });
  CATS.forEach(([c]) => { acts[`c-${c}`] = () => openRanking(kind, c); });
  const seg = (items, cur, pre) => `<div class="seg tabs">${items.map(([k, l]) => `<button${k === cur ? ' class="on"' : ''} data-act="${pre}-${k}">${l}</button>`).join('')}</div>`;
  const frame = (body) => `<h2>Ranking</h2><p>${periodLabel(kind, day)}</p>
    ${seg(CATS, cat, 'c')}${seg(TABS, kind, 't')}
    ${body}
    <div class="btns"><button data-act="play">${mode === 'daily' ? 'New Daily Game' : "Play Today's Daily"}</button><button class="sub" data-act="close">Close</button></div>`;
  sheet(frame('<div class="spin"></div>'), acts, true);
  let rows, me;
  try { [rows, me] = await Promise.all([rk.topScores(kind, day, 30, cat), rk.me()]); } catch {
    if (token === rankToken) sheet(frame("<p>Couldn't load the ranking right now.</p>"), acts, true);
    return;
  }
  if (token !== rankToken) return; // 別のタブに切り替わった
  const main = (r) => (cat === 'speed' ? fmt(r.time * 1000) : cat === 'moves' ? `${r.moves}` : `${r.score}`);
  const sub = (r) => (cat === 'speed' ? `${r.moves} moves · ${r.score} pts` : cat === 'moves' ? `${fmt(r.time * 1000)} · ${r.score} pts` : `${fmt(r.time * 1000)} · ${r.moves} moves`);
  const list = rows.length
    ? rows.map((r, i) => `<div class="rk${r.uid === me ? ' me' : ''}"><b>${i + 1}</b><span>${esc(r.name)}<small>${sub(r)}${kind === 'day' ? '' : ` · ${fmtDay(r.day)}`}</small></span><b>${main(r)}</b></div>`).join('')
    : `<p>No scores ${kind === 'all' ? 'yet' : 'in this period yet'}. Be the first!</p>`;
  sheet(frame(`<div class="rank-list">${list}</div>`), acts, true);
}

// ---------- リタイヤ(自動解答) ----------
function setSpeed(v) {
  document.documentElement.style.setProperty('--mv', v >= 4 ? '.16s' : v >= 2 ? '.26s' : '.42s');
  $('#btn-speed').textContent = `${v}×`;
  if (demo) demo.speed = v;
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2200);
}
function giveUp() {
  if (busy || over || sheetOpen) return;
  sheet(`<h2>Give Up?</h2><p>The computer will solve this deal and play the solution for you. This game won't count toward your records.</p>
    <div class="btns"><button data-act="go">Show Solution</button><button class="sub" data-act="no">Keep Playing</button></div>`, {
    go: startSolve, no: () => closeSheet(),
  }, true);
}
function startSolve() {
  const token = ++solveToken;
  sheet(`<h2>Solving…</h2><p>The computer is searching for a winning line. This can take up to about 20 seconds.</p>
    <div class="spin"></div><div class="btns"><button class="sub" data-act="cancel">Cancel</button></div>`, {
    cancel: () => { solveToken++; worker?.terminate(); worker = null; closeSheet(); },
  });
  const game = cloneState(state);
  const opts = { timeLimitMs: 20000, improveMs: 3000 };
  const finish = (r) => {
    if (token !== solveToken) return;
    worker?.terminate(); worker = null;
    if (r.status === 'solved') return onSolved(r);
    proveFull(game, token); // 解が見つからないときは、本当に勝てないのか完全探索で確かめる
  };
  const fallback = () => { worker?.terminate(); worker = null; setTimeout(() => finish(solve(game, { timeLimitMs: 5000, improveMs: 1000 })), 60); };
  try {
    worker = new Worker('solver-worker.js', { type: 'module' });
    worker.onmessage = (e) => finish(e.data);
    worker.onerror = fallback;
    worker.postMessage({ game, opts });
  } catch { fallback(); }
}
function proveFull(game, token) {
  sheet(`<h2>Checking…</h2><p>The computer is checking every possible line to see whether this deal can still be won. This can take up to about 20 seconds.</p>
    <div class="spin"></div><div class="btns"><button class="sub" data-act="cancel">Cancel</button></div>`, {
    cancel: () => { solveToken++; worker?.terminate(); worker = null; closeSheet(); },
  });
  const done = (r) => { if (token !== solveToken) return; worker?.terminate(); worker = null; onSolved(r); };
  try {
    worker = new Worker('solver-worker.js', { type: 'module' });
    worker.onmessage = (e) => done(e.data);
    worker.onerror = () => done({ status: 'timeout' });
    worker.postMessage({ game, opts: { complete: true, timeLimitMs: 20000, maxStates: 500000 } });
  } catch { done({ status: 'timeout' }); }
}
function onSolved(r) {
  if (r.status === 'solved') { closeSheet(true); startDemo(r.actions); return; }
  const exhausted = r.status === 'unwinnable';
  sheet(`<h2>${exhausted ? 'Unwinnable' : 'No Solution Found'}</h2>
    <p>${exhausted ? 'The computer checked every possible line. There is no way to win from here.' : "The computer couldn't find a winning line in time. This deal may not be winnable."}</p>
    <div class="btns"><button data-act="keep">Keep Playing</button><button class="sub" data-act="new">New Game</button></div>`, {
    keep: () => closeSheet(), new: () => startNew(),
  });
}
function startDemo(actions) {
  assisted = true;
  demo = { actions, i: 0, speed: 1, timer: null };
  busy = true;
  clockPause();
  $('#app').classList.add('demo');
  setSpeed(1);
  updateDemoInfo();
  saveGame(); updateHud();
  demo.timer = setTimeout(demoStep, 700);
}
function updateDemoInfo() {
  if (demo) $('#demo-info').textContent = `Step ${demo.i} / ${demo.actions.length}`;
}
function demoStep() {
  if (!demo) return;
  if (demo.i >= demo.actions.length) return endDemo();
  const a = demo.actions[demo.i++];
  let ok = false;
  if (a.t === 'draw') ok = doDraw({ demo: true });
  else { const from = locate(a.card); ok = !!from && doMove(from, a.to, { demo: true }); }
  if (!ok) { stopDemo(); toast('The solution could not be played'); return; }
  updateDemoInfo();
  demo.timer = setTimeout(demoStep, (a.t === 'draw' ? 380 : 560) / demo.speed);
}
function endDemo() {
  demo = null;
  $('#app').classList.remove('demo');
  busy = false;
  setSpeed(1);
  afterAction();
}
function stopDemo() {
  clearTimeout(demo?.timer);
  demo = null;
  $('#app').classList.remove('demo');
  busy = false;
  setSpeed(1);
  if (state.moves > 0) clockStart();
  saveGame(); updateHud();
  if (!over) afterAction();
}
function showAssisted() {
  sheet(`<h2>Solved by Computer</h2><p>Assisted games aren't added to your records.</p>
    <div class="btns"><button data-act="new">New Game</button><button class="sub" data-act="retry">Retry This Deal</button></div>`, {
    new: () => startNew(), retry: () => startNew(state.seed),
  });
}

// ---------- シート(ダイアログ) ----------
let sheetOpen = false, sheetClosable = false;
function sheet(html, actions, closable = false) {
  const s = $('#sheet');
  s.innerHTML = html;
  s.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]?.(b)));
  $('#modal').classList.remove('hidden');
  sheetOpen = true; sheetClosable = closable;
  clockPause();
}
function closeSheet(silent) {
  $('#modal').classList.add('hidden');
  const was = sheetOpen;
  sheetOpen = false;
  if (was && !over && state && state.moves > 0) clockStart();
  return silent;
}
$('#modal').addEventListener('pointerdown', (e) => { if (e.target === $('#modal') && sheetClosable) closeSheet(); });

function confirmNew(cb) {
  if (state.moves > 0 && !over) {
    sheet(`<h2>New Game</h2><p>Your current game will end. Continue?</p>
      <div class="btns"><button data-act="ok">Start New Game</button><button class="sub" data-act="no">Keep Playing</button></div>`, {
      ok: () => { closeSheet(true); cb(); }, no: () => closeSheet(),
    }, true);
  } else cb();
}

function openMenu() {
  const st = store.stats, se = store.settings;
  const rate = st.played ? Math.round((st.won / st.played) * 100) : 0;
  const d = st.daily[todayKey()];
  const seg = (on) => (on ? ' class="on"' : '');
  sheet(`<h2>Stats</h2>
    <div class="grid">
      <div>Played<b>${st.played}</b></div><div>Won<b>${st.won} (${rate}%)</b></div>
      <div>Best Score<b>${st.bestScore ?? '-'}</b></div><div>Best Time<b>${st.bestTime === null ? '-' : fmt(st.bestTime * 1000)}</b></div>
      <div>Fewest Moves<b>${st.bestMoves ?? '-'}</b></div><div>Today's Daily<b>${d ? d.score : '-'}</b></div>
    </div>
    <div class="row"><span>Mode</span><span class="seg"><button${seg(se.mode === 'random')} data-act="m-random">Random</button><button${seg(se.mode === 'daily')} data-act="m-daily">Daily</button></span></div>
    <div class="row"><span>Sound</span><span class="seg"><button${seg(se.sound)} data-act="snd-on">On</button><button${seg(!se.sound)} data-act="snd-off">Off</button></span></div>
    <div class="row"><span>Haptics</span><span class="seg"><button${seg(se.vibrate)} data-act="vib-on">On</button><button${seg(!se.vibrate)} data-act="vib-off">Off</button></span></div>
    <div class="btns" style="margin-top:10px">${RANK_ON ? '<button data-act="rank">Ranking</button>' : ''}<button class="${RANK_ON ? 'sub' : ''}" data-act="close">Close</button></div>`, {
    rank: () => openRanking('day', 'score'),
    'm-random': () => setMode('random'), 'm-daily': () => setMode('daily'),
    'snd-on': () => { se.sound = true; persist(); unlockAudio(); openMenu(); },
    'snd-off': () => { se.sound = false; persist(); openMenu(); },
    'vib-on': () => { se.vibrate = true; persist(); openMenu(); buzz(20); },
    'vib-off': () => { se.vibrate = false; persist(); openMenu(); },
    close: () => closeSheet(),
  }, true);
}
function setMode(m) {
  if (store.settings.mode === m) return;
  confirmNew(() => { store.settings.mode = m; persist(); startNew(); });
}

// ---------- 入力 ----------
const locate = (id) => locateCard(state, id);

function reject(ids) {
  sfx.bad(); buzz(12);
  ids.forEach((id) => {
    const el = els[id];
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 350);
  });
}

function dropTarget(headX, headY) {
  const f = (headX - M.x0) / (M.cw + M.gap);
  const cols = [Math.round(f), f > Math.round(f) ? Math.round(f) + 1 : Math.round(f) - 1]
    .filter((c) => c >= 0 && c <= 6);
  const cy = headY + M.ch / 2;
  const cands = [];
  if (cy < M.tabY - M.ch * 0.15) cols.forEach((c) => { if (c >= 3) cands.push({ zone: 'found', pile: c - 3 }); });
  else cols.forEach((c) => cands.push({ zone: 'tab', col: c }));
  return cands;
}

let drag = null;
board.addEventListener('contextmenu', (e) => e.preventDefault());
board.addEventListener('pointerdown', (e) => {
  if (drag && performance.now() - drag.t > 1500) drag = null; // pointerup を取りこぼした古い状態でボードが固まらないように
  if (busy || over || sheetOpen || drag) return;
  unlockAudio();
  const cardEl = e.target.closest('.card');
  if (!cardEl) {
    if (e.target.closest('#slot-stock')) drag = { tap: 'stock', sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId, t: performance.now() };
    return;
  }
  const L = locate(Number(cardEl.dataset.id));
  if (!L) return;
  if (L.zone === 'stock') { drag = { tap: 'stock', sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId, t: performance.now() }; return; }
  const ids = cardsAt(state, L);
  if (!ids.length) return;
  const r = board.getBoundingClientRect();
  drag = {
    from: L, ids, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId, t: performance.now(),
    base: ids.map((id) => ({ ...pos.get(id) })), left: r.left, top: r.top,
  };
  try { board.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
});

board.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid || drag.tap) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) > 7) {
    drag.moved = true;
    drag.ids.forEach((id, i) => { els[id].classList.add('drag', 'lift'); els[id].style.zIndex = 3000 + i; els[id].style.transitionDelay = ''; });
    buzz(4);
  }
  if (!drag.moved) return;
  drag.ids.forEach((id, i) => {
    els[id].style.transform = `translate3d(${drag.base[i].x + dx}px,${drag.base[i].y + dy}px,0)`;
  });
  drag.dx = dx; drag.dy = dy;
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  if (d.tap === 'stock') {
    if (!cancelled && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 12) doDraw();
    return;
  }
  d.ids.forEach((id) => els[id].classList.remove('drag', 'lift'));
  if (!d.moved) {
    if (cancelled) return;
    const to = autoMoveTarget(state, d.from);
    if (to) doMove(d.from, to); else reject(d.ids);
    return;
  }
  if (!cancelled) {
    const hx = d.base[0].x + d.dx, hy = d.base[0].y + d.dy;
    for (const to of dropTarget(hx, hy)) {
      if (canMove(state, d.from, to)) { liftThenSettle(d.ids); doMove(d.from, to); return; }
    }
    sfx.bad();
  }
  liftThenSettle(d.ids);
  applyLayout();
}
board.addEventListener('pointerup', (e) => endDrag(e, false));
board.addEventListener('pointercancel', (e) => endDrag(e, true));
board.addEventListener('lostpointercapture', (e) => endDrag(e, true));
// 指がボードの外で離れたり、システムにジェスチャを奪われても状態を残さない
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));

// ダブルタップで画面全体が上にずれる(ページスクロール/ズーム)のを止める
let lastTouchEnd = 0;
board.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouchEnd < 350) e.preventDefault(); lastTouchEnd = n; }, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.rank-list, #sheet')) e.preventDefault(); }, { passive: false });
const pinTop = () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); document.scrollingElement && (document.scrollingElement.scrollTop = 0); };
window.addEventListener('scroll', pinTop, { passive: true });
window.visualViewport?.addEventListener('scroll', pinTop);
window.visualViewport?.addEventListener('resize', pinTop);

$('#btn-undo').addEventListener('click', () => { unlockAudio(); undo(); });
$('#btn-giveup').addEventListener('click', () => { unlockAudio(); giveUp(); });
$('#btn-stop').addEventListener('click', stopDemo);
$('#btn-speed').addEventListener('click', () => { if (demo) setSpeed(demo.speed >= 4 ? 1 : demo.speed * 2); });
$('#btn-new').addEventListener('click', () => { unlockAudio(); confirmNew(() => startNew()); });
$('#btn-menu').addEventListener('click', () => { unlockAudio(); openMenu(); });

// ---------- ライフサイクル ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clockPause(); if (state) saveGame(); }
  else if (state && !over && !sheetOpen && state.moves > 0) clockStart();
});
window.addEventListener('pagehide', () => { clockPause(); if (state) saveGame(); });
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => state && applyLayout({ instant: true }), 80); });

function boot() {
  const sv = store.save;
  if (sv && validState(sv.state)) {
    state = sv.state;
    if (typeof state.moves !== 'number') state.moves = 0;
    mode = sv.mode === 'daily' ? 'daily' : 'random';
    dateKey = typeof sv.dateKey === 'string' ? sv.dateKey : todayKey();
    counted = !!sv.counted;
    assisted = !!sv.assisted;
    clock.acc = Number.isFinite(sv.elapsed) ? sv.elapsed : 0;
    applyLayout({ instant: true });
    if (state.moves > 0) clockStart();
    updateHud();
    if (canAutoFinish(state)) autoFinish();
    else if (!isWon(state) && isStuck(state)) stuck();
    else checkDead();
  } else {
    store.save = null;
    startNew();
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
requestAnimationFrame(boot);

// テスト用フック
window.__sol = { get state() { return state; }, get over() { return over; }, startNew, checkDead, store: () => store };
